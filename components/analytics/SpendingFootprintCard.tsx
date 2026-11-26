import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { formatMoney } from '@/components/ui/formatMoney';
import { Money } from '@/components/ui/Money';
import { colors, opacity, radius, space } from '@/constants/theme';
import type { FootprintSegment, SpendingFootprint } from '@/store/cashflowCharts';
import type { Bucket } from '@/store/types';

import { categoryIcon, FOOTPRINT_COLORS, FOOTPRINT_REST_COLOR } from './categoryIcons';
import { changeLine, restLabel, shareText } from './overviewUi';

interface SpendingFootprintCardProps {
  footprint: SpendingFootprint;
  currency: string;
  category: (id: string) => { name: string; bucket: Bucket | undefined };
  onOpen: (segment: FootprintSegment, topIds: string[]) => void;
  context: { trackingStart?: string; dailySince?: string | null };
}

// «بصمة الإنفاق»: one bar of the period's spending by category (top 4 + «باقي الفئات», largest on the right), then a tile
// per part with its share, amount and change. Shares add up to 100 % and amounts to the spending card.
export function SpendingFootprintCard({ footprint, currency, category, onOpen, context }: SpendingFootprintCardProps) {
  if (footprint.segments.length === 0) {
    return (
      <Card variant="subtle">
        <AppText variant="secondary" color="textSecondary" align="center">
          {footprint.total === null ? 'مفيش بيانات متسجّلة في الفترة دي.' : 'مفيش مصروف في الفترة دي.'}
        </AppText>
      </Card>
    );
  }
  const topIds = footprint.segments.filter((s) => s.key !== 'rest').map((s) => s.key);
  const colorOf = (i: number, s: FootprintSegment) => (s.key === 'rest' ? FOOTPRINT_REST_COLOR : FOOTPRINT_COLORS[i]);
  const label = (s: FootprintSegment) => (s.key === 'rest' ? restLabel(s.categoryIds.length) : category(s.key).name);

  return (
    <View style={styles.wrap}>
      <View
        style={styles.bar}
        accessibilityLabel={`بصمة الإنفاق: ${footprint.segments.map((s) => `${label(s)} ${shareText(s.tenths)}`).join('، ')}`}>
        {footprint.segments.map((s, i) => (
          <View key={s.key} style={{ flex: s.amount, backgroundColor: colors[colorOf(i, s)] }} />
        ))}
      </View>
      <View style={styles.grid}>
        {footprint.segments.map((s, i) => {
          const line = s.change.delta === null ? null : changeLine(s.change, currency, context);
          return (
            <Pressable
              key={s.key}
              onPress={() => onOpen(s, topIds)}
              accessibilityRole="button"
              accessibilityLabel={`${label(s)}: ${shareText(s.tenths)}، ${formatMoney(s.amount, currency)}`}
              style={({ pressed }) => [styles.cell, pressed && styles.pressed]}>
              <Card style={styles.tile}>
                <View style={styles.head}>
                  <View style={[styles.icon, { backgroundColor: colors[colorOf(i, s)] }]}>
                    <MaterialIcons name={s.key === 'rest' ? 'more-horiz' : categoryIcon(s.key, category(s.key).bucket)} size={16} color={colors.onPrimary} />
                  </View>
                  <AppText variant="caption" numberOfLines={1} style={styles.flex}>
                    {label(s)}
                  </AppText>
                  <AppText variant="bodyStrong">{shareText(s.tenths)}</AppText>
                </View>
                <Money amount={s.amount} currency={currency} size="row" />
                {line && (
                  <AppText variant="micro" color={line.color}>
                    {line.text}
                  </AppText>
                )}
              </Card>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  // Largest first, on the right (reading order).
  bar: { flexDirection: 'row-reverse', height: 14, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: colors.progressTrack },
  grid: { flexDirection: 'row-reverse', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: space.sm },
  cell: { width: '49%' },
  pressed: { opacity: opacity.pressed },
  tile: { gap: space.xxs, padding: space.md },
  head: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.xs },
  icon: { width: 24, height: 24, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
});
