import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Money } from '@/components/ui/Money';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { colors, opacity, radius, space } from '@/constants/theme';
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

// "هذا الشهر": income / expense / net for a month (EGP, snapshot rates) in one grouped
// surface. Expense is plain text, not red; net is green with "+" when ≥ 0.
export function MonthlySnapshot({ state, now = new Date(), month, linkToTransactions = true }: MonthlySnapshotProps) {
  const current = toMonthKey(now);
  const shown = month ?? current;
  const summary = monthSummary(state, shown);
  const openTransactions = () => router.push('/transactions');
  const net = summary.netCashFlow;
  const cells = (
    <>
      <Cell label="دخل">
        <Money amount={summary.incomeEGP} currency="EGP" size="row" align="center" />
      </Cell>
      <View style={styles.divider} />
      <Cell label="مصروف">
        <Money amount={summary.expenseEGP} currency="EGP" size="row" align="center" />
      </Cell>
      <View style={styles.divider} />
      <Cell label="صافي">
        <Money amount={net} currency="EGP" size="row" align="center" showSign tone={net >= 0 ? 'positive' : 'default'} />
      </Cell>
    </>
  );

  if (!linkToTransactions) {
    return (
      <View style={styles.group} accessibilityLabel={`ملخص ${shown === current ? 'هذا الشهر' : formatMonthLabel(shown)}`}>
        {cells}
      </View>
    );
  }

  return (
    <View>
      <SectionHeader title="هذا الشهر" actionLabel="كل المعاملات" onAction={openTransactions} />
      <Pressable
        onPress={openTransactions}
        accessibilityRole="button"
        accessibilityLabel="ملخص الشهر، يفتح المعاملات"
        style={({ pressed }) => [styles.group, pressed && { opacity: opacity.pressed }]}>
        {cells}
      </Pressable>
    </View>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.cell}>
      <AppText variant="caption" color="textSecondary" align="center">
        {label}
      </AppText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  // RTL: دخل on the right.
  group: {
    flexDirection: 'row-reverse',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: space.md,
  },
  cell: { flex: 1, minWidth: 0, alignItems: 'center', gap: 2, paddingHorizontal: space.xs },
  divider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: space.xs },
});
