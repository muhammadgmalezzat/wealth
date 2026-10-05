import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, radius, space, type ColorToken } from '@/constants/theme';

import { AppText } from './AppText';

export type StatusTone = 'ok' | 'attention' | 'danger' | 'gold' | 'neutral';

const TONES: Record<StatusTone, { bg: ColorToken; fg: ColorToken }> = {
  ok: { bg: 'primary50', fg: 'primary800' },
  attention: { bg: 'warningSurface', fg: 'warning' },
  danger: { bg: 'dangerSurface', fg: 'danger' },
  gold: { bg: 'goldSurface', fg: 'goldText' },
  neutral: { bg: 'surfaceSubtle', fg: 'textSecondary' },
};

interface StatusChipProps {
  // Always present: status is never conveyed by color alone.
  label: string;
  tone?: StatusTone;
  icon?: ComponentProps<typeof MaterialIcons>['name'];
}

// Small read-only status label (e.g. "في الطريق", "متأخر", "تلقائي").
export function StatusChip({ label, tone = 'neutral', icon }: StatusChipProps) {
  const { bg, fg } = TONES[tone];
  return (
    <View style={[styles.chip, { backgroundColor: colors[bg] }]}>
      {icon && <MaterialIcons name={icon} size={14} color={colors[fg]} />}
      <AppText variant="micro" color={fg}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  // RTL: icon first, on the right.
  chip: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
});
