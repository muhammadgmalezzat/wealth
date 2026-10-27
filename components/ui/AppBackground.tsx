import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { colors } from '@/constants/theme';

// The shared backdrop: near-black midnight with a very soft emerald glow at the top. Static (no
// animation) and absolutely positioned behind the content, so it never scrolls or takes touches.
export function AppBackground() {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.base]}>
      <LinearGradient
        // Fades in from nothing, peaks just below the top edge and fades out: no hard line under a
        // stack header, which covers the very top of the screen.
        colors={['rgba(40, 197, 154, 0)', colors.emeraldGlow, 'rgba(40, 197, 154, 0)']}
        locations={[0, 0.22, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.glow}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  base: { backgroundColor: colors.background },
  glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 380 },
});
