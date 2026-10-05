import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Money } from '@/components/ui/Money';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { colors, opacity, radius, space } from '@/constants/theme';
import { monthSummary } from '@/store/selectors';
import type { FinanceState } from '@/store/types';
import { toMonthKey } from '@/utils/dates';

// "هذا الشهر": income / expense / net for the current month (EGP, snapshot rates) in one
// grouped surface. Expense is plain text, not red; net is green with "+" when ≥ 0.
export function MonthlySnapshot({ state, now = new Date() }: { state: FinanceState; now?: Date }) {
  const summary = monthSummary(state, toMonthKey(now));
  const openTransactions = () => router.push('/transactions');
  const net = summary.netCashFlow;

  return (
    <View>
      <SectionHeader title="هذا الشهر" actionLabel="كل المعاملات" onAction={openTransactions} />
      <Pressable
        onPress={openTransactions}
        accessibilityRole="button"
        accessibilityLabel="ملخص الشهر، يفتح المعاملات"
        style={({ pressed }) => [styles.group, pressed && { opacity: opacity.pressed }]}>
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
