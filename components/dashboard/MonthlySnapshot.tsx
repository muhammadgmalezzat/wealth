import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { MetricGroup, type Metric } from '@/components/ui/MetricGroup';
import { Money } from '@/components/ui/Money';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { opacity, space } from '@/constants/theme';
import { monthFlows, monthSummary } from '@/store/selectors';
import type { FinanceState } from '@/store/types';
import { toMonthKey } from '@/utils/dates';
import { formatMonthLabel } from '@/utils/formatters';

interface MonthlySnapshotProps {
  state: FinanceState;
  now?: Date;
  // Another month (Transactions screen); defaults to the current one.
  month?: string;
  // Home links to the Transactions tab; the Transactions screen itself doesn't.
  linkToTransactions?: boolean;
}

const money = (amount: number, showSign = false) => (
  <Money
    amount={amount}
    currency="EGP"
    size="row"
    align="center"
    showSign={showSign}
    tone={showSign && amount >= 0 ? 'positive' : 'default'}
  />
);

// "هذا الشهر" (EGP, snapshot rates). Transactions: income / expense / net in one MetricGroup —
// expense is plain text, not red; net is green with "+" when ≥ 0. Home: where the money went —
// income / spent, then saved to funds / invested (asset purchases), two cells per row.
export function MonthlySnapshot({ state, now = new Date(), month, linkToTransactions = true }: MonthlySnapshotProps) {
  const current = toMonthKey(now);
  const shown = month ?? current;

  if (!linkToTransactions) {
    const summary = monthSummary(state, shown);
    const metrics: Metric[] = [
      { label: 'دخل', value: money(summary.incomeEGP) },
      { label: 'مصروف', value: money(summary.expenseEGP) },
      { label: 'صافي', value: money(summary.netCashFlow, true) },
    ];
    return (
      <MetricGroup metrics={metrics} accessibilityLabel={`ملخص ${shown === current ? 'هذا الشهر' : formatMonthLabel(shown)}`} />
    );
  }

  const flows = monthFlows(state, shown);
  const openTransactions = () => router.push('/transactions');
  return (
    <View>
      <SectionHeader title="هذا الشهر" actionLabel="كل المعاملات" onAction={openTransactions} />
      <Pressable
        onPress={openTransactions}
        accessibilityRole="button"
        accessibilityLabel="ملخص الشهر، يفتح المعاملات"
        style={({ pressed }) => [styles.rows, pressed && { opacity: opacity.pressed }]}>
        <MetricGroup
          metrics={[
            { label: 'دخل', value: money(flows.incomeEGP) },
            { label: 'مصروف', value: money(flows.expenseEGP) },
          ]}
        />
        <MetricGroup
          metrics={[
            { label: 'اتحوّش للصناديق', value: money(flows.savedToFundsEGP) },
            { label: 'استثمار', value: money(flows.investedEGP), tone: 'gold' },
          ]}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  rows: { gap: space.sm },
});
