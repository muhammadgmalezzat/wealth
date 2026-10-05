import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { MetricGroup } from '@/components/ui/MetricGroup';
import { Money } from '@/components/ui/Money';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { opacity } from '@/constants/theme';
import { monthSummary } from '@/store/selectors';
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

// "هذا الشهر": income / expense / net for a month (EGP, snapshot rates) in one MetricGroup.
// Expense is plain text, not red; net is green with "+" when ≥ 0.
export function MonthlySnapshot({ state, now = new Date(), month, linkToTransactions = true }: MonthlySnapshotProps) {
  const current = toMonthKey(now);
  const shown = month ?? current;
  const summary = monthSummary(state, shown);
  const net = summary.netCashFlow;
  const metrics = [
    { label: 'دخل', value: <Money amount={summary.incomeEGP} currency="EGP" size="row" align="center" /> },
    { label: 'مصروف', value: <Money amount={summary.expenseEGP} currency="EGP" size="row" align="center" /> },
    {
      label: 'صافي',
      value: <Money amount={net} currency="EGP" size="row" align="center" showSign tone={net >= 0 ? 'positive' : 'default'} />,
    },
  ];

  if (!linkToTransactions) {
    return (
      <MetricGroup metrics={metrics} accessibilityLabel={`ملخص ${shown === current ? 'هذا الشهر' : formatMonthLabel(shown)}`} />
    );
  }

  const openTransactions = () => router.push('/transactions');
  return (
    <View>
      <SectionHeader title="هذا الشهر" actionLabel="كل المعاملات" onAction={openTransactions} />
      <Pressable
        onPress={openTransactions}
        accessibilityRole="button"
        accessibilityLabel="ملخص الشهر، يفتح المعاملات"
        style={({ pressed }) => pressed && { opacity: opacity.pressed }}>
        <MetricGroup metrics={metrics} />
      </Pressable>
    </View>
  );
}
