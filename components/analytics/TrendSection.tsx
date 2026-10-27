import { StyleSheet, View } from 'react-native';
import { BarChart } from 'react-native-gifted-charts';

import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { ListGroup, ListRow } from '@/components/ui/ListRow';
import { Money } from '@/components/ui/Money';
import { colors, space, type as typeScale } from '@/constants/theme';
import type { DisplayCurrency, MonthlyTrend } from '@/store/analytics';
import { formatMonthLabel, formatPercent } from '@/utils/formatters';

import { chartAxis, compactNumber, monthShort } from './analyticsUi';
import { ChartCard, EmptyNote, LegendDot, LegendRow, NOT_ENOUGH_DATA, useMeasuredWidth } from './common';

const Y_AXIS_WIDTH = 38;
const CHART_HEIGHT = 170;

// Income vs spending per month as grouped bars with the net as a line, and under it each month's
// numbers with its savings rate.
export function TrendSection({ trend, currency }: { trend: MonthlyTrend; currency: DisplayCurrency }) {
  const [width, onLayout] = useMeasuredWidth();
  const hasData = trend.months.some((m) => m.income > 0 || m.expense > 0);
  if (!hasData) return <EmptyNote>{NOT_ENOUGH_DATA}</EmptyNote>;

  const months = trend.months;
  const max = Math.max(...months.flatMap((m) => [m.income, m.expense, m.net]), 0);
  const min = Math.min(...months.map((m) => m.net), 0);
  const axis = chartAxis(min, max);

  // Bars: two per month with a gap between months; the net line sits on each group's centre.
  const inner = Math.max(0, width - Y_AXIS_WIDTH - 12);
  const pitch = inner / months.length;
  const barWidth = Math.max(6, Math.min(22, Math.floor(pitch * 0.32)));
  const pair = 4;
  const gap = Math.max(4, pitch - barWidth * 2 - pair);
  const data = months.flatMap((m) => [
    {
      value: m.income,
      frontColor: colors.primary,
      spacing: pair,
      label: monthShort(m.month),
      labelWidth: barWidth * 2 + pair,
      labelTextStyle: { color: colors.textSecondary, fontSize: typeScale.micro.fontSize },
    },
    { value: m.expense, frontColor: colors.chartSky, spacing: gap },
  ]);
  const lineData = months.map((m) => ({ value: m.net }));

  return (
    <View style={styles.wrap}>
      <ChartCard>
      <View onLayout={onLayout} accessibilityLabel="الدخل والمصروف والصافي لكل شهر">
        {width > 0 && (
          <BarChart
            data={data}
            width={inner}
            height={CHART_HEIGHT}
            barWidth={barWidth}
            initialSpacing={gap / 2}
            endSpacing={0}
            spacing={pair}
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
            barBorderRadius={3}
            disableScroll
            isAnimated={false}
            showLine
            lineData={lineData}
            lineConfig={{
              color: colors.text,
              thickness: 2,
              // gifted-charts adds half a bar to the first point and a bar to each step.
              initialSpacing: gap / 2 + barWidth / 2 + pair / 2,
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
        <LegendDot color="primary700" label="دخل" />
        <LegendDot color="chartSky" label="مصروف" />
        <LegendDot color="text" label="الصافي" />
      </LegendRow>
      </ChartCard>

      <Card variant="subtle" style={styles.average}>
        <AppText variant="secondary" color="textSecondary">
          متوسط معدل التحويش
        </AppText>
        <AppText variant="bodyStrong">
          {trend.averageSavingsRate === null ? '—' : formatPercent(trend.averageSavingsRate)}
        </AppText>
      </Card>

      <ListGroup>
        {[...months].reverse().map((m) => (
          <ListRow
            key={m.month}
            title={formatMonthLabel(m.month)}
            subtitle={`معدل التحويش: ${m.savingsRate === null ? '—' : formatPercent(m.savingsRate)}`}
            subtitleLines={1}
            trailing={
              <View style={styles.numbers}>
                <Money amount={m.net} currency={currency} size="row" showSign tone={m.net >= 0 ? 'positive' : 'default'} align="left" />
                <AppText variant="caption" color="textSecondary" align="left">
                  {compactNumber(m.income)} − {compactNumber(m.expense)}
                </AppText>
              </View>
            }
          />
        ))}
      </ListGroup>
    </View>
  );
}

const styles = StyleSheet.create({
  // Centred on the point (the library puts a custom point's corner on it).
  dot: { width: 8, height: 8, borderRadius: 4, marginLeft: -4, marginTop: -4 },
  wrap: { gap: space.md },
  average: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  numbers: { alignItems: 'flex-start' },
});
