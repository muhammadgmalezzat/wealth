import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { opacity, space, size } from '@/constants/theme';

import { AppText } from './AppText';

interface SectionHeaderProps {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  // Non-pressable info on the left instead of an action (e.g. "{spent} من {planned}").
  trailing?: ReactNode;
}

// Section title on the right, optional tertiary action on the left.
export function SectionHeader({ title, actionLabel, onAction, trailing }: SectionHeaderProps) {
  return (
    <View style={styles.row}>
      <AppText variant="section" style={styles.title}>
        {title}
      </AppText>
      {trailing}
      {actionLabel && onAction && (
        <Pressable
          onPress={onAction}
          hitSlop={8}
          accessibilityRole="button"
          style={({ pressed }) => [styles.action, pressed && { opacity: opacity.pressed }]}>
          <AppText variant="secondary" color="primary700" style={styles.actionText}>
            {actionLabel}
          </AppText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.xxl,
    marginBottom: space.sm,
  },
  title: { flexShrink: 1 },
  action: { minHeight: size.touchMin - 12, justifyContent: 'center' },
  actionText: { fontWeight: '600' },
});
