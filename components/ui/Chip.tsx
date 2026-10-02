import type { ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Colors, FinanceColors } from '@/constants/theme';

interface ChipProps {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

// Pill-shaped toggle used for filters and pickers.
export function Chip({ label, selected = false, disabled = false, onPress }: ChipProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.75}
      style={[styles.chip, selected && styles.chipSelected, disabled && styles.chipDisabled]}>
      <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

// Right-aligned wrapping row of chips.
export function ChipRow({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: FinanceColors.progressTrack,
    backgroundColor: FinanceColors.cardBackground,
  },
  chipSelected: {
    backgroundColor: Colors.light.tint,
    borderColor: Colors.light.tint,
  },
  chipDisabled: {
    opacity: 0.35,
  },
  label: {
    fontSize: 14,
    color: Colors.light.text,
  },
  labelSelected: {
    color: '#fff',
    fontWeight: '600',
  },
});
