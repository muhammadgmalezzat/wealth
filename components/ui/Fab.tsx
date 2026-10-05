import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, shadow, size } from '@/constants/theme';

interface FabProps {
  onPress: () => void;
  accessibilityLabel: string;
  // 'tab': inside a tab screen — the screen already ends at the tab bar, which reserves the
  // bottom inset. 'stack': a stack screen that reaches the bottom edge of the display.
  placement: 'tab' | 'stack';
}

const GAP = 20;
// Space to leave at the end of a list so the last row isn't covered by the button.
export const FAB_CLEARANCE = size.fab + GAP + 16;

// Floating "+" button; render it in <Screen overlay={…}>.
export function Fab({ onPress, accessibilityLabel, placement }: FabProps) {
  const insets = useSafeAreaInsets();
  const bottom = placement === 'tab' ? GAP : insets.bottom + GAP;
  return (
    <TouchableOpacity
      style={[styles.fab, { bottom }]}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}>
      <MaterialIcons name="add" size={30} color={colors.onPrimary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 20,
    width: size.fab,
    height: size.fab,
    borderRadius: radius.pill,
    backgroundColor: colors.primary700,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.raised,
  },
});
