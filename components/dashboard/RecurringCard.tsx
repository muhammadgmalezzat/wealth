import { router } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { Colors, FinanceColors } from '@/constants/theme';
import { dueOccurrences, upcoming } from '@/store/recurring';
import type { FinanceState } from '@/store/types';
import { toDateKey } from '@/utils/dates';
import { formatCurrency, formatDayLabel } from '@/utils/formatters';

// Dashboard: "عندك X مستحقات" (→ inbox) and a "جاي الأسبوع ده" line with the next 3 items.
// Renders nothing when there's neither.
export function RecurringCard({ state }: { state: FinanceState }) {
  const today = toDateKey(new Date());
  const due = dueOccurrences(state, today, 'confirm');
  const week = upcoming(state, 7, today).items.slice(0, 3);
  if (due.length === 0 && week.length === 0) return null;

  return (
    <View style={styles.wrap}>
      {due.length > 0 && (
        <TouchableOpacity onPress={() => router.push('/due')} activeOpacity={0.85}>
          <Card style={styles.dueCard}>
            <Text style={styles.dueAction}>افتح ‹</Text>
            <Text style={styles.dueText}>عندك {due.length} مستحقات</Text>
          </Card>
        </TouchableOpacity>
      )}
      {week.length > 0 && (
        <TouchableOpacity onPress={() => router.push('/recurring')} activeOpacity={0.8}>
          <Text style={styles.week}>
            جاي الأسبوع ده:{' '}
            {week.map(({ rule, date }) => `${rule.name} ${formatCurrency(rule.amount, rule.currency)} (${formatDayLabel(date)})`).join('، ')}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  dueCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: FinanceColors.gold + '18',
    borderWidth: 1,
    borderColor: FinanceColors.gold + '55',
  },
  dueText: { fontSize: 16, fontWeight: '700', color: Colors.light.text },
  dueAction: { fontSize: 14, fontWeight: '700', color: FinanceColors.gold },
  week: { fontSize: 12, color: Colors.light.icon, textAlign: 'right', lineHeight: 18 },
});
