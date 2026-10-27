import { StyleSheet, Switch, View } from 'react-native';
import { BarChart } from 'react-native-gifted-charts';

import { AppText } from '@/components/ui/AppText';
import { Money } from '@/components/ui/Money';
import { Segment } from '@/components/ui/Segment';
import { colors, space, type as typeScale } from '@/constants/theme';
import type { DisplayCurrency, NetWorthLocation, NetWorthSeries } from '@/store/analytics';

import { chartAxis, compactNumber, monthShort } from './analyticsUi';
import { ChartCard, EmptyNote, LegendDot, LegendRow, NOT_ENOUGH_DATA, useMeasuredWidth } from './common';

const Y_AXIS_WIDTH = 42;
const CHART_HEIGHT = 190;

const LOCATIONS: { label: string; value: NetWorthLocation }[] = [
  { label: 'الكل', value: 'all' },
  { label: 'مصر', value: 'EG' },
  { label: 'السعودية', value: 'SA' },
];

interface NetWorthSectionProps {
  series: NetWorthSeries;
  currency: DisplayCurrency;
  location: NetWorthLocation;
  onLocationChange: (location: NetWorthLocation) => void;
  hideEstimated: boolean;
  onHideEstimatedChange: (hide: boolean) => void;
}

// Net worth month by month (from the snapshots): stacked cash / gold / currencies with the net
// total as a line. Months worked out afterwards are marked with * (or hidden).
export function NetWorthSection({ series, currency, location, onLocationChange, hideEstimated, onHideEstimatedChange }: NetWorthSectionProps) {
  const [width, onLayout] = useMeasuredWidth();
  const { points } = series;
  const controls = (
    <View style={styles.controls}>
      <Segment<NetWorthLocation> options={LOCATIONS} value={location} onChange={onLocationChange} />
      <View style={styles.switchRow}>
        <AppText variant="secondary" style={styles.flex}>
          إخفاء الأرقام التقديرية
        </AppText>
        <Switch
          value={hideEstimated}
          onValueChange={onHideEstimatedChange}
          trackColor={{ true: colors.primary600, false: colors.borderStrong }}
          thumbColor={colors.text}
          accessibilityLabel="إخفاء الأرقام التقديرية"
        />
      </View>
    </View>
  );
  if (points.length < 2) {
    return (
      <View style={styles.wrap}>
        {controls}
        <EmptyNote>{NOT_ENOUGH_DATA}</EmptyNote>
      </View>
    );
  }

  const max = Math.max(...points.map((p) => Math.max(p.total, p.cash + p.gold + p.currencies)), 0);
  const min = Math.min(...points.map((p) => p.total), 0);
  const axis = chartAxis(min, max);
  const inner = Math.max(0, width - Y_AXIS_WIDTH - 12);
  const pitch = inner / points.length;
  const barWidth = Math.max(8, Math.min(30, Math.floor(pitch * 0.55)));
  const gap = Math.max(4, pitch - barWidth);
  const detailed = points.some((p) => p.cash + p.gold + p.currencies > 0);

  const stackData = points.map((p) => ({
    // Months without a breakdown (older snapshots) show their total as one neutral block.
    stacks:
      p.cash + p.gold + p.currencies > 0
        ? [
            { value: Math.max(0, p.cash), color: colors.primary },
            { value: Math.max(0, p.gold), color: colors.gold },
            { value: Math.max(0, p.currencies), color: colors.chartSky },
          ]
        : [{ value: Math.max(0, p.total), color: colors.textMuted }],
    label: `${monthShort(p.month)}${p.estimated ? '*' : ''}`,
    labelTextStyle: { color: colors.textSecondary, fontSize: typeScale.micro.fontSize },
    spacing: gap,
  }));
  const last = points[points.length - 1];

  return (
    <ChartCard>
      {controls}
      <View style={styles.now}>
        <AppText variant="secondary" color="textSecondary">
          الصافي دلوقتي
        </AppText>
        <Money amount={last.total} currency={currency} size="lg" />
      </View>
      <View onLayout={onLayout} accessibilityLabel="صافي الثروة عبر الشهور">
        {width > 0 && (
          <BarChart
            stackData={stackData}
            width={inner}
            height={CHART_HEIGHT}
            barWidth={barWidth}
            initialSpacing={gap / 2}
            endSpacing={0}
            maxValue={axis.step * axis.above}
            stepValue={axis.step}
            noOfSections={axis.above}
            noOfSectionsBelowXAxis={axis.below}
            mostNegativeValue={-axis.step * axis.below}
            negativeStepValue={axis.step}
            yAxisLabelWidth={Y_AXIS_WIDTH}
            yAxisThickness={0}
            xAxisThickness={1}
            xAxisColor={colors.borderStrong}
            rulesColor={colors.border}
            yAxisTextStyle={{ color: colors.textSecondary, fontSize: typeScale.micro.fontSize }}
            formatYLabel={(label: string) => compactNumber(Number(label))}
            barBorderRadius={2}
            disableScroll
            isAnimated={false}
            showLine
            lineData={points.map((p) => ({ value: p.total }))}
            lineConfig={{
              color: colors.text,
              thickness: 2,
              // gifted-charts adds half a bar to the first point and a bar to each step.
              initialSpacing: gap / 2,
              spacing: pitch - barWidth,
              // Plain views for the points: gifted-charts' SVG circles log a dev warning on the web.
              dataPointsWidth: 8,
              dataPointsHeight: 8,
              customDataPoint: () => <View style={[styles.dot, { backgroundColor: colors.text }]} />,
              curved: false,
            }}
          />
        )}
      </View>
      <LegendRow>
        {detailed && (
          <>
            <LegendDot color="primary700" label="كاش" />
            <LegendDot color="gold" label="ذهب" />
            <LegendDot color="chartSky" label="عملات" />
          </>
        )}
        <LegendDot color="text" label="الصافي بعد الالتزامات" />
      </LegendRow>
      {series.estimatedCount > 0 && (
        <AppText variant="caption" color="textSecondary">
          * رقم تقديري اتحسب بعد الشهر ده بأسعار الذهب والصرف وقتها.
        </AppText>
      )}
      {series.skipped > 0 && (
        <AppText variant="caption" color="textSecondary">
          {series.skipped} شهر قديم من غير تفاصيل مش ظاهر في العرض ده.
        </AppText>
      )}
    </ChartCard>
  );
}

const styles = StyleSheet.create({
  // Centred on the point (the library puts a custom point's corner on it).
  dot: { width: 8, height: 8, borderRadius: 4, marginLeft: -4, marginTop: -4 },
  wrap: { gap: space.md },
  controls: { gap: space.sm },
  switchRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.sm, minHeight: 44 },
  flex: { flex: 1 },
  now: { gap: space.xxs },
});
