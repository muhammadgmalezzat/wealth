import { StyleSheet, View } from 'react-native';

import { colors, size } from '@/constants/theme';

export type ProgressTone = 'normal' | 'attention' | 'over';

interface ProgressBarProps {
  progress: number; // 0–1
  tone?: ProgressTone;
  // Part of `progress` (0–1 of the whole bar) backed by gold, drawn in gold at the start.
  goldPortion?: number;
  height?: number;
  /** @deprecated use `tone` */
  color?: string;
  /** @deprecated the track always uses colors.progressTrack */
  backgroundColor?: string;
}

const FILL = { normal: colors.primary600, attention: colors.warning, over: colors.danger };

// RTL: fills from the right.
export function ProgressBar({ progress, tone = 'normal', goldPortion = 0, height = size.progress, color, backgroundColor }: ProgressBarProps) {
  const total = clamp(progress);
  const gold = Math.min(clamp(goldPortion), total);
  const rounded = { height, borderRadius: height / 2 };
  return (
    <View
      style={[styles.track, rounded, { backgroundColor: backgroundColor ?? colors.progressTrack }]}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(total * 100) }}>
      {gold > 0 && <View style={[styles.segment, { width: `${gold * 100}%`, backgroundColor: colors.gold }]} />}
      <View style={[styles.segment, { width: `${(total - gold) * 100}%`, backgroundColor: color ?? FILL[tone] }]} />
    </View>
  );
}

const clamp = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

const styles = StyleSheet.create({
  track: { overflow: 'hidden', width: '100%', flexDirection: 'row-reverse' },
  segment: { height: '100%' },
});
