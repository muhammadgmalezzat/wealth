import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ConfirmOccurrenceSheet } from '@/components/recurring/ConfirmOccurrenceSheet';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListGroup } from '@/components/ui/ListRow';
import { LoadingView } from '@/components/ui/LoadingView';
import { Money } from '@/components/ui/Money';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { StatusChip } from '@/components/ui/StatusChip';
import { space } from '@/constants/theme';
import { blockedDue } from '@/store/operations';
import { dueOccurrences, type Occurrence } from '@/store/recurring';
import { useFinanceStore } from '@/store/useFinanceStore';
import { toDateKey } from '@/utils/dates';
import { formatDayLabel } from '@/utils/formatters';
import { runAction } from '@/utils/runAction';

// "What needs confirmation?": due occurrences of 'confirm' rules, oldest first — earlier months
// ("فات ومتسجلش", calm attention) apart from this month's. "تم" opens the confirm sheet; "تخطّي"
// skips the occurrence.
export default function DueScreen() {
  const state = useFinanceStore();
  const [confirming, setConfirming] = useState<{ ruleId: string; date: string } | null>(null);

  if (!state.hasHydrated) return <LoadingView />;

  const today = toDateKey(new Date());
  const items = dueOccurrences(state, today, 'confirm');
  // Automatic items that were NOT recorded because they would eat into reserved money: still due, flagged.
  const needCover: Occurrence[] = blockedDue(state, { newId: () => 'preview', now: () => new Date() }).flatMap((b) => {
    const rule = state.recurringRules.find((r) => r.id === b.ruleId);
    return rule ? [{ rule, date: b.date }] : [];
  });
  const thisMonth = today.slice(0, 7);
  const missed = items.filter((o) => o.date.slice(0, 7) < thisMonth);
  const current = items.filter((o) => o.date.slice(0, 7) >= thisMonth);
  const accountName = (id?: string) => state.accounts.find((a) => a.id === id)?.name ?? '—';
  const confirmRule = confirming && state.recurringRules.find((r) => r.id === confirming.ruleId);

  const row = ({ rule, date }: Occurrence, flagged = false) => (
    <View key={`${rule.id}-${date}`} style={styles.item}>
      <View style={styles.line}>
        <AppText variant="bodyStrong" numberOfLines={1} style={styles.flex}>
          {rule.name}
        </AppText>
        {rule.variableAmount && (
          <AppText variant="caption" color="textSecondary">
            تقريباً
          </AppText>
        )}
        <Money amount={rule.amount} currency={rule.currency} align="left" tone={rule.kind === 'income' ? 'positive' : 'default'} />
      </View>
      {flagged && <StatusChip label="محتاج تغطية" tone="attention" icon="savings" />}
      <AppText variant="secondary" color="textSecondary">
        {formatDayLabel(date)} · {accountName(rule.accountId)}
      </AppText>
      <View style={styles.actions}>
        <Button label="تم" onPress={() => setConfirming({ ruleId: rule.id, date })} />
        <Button
          label="تخطّي"
          variant="tertiary"
          onPress={() => runAction('تعذّر التخطي', () => state.skipOccurrence(rule.id, date))}
        />
      </View>
    </View>
  );

  return (
    <Screen scroll edges={['bottom']} contentStyle={styles.content}>
      {needCover.length > 0 && (
        <View>
          <SectionHeader title={`محتاج تغطية (${needCover.length})`} />
          <ListGroup>{needCover.map((o) => row(o, true))}</ListGroup>
        </View>
      )}
      {items.length === 0 && needCover.length === 0 ? (
        <>
          <EmptyState icon="inbox" title="مفيش حاجة مستنياك." body="كل المستحقات متسجلة." />
          <View style={styles.center}>
            <Button label="المعاملات المتكررة" variant="tertiary" onPress={() => router.push('/recurring')} />
          </View>
        </>
      ) : (
        <>
          {missed.length > 0 && (
            <View>
              <SectionHeader
                title={`فات ومتسجلش (${missed.length})`}
                trailing={<StatusChip label="فات ميعاده" tone="attention" icon="schedule" />}
              />
              <ListGroup>{missed.map((o) => row(o))}</ListGroup>
            </View>
          )}
          {current.length > 0 && (
            <View>
              <SectionHeader title={`المستحق الشهر ده (${current.length})`} />
              <ListGroup>{current.map((o) => row(o))}</ListGroup>
            </View>
          )}
        </>
      )}

      {confirmRule && confirming && (
        <ConfirmOccurrenceSheet
          key={`${confirming.ruleId}-${confirming.date}`}
          rule={confirmRule}
          occurrenceDate={confirming.date}
          onClose={() => setConfirming(null)}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.md },
  item: { padding: space.lg, gap: space.xs },
  line: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  // RTL: "تم" on the right (start), "تخطّي" after it.
  actions: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  center: { alignItems: 'center' },
});
