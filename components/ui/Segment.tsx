import { Pressable, StyleSheet, View } from 'react-native';

import { colors, radius, shadow, space, weight } from '@/constants/theme';

import { AppText } from './AppText';

export interface SegmentOption<T extends string> {
  label: string;
  value: T;
}

interface SegmentProps<T extends string> {
  options: SegmentOption<T>[];
  // undefined = nothing selected yet.
  value: T | undefined;
  onChange: (v: T) => void;
}

// Generic segmented control. Options flow right-to-left, so the first one sits on the right.
export function Segment<T extends string>({ options, value, onChange }: SegmentProps<T>) {
  return (
    <View style={styles.segment} accessibilityRole="tablist">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            style={[styles.item, active && styles.itemActive]}
            onPress={() => onChange(opt.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}>
            <AppText
              variant="secondary"
              color={active ? 'primary800' : 'textSecondary'}
              align="center"
              style={active && styles.textActive}>
              {opt.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  segment: {
    flexDirection: 'row-reverse',
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radius.md,
    padding: space.xxs,
  },
  item: {
    flex: 1,
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: space.xs,
    borderRadius: radius.md - space.xxs,
  },
  itemActive: { backgroundColor: colors.surface, ...shadow.card },
  textActive: { fontWeight: weight.bold },
});
