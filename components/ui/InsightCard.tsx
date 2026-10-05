import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, opacity, radius, space, type ColorToken } from '@/constants/theme';

import { AppText } from './AppText';

export type InsightTone = 'ok' | 'attention' | 'danger';

const TONES: Record<InsightTone, { bg: ColorToken; fg: ColorToken; icon: ComponentProps<typeof MaterialIcons>['name'] }> = {
  ok: { bg: 'primary50', fg: 'primary800', icon: 'check-circle-outline' },
  attention: { bg: 'warningSurface', fg: 'warning', icon: 'info-outline' },
  danger: { bg: 'dangerSurface', fg: 'danger', icon: 'error-outline' },
};

interface InsightCardProps {
  tone: InsightTone;
  message: string;
  icon?: ComponentProps<typeof MaterialIcons>['name'];
  actionLabel?: string;
  onAction?: () => void;
}

// A one-line nudge on a tinted ground ("عدّيت ميزانية الخروجات بـ ...", "عندك 3 مستحقات").
export function InsightCard({ tone, message, icon, actionLabel, onAction }: InsightCardProps) {
  const t = TONES[tone];
  return (
    <View style={[styles.card, { backgroundColor: colors[t.bg] }]}>
      <View style={styles.row}>
        <MaterialIcons name={icon ?? t.icon} size={22} color={colors[t.fg]} />
        <AppText variant="secondary" style={styles.message}>
          {message}
        </AppText>
      </View>
      {actionLabel && onAction && (
        <Pressable
          onPress={onAction}
          hitSlop={8}
          accessibilityRole="button"
          style={({ pressed }) => [styles.action, pressed && { opacity: opacity.pressed }]}>
          <AppText variant="secondary" color={t.fg} style={styles.actionText}>
            {actionLabel}
          </AppText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  row: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: space.md },
  message: { flex: 1 },
  action: { alignSelf: 'flex-start', paddingVertical: space.xs },
  actionText: { fontWeight: '700' },
});
