import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { AppText } from '@/components/ui/AppText';
import { formatDateAr } from '@/components/ui/formatDateAr';
import { formatMoney } from '@/components/ui/formatMoney';
import { colors, space } from '@/constants/theme';

import { useMeasuredWidth } from './common';
import { indexAt, seriesLayout } from './seriesLayout';

const HEIGHT = 120;

export interface ChartPoint {
  // A date key ('YYYY-MM-DD') or a month ('YYYY-MM'): whatever `labelOf` formats.
  date: string;
  // null = a gap: nothing drawn, never a zero.
  value: number | null;
  ledgerDiverged?: boolean;
}

interface NetWorthChartProps {
  points: ChartPoint[];
  currency: string;
  // How a point's date reads (tooltip and axis). Default: a day ("٢٦ نوفمبر ٢٠٢٦").
  labelOf?: (date: string, short: boolean) => string;
  // Added to every value in the tooltip (the monthly view: «تقديري»).
  tag?: string;
  // What a gap says, and the hint before anything is touched.
  gapText?: string;
  hint?: string;
}

const dayLabel = (date: string, short: boolean) => formatDateAr(date, { year: !short });

// The hero's daily line (daily snapshots and today only). Gaps stay gaps. Touch or drag to read a day: a day without
// a record says so instead of showing a number.
export function NetWorthChart({ points, currency, labelOf = dayLabel, tag, gapText = 'مفيش تسجيل اليوم ده', hint = 'دوس أو اسحب على الرسم عشان تشوف يوم معيّن.' }: NetWorthChartProps) {
  const [width, onLayout] = useMeasuredWidth();
  const [selected, setSelected] = useState<number | null>(null);
  const layout = seriesLayout(points, width, HEIGHT);
  const pick = (x: number) => setSelected(indexAt(x, points.length, width));
  const shown = selected !== null ? points[selected] : null;
  const recorded = points.filter((p) => p.value !== null).length;

  return (
    <View style={styles.wrap}>
      <AppText variant="caption" color="textSecondary">
        {shown
          ? `${labelOf(shown.date, false)}: ${shown.value === null ? gapText : `${formatMoney(shown.value, currency)}${tag ? ` · ${tag}` : ''}`}${shown.ledgerDiverged ? ' · اتعدّل بعد التسجيل' : ''}`
          : hint}
      </AppText>
      <View
        onLayout={onLayout}
        style={styles.chart}
        accessibilityLabel={`صافي الثروة: ${recorded} نقطة متسجّلة من ${points.length}`}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => pick(e.nativeEvent.locationX)}
        onResponderMove={(e) => pick(e.nativeEvent.locationX)}>
        {width > 0 && (
          <Svg width={width} height={HEIGHT} pointerEvents="none">
            {layout.areas.map((d, i) => (
              <Path key={`a${i}`} d={d} fill={colors.primarySoft} />
            ))}
            {layout.lines.map((d, i) => (
              <Path key={`l${i}`} d={d} stroke={colors.primary} strokeWidth={2} fill="none" />
            ))}
            {layout.dots.map((p, i) => (
              <Circle key={`d${i}`} cx={p.x} cy={p.y} r={3} fill={colors.primary} />
            ))}
            {selected !== null && layout.xs[selected] !== undefined && (
              <Line x1={layout.xs[selected]} x2={layout.xs[selected]} y1={0} y2={HEIGHT} stroke={colors.borderStrong} strokeWidth={1} />
            )}
            {selected !== null && layout.ys[selected] !== null && layout.ys[selected] !== undefined && (
              <Circle cx={layout.xs[selected]} cy={layout.ys[selected]!} r={4} fill={colors.text} />
            )}
          </Svg>
        )}
      </View>
      {points.length > 1 && (
        <View style={styles.axis}>
          <AppText variant="micro" color="textMuted">
            {labelOf(points[0].date, true)}
          </AppText>
          <AppText variant="micro" color="textMuted">
            {labelOf(points[points.length - 1].date, true)}
          </AppText>
        </View>
      )}
      {recorded < points.length && (
        <AppText variant="micro" color="textMuted">
          {`الفراغات مفيهاش تسجيل، ومش بتتحسب.`}
        </AppText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  chart: { height: HEIGHT },
  // Time runs left to right (like the other Analytics charts): the first day on the left.
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
});
