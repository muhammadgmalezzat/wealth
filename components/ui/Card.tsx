import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, shadow, space } from '@/constants/theme';

export type CardVariant = 'default' | 'subtle' | 'hero';

interface CardProps {
  children: ReactNode;
  variant?: CardVariant;
  style?: StyleProp<ViewStyle>;
}

// default: surface + hairline border + soft shadow · subtle: tinted ground, flat · hero: larger
// radius and padding for the one headline card of a screen.
export function Card({ children, variant = 'default', style }: CardProps) {
  return <View style={[styles.base, styles[variant], style]}>{children}</View>;
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.lg, padding: space.lg },
  default: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  subtle: { backgroundColor: colors.surfaceSubtle },
  hero: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: space.xl,
    ...shadow.card,
  },
});
