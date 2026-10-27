import { useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { colors, radius, space, type ColorToken } from '@/constants/theme';

// The width a view got, 0 until it has been laid out. Charts need an explicit width.
export function useMeasuredWidth(): [number, (e: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState(0);
  return [width, (e) => setWidth(Math.floor(e.nativeEvent.layout.width))];
}

// A glass card around a chart (nearly opaque, so axes and labels keep their contrast). Tighter padding
// than a plain Card: the chart wants the width.
export function ChartCard({ children }: { children: ReactNode }) {
  return <Card style={styles.chartCard}>{children}</Card>;
}

// A quiet message when a section has nothing to show yet ("محتاج شهر بيانات على الأقل").
export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <Card variant="subtle">
      <AppText variant="secondary" color="textSecondary" align="center">
        {children}
      </AppText>
    </Card>
  );
}

export const NOT_ENOUGH_DATA = 'محتاج شهر بيانات على الأقل';

// One legend entry: colour dot + label.
export function LegendDot({ color, label }: { color: ColorToken; label: string }) {
  return (
    <View style={styles.legend}>
      <View style={[styles.dot, { backgroundColor: colors[color] }]} />
      <AppText variant="caption" color="textSecondary">
        {label}
      </AppText>
    </View>
  );
}

export function LegendRow({ children }: { children: ReactNode }) {
  return <View style={styles.legendRow}>{children}</View>;
}

const styles = StyleSheet.create({
  chartCard: { padding: space.md, gap: space.sm },
  legendRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: space.md, marginTop: space.sm },
  legend: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.xs },
  dot: { width: 10, height: 10, borderRadius: radius.pill },
});
