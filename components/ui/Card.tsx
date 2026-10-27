import type { ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { radius, space } from '@/constants/theme';

import { GlassSurface, type GlassVariant } from './GlassSurface';

export type CardVariant = 'default' | 'subtle' | 'hero';

interface CardProps {
  children: ReactNode;
  variant?: CardVariant;
  style?: StyleProp<ViewStyle>;
  // Frosted blur (iOS only), for a few fixed cards — never inside long lists.
  blur?: boolean;
}

const GLASS: Record<CardVariant, GlassVariant> = { default: 'strong', subtle: 'subtle', hero: 'hero' };

// default: nearly opaque glass (dense data stays readable) · subtle: flat translucent inset ·
// hero: larger radius and padding with an emerald light, for the one headline card of a screen.
export function Card({ children, variant = 'default', style, blur = false }: CardProps) {
  return (
    <GlassSurface
      variant={GLASS[variant]}
      blur={blur}
      radius={variant === 'hero' ? radius.xl : radius.lg}
      style={[variant === 'hero' ? styles.hero : styles.base, style]}>
      {children}
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  base: { padding: space.lg },
  hero: { padding: space.xl },
});
