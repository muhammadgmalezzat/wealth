import { Fragment, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, radius, space } from '@/constants/theme';

import { AppText } from './AppText';

export interface Metric {
  label: string;
  // Usually a <Money size="row" align="center" />.
  value: ReactNode;
  // 'gold': goldSurface ground with a goldText label (gold & investments).
  tone?: 'default' | 'gold';
}

// Below this cell width (large text, very narrow windows) the cells stack as label / value rows.
const MIN_CELL_WIDTH = 96;

// One grouped surface with equal cells separated by hairlines (first cell on the right). Stacks
// into rows when there isn't room for the cells side by side.
export function MetricGroup({ metrics, accessibilityLabel }: { metrics: Metric[]; accessibilityLabel?: string }) {
  const [width, setWidth] = useState(0);
  const stacked = width > 0 && width / metrics.length < MIN_CELL_WIDTH;

  return (
    <View
      style={[styles.group, stacked && styles.groupStacked]}
      accessibilityLabel={accessibilityLabel}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {metrics.map((m, i) => (
        <Fragment key={m.label}>
          {i > 0 && <View style={stacked ? styles.dividerStacked : styles.divider} />}
          <View style={[stacked ? styles.row : styles.cell, m.tone === 'gold' && (stacked ? styles.goldRow : styles.goldCell)]}>
            <AppText variant="caption" color={m.tone === 'gold' ? 'goldText' : 'textSecondary'} align={stacked ? 'right' : 'center'}>
              {m.label}
            </AppText>
            {m.value}
          </View>
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    flexDirection: 'row-reverse',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: space.md,
    overflow: 'hidden',
  },
  groupStacked: { flexDirection: 'column', paddingVertical: 0 },
  cell: { flex: 1, minWidth: 0, alignItems: 'center', gap: space.xxs, paddingHorizontal: space.xs, justifyContent: 'center' },
  goldCell: { backgroundColor: colors.goldSurface, marginVertical: -space.md, paddingVertical: space.md },
  // Stacked: label on the right, value under it, full width.
  row: { paddingHorizontal: space.md, paddingVertical: space.sm, gap: space.xxs, alignItems: 'flex-end' },
  goldRow: { backgroundColor: colors.goldSurface },
  divider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: space.xs },
  dividerStacked: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
});
