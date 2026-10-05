import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, opacity, radius, space, weight } from '@/constants/theme';

import { AppText } from './AppText';

interface ChipProps {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

// Pill-shaped toggle used for filters and pickers. Visual height 36, touch target 44.
export function Chip({ label, selected = false, disabled = false, onPress }: ChipProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}>
      <AppText variant="secondary" color={selected ? 'primary800' : 'text'} align="center" style={selected && styles.labelSelected}>
        {label}
      </AppText>
    </Pressable>
  );
}

// Right-aligned wrapping row of chips (first chip on the right).
export function ChipRow({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: space.sm },
  chip: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: space.md + space.xxs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.primary50, borderColor: colors.primary700 },
  labelSelected: { fontWeight: weight.semibold },
  pressed: { opacity: opacity.pressed },
  disabled: { opacity: opacity.disabled },
});
