import { router } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { Colors, FinanceColors } from '@/constants/theme';
import { overspentLines, planFor, safeToSpend, safeToSpendToday } from '@/store/planning';
import type { FinanceState } from '@/store/types';
import { toMonthKey } from '@/utils/dates';
import { formatCurrency } from '@/utils/formatters';

// "تقدر تصرف بأمان": what's left on flexible plan lines this month, and per day. Without a
// plan it invites the user to make one.
export function SafeToSpendCard({ state }: { state: FinanceState }) {
  const month = toMonthKey(new Date());
  const plan = planFor(state, month);

  if (!plan) {
    return (
      <TouchableOpacity onPress={() => router.push('/plan')} activeOpacity={0.85}>
        <Card style={styles.cta}>
          <Text style={styles.ctaTitle}>اعمل خطة الشهر</Text>
          <Text style={styles.subtitle}>عشان تعرف تقدر تصرف قد إيه بأمان</Text>
        </Card>
      </TouchableOpacity>
    );
  }

  const safe = safeToSpend(state, month) ?? 0;
  const perDay = safeToSpendToday(state, month) ?? 0;
  const overspent = overspentLines(state, month);
  const names = overspent.map((l) => state.categories.find((c) => c.id === l.categoryId)?.name ?? '—');

  return (
    <TouchableOpacity onPress={() => router.push('/plan')} activeOpacity={0.85}>
      <Card>
        <Text style={styles.label}>تقدر تصرف بأمان</Text>
        <Text style={styles.amount}>{formatCurrency(safe, plan.currency)}</Text>
        <Text style={styles.subtitle}>≈ {formatCurrency(perDay, plan.currency)} في اليوم لحد آخر الشهر</Text>
        {names.length > 0 && (
          <View style={styles.overRow}>
            <Text style={styles.over}>عدّيت ميزانية: {names.join('، ')}</Text>
          </View>
        )}
      </Card>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 14,
    color: Colors.light.icon,
    textAlign: 'right',
  },
  amount: {
    marginTop: 4,
    fontSize: 30,
    fontWeight: '800',
    color: FinanceColors.income,
    textAlign: 'right',
  },
  subtitle: {
    marginTop: 4,
    fontSize: 13,
    color: Colors.light.icon,
    textAlign: 'right',
  },
  cta: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.light.tint,
  },
  ctaTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.light.tint,
    textAlign: 'right',
  },
  overRow: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: FinanceColors.progressTrack,
  },
  over: {
    fontSize: 13,
    fontWeight: '600',
    color: FinanceColors.expense,
    textAlign: 'right',
  },
});
