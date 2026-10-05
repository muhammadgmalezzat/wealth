import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Money } from '@/components/ui/Money';
import { formatMoney } from '@/components/ui/formatMoney';
import { StatusChip } from '@/components/ui/StatusChip';
import { opacity, space } from '@/constants/theme';
import { overspentLines, planFor, safeToSpend, safeToSpendToday } from '@/store/planning';
import type { FinanceState } from '@/store/types';
import { toMonthKey } from '@/utils/dates';

// "تقدر تصرف بأمان": what's left on flexible plan lines this month, and per day. Without a
// plan it invites the user to make one (never a 0 or an empty metric).
export function SafeToSpendCard({ state, now = new Date() }: { state: FinanceState; now?: Date }) {
  const month = toMonthKey(now);
  const plan = planFor(state, month);

  if (!plan) {
    return (
      <Card variant="hero" style={styles.card}>
        <AppText variant="secondary" color="textSecondary">
          تقدر تصرف بأمان
        </AppText>
        <AppText variant="body">اعمل خطة الشهر عشان نقدر نحسب المبلغ الآمن للصرف.</AppText>
        <View style={styles.cta}>
          <Button label="اعمل خطة الشهر" onPress={() => router.push('/plan')} />
        </View>
      </Card>
    );
  }

  const safe = safeToSpend(state, month) ?? 0;
  const perDay = safeToSpendToday(state, month, now) ?? 0;
  const overspent = overspentLines(state, month);
  const names = overspent.map((l) => state.categories.find((c) => c.id === l.categoryId)?.name ?? '—');

  return (
    <Pressable
      onPress={() => router.push('/plan')}
      accessibilityRole="button"
      accessibilityHint="يفتح الخطة"
      style={({ pressed }) => pressed && { opacity: opacity.pressed }}>
      <Card variant="hero" style={styles.card}>
        <AppText variant="secondary" color="textSecondary">
          تقدر تصرف بأمان
        </AppText>
        <Money amount={safe} currency={plan.currency} size="hero" />
        <AppText variant="secondary" color="textSecondary">
          حتى نهاية الشهر · حوالي {formatMoney(perDay, plan.currency)} يومياً
        </AppText>
        <View style={styles.status}>
          {names.length === 0 ? (
            <StatusChip tone="ok" label="خطتك ماشية كويس" icon="check" />
          ) : (
            <>
              <StatusChip tone="attention" label="في بند محتاج انتباه" icon="info-outline" />
              <AppText variant="secondary">صرف {names.join('، ')} عدى الخطة</AppText>
            </>
          )}
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.xs },
  status: { marginTop: space.md, gap: space.sm },
  cta: { marginTop: space.md },
});
