import { Fragment, type ReactNode } from 'react';
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

// One grouped surface with equal cells separated by hairlines (first cell on the right).
export function MetricGroup({ metrics, accessibilityLabel }: { metrics: Metric[]; accessibilityLabel?: string }) {
  return (
    <View style={styles.group} accessibilityLabel={accessibilityLabel}>
      {metrics.map((m, i) => (
        <Fragment key={m.label}>
          {i > 0 && <View style={styles.divider} />}
          <View style={[styles.cell, m.tone === 'gold' && styles.goldCell]}>
            <AppText variant="caption" color={m.tone === 'gold' ? 'goldText' : 'textSecondary'} align="center">
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
  cell: { flex: 1, minWidth: 0, alignItems: 'center', gap: 2, paddingHorizontal: space.xs, justifyContent: 'center' },
  goldCell: { backgroundColor: colors.goldSurface, marginVertical: -space.md, paddingVertical: space.md },
  divider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: space.xs },
});
