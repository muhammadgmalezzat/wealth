import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius as radii, shadow } from '@/constants/theme';

// How see-through the surface is. Dense financial data should use `strong` (nearly opaque) or
// `Card`'s default; `subtle` is for quiet insets, `hero` for the one headline card of a screen.
export type GlassVariant = 'subtle' | 'regular' | 'strong' | 'hero';

interface GlassSurfaceProps {
  variant?: GlassVariant;
  // Frosted blur behind the surface. Real blur only exists on iOS here; Android and web keep the
  // translucent fill (which is always drawn, so text stays readable without blur). Blur is
  // expensive: use it for a few fixed surfaces, never per row of a long list.
  blur?: boolean;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

const FILL: Record<GlassVariant, string> = {
  subtle: colors.glassSubtle,
  regular: colors.glass,
  strong: colors.glassStrong,
  hero: colors.glassStrong,
};

// A soft emerald light for the hero, a faint top highlight for the rest.
const HERO_GRADIENT = [colors.emeraldGlow, 'rgba(40, 197, 154, 0.04)'] as const;
const HIGHLIGHT_GRADIENT = [colors.glassHighlight, 'rgba(233, 245, 240, 0)'] as const;

// Frosted-glass surface: translucent fill, hairline border, restrained highlight and (optionally)
// native blur. Children render on top, so content is never behind a gradient.
export function GlassSurface({ variant = 'regular', blur = false, radius = radii.lg, style, children }: GlassSurfaceProps) {
  const hero = variant === 'hero';
  return (
    <View
      style={[
        styles.base,
        { borderRadius: radius, backgroundColor: FILL[variant] },
        hero && styles.hero,
        variant !== 'subtle' && shadow.card,
        style,
      ]}>
      {blur && Platform.OS === 'ios' && <BlurView tint="dark" intensity={35} style={StyleSheet.absoluteFill} />}
      {variant !== 'subtle' && (
        <LinearGradient
          pointerEvents="none"
          colors={hero ? HERO_GRADIENT : HIGHLIGHT_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  hero: { borderColor: 'rgba(40, 197, 154, 0.38)' },
});
