import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Colors, FinanceColors } from '@/constants/theme';

export interface SegmentOption<T extends string> {
  label: string;
  value: T;
}

interface SegmentProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
}

// Generic segmented control. Options flow right-to-left, so the first one sits on the right.
export function Segment<T extends string>({ options, value, onChange }: SegmentProps<T>) {
  return (
    <View style={styles.segment}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <TouchableOpacity
            key={opt.value}
            style={[styles.segmentItem, active && styles.segmentItemActive]}
            onPress={() => onChange(opt.value)}
            activeOpacity={0.75}>
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  segment: {
    flexDirection: 'row-reverse',
    backgroundColor: FinanceColors.cardBackground,
    borderRadius: 10,
    padding: 3,
    borderWidth: 1,
    borderColor: FinanceColors.progressTrack,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  segmentItemActive: {
    backgroundColor: Colors.light.background,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  segmentText: {
    fontSize: 14,
    color: Colors.light.icon,
    fontWeight: '500',
  },
  segmentTextActive: {
    color: Colors.light.tint,
    fontWeight: '700',
  },
});
