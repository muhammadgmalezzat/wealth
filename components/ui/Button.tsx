import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { colors, opacity, radius, space, type ColorToken } from '@/constants/theme';

import { AppText } from './AppText';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: ComponentProps<typeof MaterialIcons>['name'];
  disabled?: boolean;
  loading?: boolean;
  // Full width.
  block?: boolean;
  accessibilityLabel?: string;
}

const LABEL_COLOR: Record<ButtonVariant, ColorToken> = {
  primary: 'onPrimary',
  secondary: 'text',
  tertiary: 'primary700',
  destructive: 'danger',
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled = false,
  loading = false,
  block = false,
  accessibilityLabel,
}: ButtonProps) {
  const inactive = disabled || loading;
  const labelColor = LABEL_COLOR[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        block && styles.block,
        pressed && (variant === 'primary' ? styles.primaryPressed : styles.pressed),
        disabled && styles.disabled,
      ]}>
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator color={colors[labelColor]} />
        ) : (
          <>
            <AppText variant="bodyStrong" color={labelColor} align="center">
              {label}
            </AppText>
            {icon && <MaterialIcons name={icon} size={20} color={colors[labelColor]} />}
          </>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: radius.md,
    paddingHorizontal: space.xl,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
  },
  block: { alignSelf: 'stretch' },
  // RTL: the icon (last child) sits at the start (right) of the label.
  content: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.sm },
  primary: { backgroundColor: colors.primary700 },
  primaryPressed: { backgroundColor: colors.primary900 },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
  tertiary: { backgroundColor: 'transparent', paddingHorizontal: space.sm },
  destructive: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.danger },
  pressed: { opacity: opacity.pressed },
  disabled: { opacity: opacity.disabled },
});
