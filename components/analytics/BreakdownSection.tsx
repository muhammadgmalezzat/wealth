import { StyleSheet, View } from 'react-native';
import { PieChart } from 'react-native-gifted-charts';

import { AppText } from '@/components/ui/AppText';
import { ListGroup, ListRow } from '@/components/ui/ListRow';
import { Money } from '@/components/ui/Money';
import { colors, space, type as typeScale } from '@/constants/theme';
import { BUCKET_LABELS, type DisplayCurrency, type DrillFilter, type SpendingBreakdown } from '@/store/analytics';
import { formatPercent } from '@/utils/formatters';

import { changeText, compactNumber, FLOW_COLOR } from './analyticsUi';
import { ChartCard, EmptyNote, LegendDot, LegendRow, NOT_ENOUGH_DATA, useMeasuredWidth } from './common';

interface BreakdownSectionProps {
  breakdown: SpendingBreakdown;
  currency: DisplayCurrency;
  onDrill: (filter: DrillFilter) => void;
}

// Spending by bucket as a donut, then every category ranked with its share, amount and the
// change against the previous equal period (↑ amber when it grew, ↓ green when it shrank).
export function BreakdownSection({ breakdown, currency, onDrill }: BreakdownSectionProps) {
  const [width, onLayout] = useMeasuredWidth();
  if (breakdown.total <= 0) return <EmptyNote>{NOT_ENOUGH_DATA}</EmptyNote>;

  // gifted-charts draws the donut a bit larger than its radius, so keep it modest.
  const radius = Math.max(50, Math.min(width * 0.26, 90));
  const slices = breakdown.buckets.map((b) => ({
    value: b.amount,
    color: colors[FLOW_COLOR[b.bucket]],
    onPress: () => onDrill({ type: 'expense', bucket: b.bucket }),
  }));

  return (
    <View style={styles.wrap}>
      <ChartCard>
      <View onLayout={onLayout} style={styles.donut} accessibilityLabel="المصروف حسب النوع">
        {width > 0 && (
          <PieChart
            donut
            data={slices}
            radius={radius}
            innerRadius={radius * 0.62}
            innerCircleColor={colors.surface}
            isAnimated={false}
            centerLabelComponent={() => (
              <View style={styles.center}>
                <AppText variant="caption" color="textSecondary" align="center">
                  المصروف
                </AppText>
                <AppText variant="bodyStrong" align="center" style={styles.tabular}>
                  {compactNumber(breakdown.total)}
                </AppText>
              </View>
            )}
          />
        )}
      </View>
      <LegendRow>
        {breakdown.buckets.map((b) => (
          <LegendDot key={b.bucket} color={FLOW_COLOR[b.bucket]} label={`${BUCKET_LABELS[b.bucket]} ${formatPercent(b.pct)}`} />
        ))}
      </LegendRow>
      </ChartCard>

      <ListGroup>
        {breakdown.categories.map((c) => {
          const change = changeText(c);
          return (
            <ListRow
              key={c.categoryId}
              title={c.name}
              subtitle={`${BUCKET_LABELS[c.bucket]} · ${formatPercent(c.pct)}`}
              subtitleLines={1}
              trailing={
                <View style={styles.amount}>
                  <Money amount={c.amount} currency={currency} size="row" align="left" />
                  {change && (
                    <AppText variant="caption" color={change.color} align="left" style={styles.tabular}>
                      {change.text}
                    </AppText>
                  )}
                </View>
              }
              chevron
              onPress={() => onDrill({ type: 'expense', categoryIds: [c.categoryId] })}
              accessibilityLabel={`${c.name}، ${formatPercent(c.pct)}`}
            />
          );
        })}
      </ListGroup>
      {!breakdown.comparable && (
        <AppText variant="caption" color="textSecondary">
          مفيش فترة سابقة متتبعة للمقارنة.
        </AppText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  donut: { alignItems: 'center' },
  center: { alignItems: 'center', gap: 0 },
  amount: { alignItems: 'flex-start' },
  tabular: { fontVariant: ['tabular-nums'], fontSize: typeScale.caption.fontSize },
});
