import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';

import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { formatDateAr } from '@/components/ui/formatDateAr';
import { formatMoney } from '@/components/ui/formatMoney';
import { colors, space, type as typeScale } from '@/constants/theme';
import type { CashflowChart } from '@/store/cashflowCharts';

import { compactNumber } from './analyticsUi';
import { EXPENSE_COLOR, INCOME_COLOR } from './categoryIcons';
import { LegendDot, LegendRow, useMeasuredWidth } from './common';
import { averagesLine, balanceCountLine, bucketLabel, bucketTitle, rateText } from './overviewUi';
import { groupedBars, slotAt } from './seriesLayout';

const PLOT_HEIGHT = 150;
const LABEL_HEIGHT = 22;

// «التدفق الشهري»: income vs spending per month (per week for a period of a month or less), oldest on the left like the
// other charts. The bar still running is faded with a dashed outline and labelled. Months before tracking are not drawn.
// Tap a bar for its numbers.
export function CashflowBars({ chart, currency }: { chart: CashflowChart; currency: string }) {
  const [width, onLayout] = useMeasuredWidth();
  const [selected, setSelected] = useState<number | null>(null);
  const buckets = chart.buckets;
  const layout = groupedBars(buckets, width, PLOT_HEIGHT);
  const shown = selected !== null ? buckets[selected] : buckets.find((b) => b.inProgress) ?? buckets[buckets.length - 1];
  const averages = averagesLine(chart, currency);
  const balance = balanceCountLine(chart);

  if (buckets.length === 0) {
    return (
      <Card variant="subtle">
        <AppText variant="secondary" color="textSecondary" align="center">
          مفيش أيام متسجّلة في الفترة دي.
        </AppText>
      </Card>
    );
  }

  return (
    <Card style={styles.card}>
      <LegendRow>
        <LegendDot color={INCOME_COLOR} label="الدخل" />
        <LegendDot color={EXPENSE_COLOR} label="المصروف" />
      </LegendRow>
      {chart.dataStart && (
        <AppText variant="caption" color="textSecondary">
          {`البيانات بتبدأ من ${formatDateAr(chart.dataStart)}`}
        </AppText>
      )}

      {shown && (
        <View style={styles.tooltip} accessibilityLiveRegion="polite">
          <AppText variant="caption" color="textSecondary">
            {bucketTitle(shown)}
          </AppText>
          <AppText variant="secondary">{`دخل ${formatMoney(shown.income, currency)} · مصروف ${formatMoney(shown.expense, currency)}`}</AppText>
          <AppText variant="caption" color="textSecondary">
            {`الصافي ${formatMoney(shown.net, currency, true)} · معدل التحويش ${shown.savingsRate === null ? 'مفيش دخل' : rateText(shown.savingsRate)}`}
          </AppText>
        </View>
      )}

      <View
        onLayout={onLayout}
        style={{ height: PLOT_HEIGHT + LABEL_HEIGHT }}
        accessibilityLabel={`الدخل والمصروف: ${buckets.length} ${chart.unit === 'month' ? 'شهر' : 'أسبوع'}`}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => setSelected(slotAt(e.nativeEvent.locationX, layout))}
        onResponderMove={(e) => setSelected(slotAt(e.nativeEvent.locationX, layout))}>
        {width > 0 && (
          <Svg width={width} height={PLOT_HEIGHT + LABEL_HEIGHT} pointerEvents="none">
            {layout.ticks.map((t) => (
              <Line key={`g${t.value}`} x1={layout.plotLeft} x2={width} y1={t.y} y2={t.y} stroke={colors.divider} strokeWidth={1} />
            ))}
            {layout.ticks.map((t) => (
              <SvgText key={`t${t.value}`} x={layout.plotLeft - 6} y={t.y + 4} fontSize={typeScale.micro.fontSize} fill={colors.textMuted} textAnchor="end">
                {compactNumber(t.value)}
              </SvgText>
            ))}
            {layout.slots.map((slot, i) => {
              const b = buckets[i];
              const faded = b.inProgress ? 0.45 : 1;
              const dash = b.inProgress ? '3 2' : undefined;
              const isSelected = shown === b;
              return [
                isSelected ? <Rect key={`s${i}`} x={slot.x + 1} y={0} width={slot.width - 2} height={PLOT_HEIGHT} fill={colors.glassHighlight} /> : null,
                <Rect key={`i${i}`} x={slot.income.x} y={slot.income.y} width={layout.barWidth} height={slot.income.h} fill={colors[INCOME_COLOR]} opacity={faded} stroke={dash ? colors[INCOME_COLOR] : undefined} strokeDasharray={dash} />,
                <Rect key={`e${i}`} x={slot.expense.x} y={slot.expense.y} width={layout.barWidth} height={slot.expense.h} fill={colors[EXPENSE_COLOR]} opacity={faded} stroke={dash ? colors[EXPENSE_COLOR] : undefined} strokeDasharray={dash} />,
                <SvgText key={`x${i}`} x={slot.x + slot.width / 2} y={PLOT_HEIGHT + 15} fontSize={typeScale.micro.fontSize} fill={b.inProgress ? colors.textSecondary : colors.textMuted} textAnchor="middle">
                  {buckets.length > 8 && i % 2 === 1 && i !== buckets.length - 1 ? '' : bucketLabel(b)}
                </SvgText>,
              ];
            })}
          </Svg>
        )}
      </View>
      {buckets.some((b) => b.inProgress) && (
        <AppText variant="micro" color="textMuted">
          العمود الباهت لسه شغال.
        </AppText>
      )}
      {averages && (
        <AppText variant="caption" color="textSecondary">
          {averages}
        </AppText>
      )}
      {balance && (
        <AppText variant="caption" color="textSecondary">
          {balance}
        </AppText>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm },
  tooltip: { gap: space.xxs },
});
