import { StyleSheet, Text, type TextProps } from 'react-native';

import { colors, type, type ColorToken, type TypeVariant } from '@/constants/theme';

export interface AppTextProps extends TextProps {
  variant?: TypeVariant;
  color?: ColorToken;
  // Defaults to 'right' (Arabic-first; see "RTL" in docs/TECHNICAL.md).
  align?: 'right' | 'left' | 'center';
}

// Text with a type-scale variant and a color token.
export function AppText({ variant = 'body', color = 'text', align = 'right', style, ...rest }: AppTextProps) {
  return <Text {...rest} style={[type[variant], styles.base, { color: colors[color], textAlign: align }, style]} />;
}

const styles = StyleSheet.create({
  base: { writingDirection: 'rtl' },
});
