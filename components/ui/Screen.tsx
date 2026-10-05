import type { ReactElement, ReactNode } from 'react';
import { Platform, ScrollView, StyleSheet, View, type RefreshControlProps, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, size } from '@/constants/theme';

// The only way routes set their outer layout (edge-to-edge is always on in SDK 57).
//
// Conventions:
// - Tab screens (no header): edges={['top']} (default). The tab bar already reserves the bottom
//   inset, so no 'bottom' edge.
// - Stack screens: the native header (titles in app/_layout.tsx) handles the top inset, so
//   edges={['bottom']} — nothing sits under the Android navigation bar / iOS home indicator.
// - Floating buttons go in `overlay` (see Fab), so they don't scroll with the content.
// Background = colors.background.
export type ScreenEdge = 'top' | 'bottom';

interface ScreenProps {
  scroll?: boolean;
  edges?: ScreenEdge[];
  // Applied to the ScrollView content (scroll) or the inner container (no scroll).
  contentStyle?: StyleProp<ViewStyle>;
  refreshControl?: ReactElement<RefreshControlProps>;
  // Fixed above the content (doesn't scroll).
  header?: ReactNode;
  // Absolutely positioned layer above the content, e.g. a Fab.
  overlay?: ReactNode;
  children: ReactNode;
}

export const SCREEN_TOP_GAP = 8;
export const SCREEN_BOTTOM_GAP = 16;

export function Screen({ scroll = false, edges = ['top'], contentStyle, refreshControl, header, overlay, children }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const top = edges.includes('top') ? insets.top + SCREEN_TOP_GAP : 0;
  const bottomInset = edges.includes('bottom') ? insets.bottom + SCREEN_BOTTOM_GAP : 0;
  // The inset is added to the screen's own bottom padding (e.g. FAB_CLEARANCE), never replaces it.
  const own = StyleSheet.flatten(contentStyle) ?? {};
  const ownBottom = Number(own.paddingBottom ?? own.paddingVertical ?? own.padding ?? 0) || 0;
  const bottom = ownBottom + bottomInset;

  return (
    <View style={[styles.root, { paddingTop: top }]}>
      {header}
      {scroll ? (
        <ScrollView
          style={styles.fill}
          contentContainerStyle={[styles.readable, contentStyle, { paddingBottom: bottom }]}
          refreshControl={refreshControl}
          keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.fill, styles.readable, contentStyle, { paddingBottom: bottom }]}>{children}</View>
      )}
      {overlay}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  fill: { flex: 1 },
  // Wide web windows: keep content at a readable width, centred.
  readable: Platform.OS === 'web' ? { width: '100%', maxWidth: size.readableMax, alignSelf: 'center' } : {},
});
