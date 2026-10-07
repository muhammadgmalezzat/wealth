import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState, type ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { FundSheet } from '@/components/funds/FundSheet';
import { fundNextStep, fundPercent, movementKind } from '@/components/funds/fundsUi';
import { FREQUENCY_LABELS, FUND_STATUS, FUND_TYPE_LABELS } from '@/components/funds/labels';
import { MoveMoneySheet } from '@/components/funds/MoveMoneySheet';
import { PaySinkingSheet } from '@/components/funds/PaySinkingSheet';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { formatDateAr } from '@/components/ui/formatDateAr';
import { formatMoney } from '@/components/ui/formatMoney';
import { InsightCard } from '@/components/ui/InsightCard';
import { ListGroup, ListRow } from '@/components/ui/ListRow';
import { LoadingView } from '@/components/ui/LoadingView';
import { Money } from '@/components/ui/Money';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { StatusChip } from '@/components/ui/StatusChip';
import { colors, opacity, space } from '@/constants/theme';
import {
  fundAllocated,
  fundCurrent,
  fundDueDate,
  fundLinkedValue,
  fundProgress,
  fundRequiredMonthly,
  fundStatus,
  holdingValueEGP,
  linkableHoldings,
} from '@/store/selectors';
import type { Fund } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { monthsUntil } from '@/utils/dates';

type SheetKind = 'edit' | 'allocate' | 'withdraw' | 'pay' | null;

// "فاضل شهر" · "فاضل شهرين" · "فاضل 3 شهور" · "فاضل 14 شهر".
const monthsLeftPhrase = (n: number) =>
  n === 1 ? 'فاضل شهر' : n === 2 ? 'فاضل شهرين' : n <= 10 ? `فاضل ${n} شهور` : `فاضل ${n} شهر`;

const TYPE_ICONS: Record<Fund['type'], ComponentProps<typeof MaterialIcons>['name']> = {
  emergency: 'shield',
  goal: 'track-changes',
  sinking: 'event-repeat',
};

