import { useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { KIND_SECTION_TITLES, MODE_LABELS, frequencyLabel } from '@/components/recurring/labels';
import { ruleState } from '@/components/recurring/recurringUi';
import { RuleSheet } from '@/components/recurring/RuleSheet';
import { AppText } from '@/components/ui/AppText';
import { EmptyState } from '@/components/ui/EmptyState';
import { Fab, FAB_CLEARANCE } from '@/components/ui/Fab';
import { formatDateAr } from '@/components/ui/formatDateAr';
import { formatMoney } from '@/components/ui/formatMoney';
import { ListGroup, ListRow } from '@/components/ui/ListRow';
import { LoadingView } from '@/components/ui/LoadingView';
import { MetricGroup } from '@/components/ui/MetricGroup';
import { Money } from '@/components/ui/Money';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { StatusChip } from '@/components/ui/StatusChip';
import { colors, opacity, space } from '@/constants/theme';
import { upcoming, type CurrencyTotals } from '@/store/recurring';
import type { CurrencyCode, RecurringRule } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { toDateKey } from '@/utils/dates';
import { formatDayLabel } from '@/utils/formatters';
import { runAction } from '@/utils/runAction';

const KINDS: RecurringRule['kind'][] = ['income', 'expense', 'transfer'];

// Per-currency totals as one line ("ر.س 9,000 + ج.م 1,200"), or "—".
const totalsLine = (totals: CurrencyTotals) =>
  (Object.entries(totals) as [CurrencyCode, number][])
    .filter(([, v]) => v > 0)
    .map(([currency, v]) => formatMoney(v, currency))
    .join(' + ') || '—';

// "What will happen again?": the next 30 days (with totals), then rules by kind.
export default function RecurringScreen() {
  const state = useFinanceStore();
  const [sheet, setSheet] = useState<'add' | { id: string } | null>(null);

  if (!state.hasHydrated) return <LoadingView />;

  const today = toDateKey(new Date());
  const next30 = upcoming(state, 30, today);
  const editing = sheet && sheet !== 'add' ? state.recurringRules.find((r) => r.id === sheet.id) : undefined;
  const accountName = (id?: string) => state.accounts.find((a) => a.id === id)?.name ?? '—';

  return (
    <Screen
      scroll
      edges={['bottom']}
      contentStyle={styles.content}
      overlay={<Fab placement="stack" onPress={() => setSheet('add')} accessibilityLabel="معاملة متكررة جديدة" />}>
      {state.recurringRules.length === 0 ? (
        <EmptyState
          icon="repeat"
          title="مفيش معاملات متكررة."
          body="سجّل الإيجار أو المرتب مرة واحدة، والتطبيق يفكرك بيهم."
          actionLabel="أضف معاملة متكررة"
          onAction={() => setSheet('add')}
        />
      ) : (
        <>
          {/* ── Next 30 days ── */}
          <View style={styles.block}>
            <SectionHeader title="جاي خلال 30 يوم" />
            {next30.items.length === 0 ? (
              <AppText variant="secondary" color="textSecondary">
                مفيش حاجة جاية.
              </AppText>
            ) : (
              <>
                <ListGroup>
                  {next30.items.slice(0, 12).map(({ rule, date }) => (
                    <ListRow
                      key={`${rule.id}-${date}`}
                      title={rule.name}
                      subtitle={formatDayLabel(date)}
                      subtitleLines={1}
                      trailing={<RuleAmount rule={rule} />}
                      onPress={() => setSheet({ id: rule.id })}
                    />
                  ))}
                </ListGroup>
                <MetricGroup
                  metrics={[
                    {
                      label: 'دخل',
                      value: (
                        <AppText variant="moneyRow" align="center">
                          {totalsLine(next30.income)}
                        </AppText>
                      ),
                    },
                    {
                      label: 'مصروف',
                      value: (
                        <AppText variant="moneyRow" align="center">
                          {totalsLine(next30.expense)}
                        </AppText>
                      ),
                    },
                  ]}
                />
              </>
            )}
          </View>

          {/* ── Rules by kind ── */}
          {KINDS.map((kind) => {
            const rules = state.recurringRules.filter((r) => r.kind === kind);
            if (rules.length === 0) return null;
            return (
              <View key={kind}>
                <SectionHeader title={KIND_SECTION_TITLES[kind]} />
                <ListGroup>
                  {rules.map((rule) => {
                    const st = ruleState(rule);
                    const accounts =
                      kind === 'transfer'
                        ? `من ${accountName(rule.accountId)} إلى ${accountName(rule.toAccountId)}`
                        : accountName(rule.accountId);
                    const next = st === 'active' ? `الجاية: ${formatDateAr(rule.nextDate, { year: false })}` : null;
                    return (
                      // The switch is a sibling of the tappable area, so toggling it never opens the sheet.
                      <View key={rule.id} style={styles.ruleRow}>
                        <Pressable
                          onPress={() => setSheet({ id: rule.id })}
                          accessibilityRole="button"
                          accessibilityLabel={`${rule.name}، ${formatMoney(rule.amount, rule.currency)}`}
                          style={({ pressed }) => [styles.ruleTap, pressed && styles.pressed]}>
                          <View style={styles.flex}>
                            <View style={styles.line}>
                              <AppText
                                variant="bodyStrong"
                                color={st === 'active' ? 'text' : 'textMuted'}
                                numberOfLines={1}
                                style={styles.flex}>
                                {rule.name}
                              </AppText>
                              <RuleAmount rule={rule} />
                            </View>
                            <AppText variant="secondary" color="textSecondary" numberOfLines={2}>
                              {[frequencyLabel(rule), accounts, next].filter(Boolean).join(' · ')}
                            </AppText>
                            <View style={styles.chips}>
                              <StatusChip label={MODE_LABELS[rule.mode]} tone="neutral" />
                              {st === 'paused' && <StatusChip label="متوقف" tone="neutral" />}
                              {st === 'ended' && <StatusChip label="انتهى" tone="neutral" />}
                            </View>
                          </View>
                        </Pressable>
                        <Switch
                          value={rule.active}
                          onValueChange={(active) => {
                            runAction('تعذّر التعديل', () => state.setRecurringActive(rule.id, active));
                          }}
                          trackColor={{
                            true: colors.primary600,
                            false: colors.borderStrong,
                          }}
                          thumbColor={colors.surface}
                          accessibilityLabel={rule.active ? `إيقاف ${rule.name}` : `تشغيل ${rule.name}`}
                          style={styles.switch}
                        />
                      </View>
                    );
                  })}
                </ListGroup>
              </View>
            );
          })}
        </>
      )}

      {sheet === 'add' && <RuleSheet onClose={() => setSheet(null)} />}
      {editing && <RuleSheet key={editing.id} rule={editing} onClose={() => setSheet(null)} />}
    </Screen>
  );
}

// Expenses and transfers in the text color, income green with "+"; "تقريباً" for variable amounts.
function RuleAmount({ rule }: { rule: RecurringRule }) {
  const income = rule.kind === 'income';
  return (
    <View style={styles.amount}>
      {rule.variableAmount && (
        <AppText variant="caption" color="textSecondary">
          تقريباً
        </AppText>
      )}
      <Money
        amount={rule.amount}
        currency={rule.currency}
        tone={income ? 'positive' : 'default'}
        showSign={income}
        align="left"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, paddingBottom: FAB_CLEARANCE, gap: space.md },
  block: { gap: space.md },
  flex: { flex: 1 },
  // RTL: details on the right, switch on the left.
  ruleRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    minHeight: 64,
  },
  ruleTap: {
    flex: 1,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    padding: space.lg,
  },
  switch: { marginLeft: space.lg },
  pressed: { backgroundColor: colors.surfaceSubtle, opacity: opacity.pressed },
  line: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.sm },
  chips: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: space.xs,
    marginTop: space.xs,
  },
  amount: {
    flexDirection: 'row-reverse',
    alignItems: 'baseline',
    gap: space.xs,
  },
});