// Progress and the next action first, history last: hero · next step · actions · facts · linked
// gold · movements. "تعديل" in the header opens FundSheet (edit / delete).
export default function FundDetailScreen() {
  // Home's next actions link here with ?allocate=1 to open the allocate sheet right away.
  const { id, allocate } = useLocalSearchParams<{ id: string; allocate?: string }>();
  const state = useFinanceStore();
  const [sheet, setSheet] = useState<SheetKind>(allocate === '1' ? 'allocate' : null);

  if (!state.hasHydrated) return <LoadingView />;

  const fund = state.funds.find((f) => f.id === id);
  if (!fund) {
    return (
      <Screen edges={['bottom']} contentStyle={styles.missing}>
        <Stack.Screen options={{ title: 'الصندوق' }} />
        <AppText variant="secondary" color="textSecondary" align="center">
          الصندوق غير موجود
        </AppText>
      </Screen>
    );
  }

  const now = new Date();
  const status = fundStatus(state, fund.id, now);
  const chip = FUND_STATUS[status];
  const current = fundCurrent(state, fund.id);
  const progress = fundProgress(state, fund.id);
  const pct = fundPercent(progress);
  const linkedValue = fundLinkedValue(state, fund.id);
  const due = fundDueDate(fund);
  const requiredMonthly = fundRequiredMonthly(state, fund.id, now);
  const step = fundNextStep(state, fund, now);
  const sinking = fund.type === 'sinking';
  const movements = state.fundMovements
    .map((m, index) => ({ m, index }))
    .filter(({ m }) => m.fundId === fund.id)
    // Newest first; movements recorded later on the same day come first.
    .sort((a, b) => (a.m.date !== b.m.date ? (a.m.date < b.m.date ? 1 : -1) : b.index - a.index))
    .map(({ m }) => m);
  const linkedHoldings = state.holdings.filter((h) => fund.linkedHoldingIds.includes(h.id));
  const canLinkGold = linkableHoldings(state, fund.id).some((h) => h.type === 'gold' && !fund.linkedHoldingIds.includes(h.id));

  const facts: { label: string; value: string }[] = [
    requiredMonthly !== null ? { label: 'مطلوب شهرياً', value: formatMoney(requiredMonthly, fund.currency) } : null,
    { label: 'نقداً في الصندوق', value: formatMoney(fundAllocated(state, fund.id), fund.currency) },
    linkedValue > 0 ? { label: 'قيمة الذهب المربوط', value: formatMoney(linkedValue, fund.currency) } : null,
    due ? { label: sinking ? 'الاستحقاق القادم' : 'الموعد', value: formatDateAr(due) } : null,
    sinking && fund.frequency ? { label: 'التكرار', value: FREQUENCY_LABELS[fund.frequency] } : null,
  ].filter((f): f is { label: string; value: string } => f !== null);

  return (
    <Screen scroll edges={['bottom']} contentStyle={styles.content}>
      <Stack.Screen
        options={{
          title: fund.name,
          headerRight: () => (
            <Pressable
              onPress={() => setSheet('edit')}
              hitSlop={10}
              accessibilityRole="button"
              style={({ pressed }) => pressed && { opacity: opacity.pressed }}>
              <AppText variant="bodyStrong" color="primary700">
                تعديل
              </AppText>
            </Pressable>
          ),
        }}
      />

      {/* ── Hero ── */}
      <Card variant="hero" style={styles.hero}>
        <View style={styles.typeRow}>
          <MaterialIcons name={TYPE_ICONS[fund.type]} size={18} color={colors.textSecondary} />
          <AppText variant="secondary" color="textSecondary">
            {FUND_TYPE_LABELS[fund.type]}
          </AppText>
        </View>
        <View style={styles.amounts}>
          <Money amount={current} currency={fund.currency} size="lg" />
          <AppText variant="secondary" color="textSecondary">
            من {formatMoney(fund.targetAmount, fund.currency)}
          </AppText>
        </View>
        <ProgressBar
          progress={progress}
          tone={status === 'behind' ? 'attention' : 'normal'}
          goldPortion={linkedValue > 0 && fund.targetAmount > 0 ? linkedValue / fund.targetAmount : 0}
        />
        <View style={styles.statusRow}>
          <View style={styles.chips}>
            <StatusChip label={chip.label} tone={chip.tone} />
            {pct.over && <StatusChip label="تخطيت الهدف" tone="ok" />}
          </View>
          <AppText variant="caption" color="textSecondary" style={styles.tabular}>
            {`\u2066${pct.shown}%\u2069`}
          </AppText>
        </View>
        {pct.over && (
          <AppText variant="secondary" color="textSecondary" style={styles.tabular}>
            {`\u2066${pct.real}%\u2069`} من الهدف
          </AppText>
        )}
        {due && (
          <AppText variant="secondary" color="textSecondary">
            {sinking ? 'الاستحقاق القادم' : 'الموعد'}: {formatDateAr(due)} · {monthsLeftPhrase(monthsUntil(due, now))}
          </AppText>
        )}
      </Card>

      {/* ── Next step ── */}
      {step.tone === 'attention' ? (
        <InsightCard tone="attention" message={step.text} />
      ) : (
        <Card variant="subtle" style={styles.step}>
          <MaterialIcons
            name={step.tone === 'ok' ? 'check-circle-outline' : 'schedule'}
            size={20}
            color={step.tone === 'ok' ? colors.primary700 : colors.textSecondary}
          />
          <AppText variant="secondary" style={styles.flex}>
            {step.text}
          </AppText>
        </Card>
      )}

      {/* ── Actions: one primary ── */}
      <View style={styles.actions}>
        {sinking ? (
          <>
            <Button label="اتدفعت" block onPress={() => setSheet('pay')} />
            <Button label="إضافة مبلغ" variant="secondary" block onPress={() => setSheet('allocate')} />
            <Button label="سحب مبلغ" variant="tertiary" onPress={() => setSheet('withdraw')} />
          </>
        ) : (
          <>
            <Button label="إضافة مبلغ" block onPress={() => setSheet('allocate')} />
            <Button label="سحب مبلغ" variant="secondary" block onPress={() => setSheet('withdraw')} />
          </>
        )}
      </View>

      {/* ── Facts ── */}
      <ListGroup>
        {facts.map((f) => (
          <ListRow
            key={f.label}
            title={f.label}
            trailing={
              <AppText variant="bodyStrong" align="left" style={styles.tabular}>
                {f.value}
              </AppText>
            }
          />
        ))}
      </ListGroup>

      {/* ── Linked gold ── */}
      {(linkedHoldings.length > 0 || canLinkGold) && (
        <View>
          <SectionHeader
            title="الذهب المربوط"
            {...(canLinkGold ? { actionLabel: 'ربط ذهب', onAction: () => setSheet('edit') } : {})}
          />
          {linkedHoldings.length > 0 && (
            <ListGroup>
              {linkedHoldings.map((h) => (
                <ListRow
                  key={h.id}
                  title={h.name}
                  icon="diamond"
                  iconTone="gold"
                  trailing={
                    <AppText variant="moneyRow" color="goldText" align="left" style={styles.tabular}>
                      {formatMoney(holdingValueEGP(state, h), 'EGP')}
                    </AppText>
                  }
                />
              ))}
            </ListGroup>
          )}
        </View>
      )}

      {/* ── Movements (last) ── */}
      <View>
        <SectionHeader title="الحركات" />
        {movements.length === 0 ? (
          <AppText variant="secondary" color="textSecondary">
            لسه مفيش حركات.
          </AppText>
        ) : (
          <ListGroup>
            {movements.map((m) => {
              const kind = movementKind(m);
              return (
                <ListRow
                  key={m.id}
                  title={kind === 'allocation' ? 'إضافة' : kind === 'payment' ? 'اتدفعت' : 'سحب'}
                  subtitle={[formatDateAr(m.date), kind === 'payment' ? null : m.note].filter(Boolean).join(' · ')}
                  subtitleLines={1}
                  icon={kind === 'allocation' ? 'south-west' : kind === 'payment' ? 'receipt-long' : 'north-east'}
                  iconTone={kind === 'allocation' ? 'ok' : 'neutral'}
                  trailing={
                    <Money
                      amount={m.amount}
                      currency={fund.currency}
                      showSign
                      align="left"
                      tone={kind === 'allocation' ? 'positive' : kind === 'payment' ? 'muted' : 'default'}
                    />
                  }
                />
              );
            })}
          </ListGroup>
        )}
      </View>

      {sheet === 'edit' && <FundSheet fund={fund} onClose={() => setSheet(null)} onDeleted={() => router.back()} />}
      {(sheet === 'allocate' || sheet === 'withdraw') && (
        <MoveMoneySheet fund={fund} mode={sheet} onClose={() => setSheet(null)} />
      )}
      {sheet === 'pay' && <PaySinkingSheet fund={fund} onClose={() => setSheet(null)} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.xl },
  missing: { alignItems: 'center', justifyContent: 'center' },
  hero: { gap: space.sm },
  typeRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.xs },
  amounts: { flexDirection: 'row-reverse', alignItems: 'baseline', flexWrap: 'wrap', gap: space.sm },
  statusRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  chips: { flexDirection: 'row-reverse', gap: space.xs },
  tabular: { fontVariant: ['tabular-nums'] },
  step: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.md },
  flex: { flex: 1 },
  actions: { gap: space.sm, alignItems: 'center' },
});
