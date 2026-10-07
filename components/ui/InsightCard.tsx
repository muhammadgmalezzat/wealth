import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, type ColorToken, opacity, radius, space, weight } from '@/constants/theme';

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
  // Optional bold line above the message (the Next Best Action's title).
  title?: string;
  icon?: ComponentProps<typeof MaterialIcons>['name'];
  actionLabel?: string;
  onAction?: () => void;
  // Optional quiet second action after the main one (e.g. "بعدين" to snooze).
  dismissLabel?: string;
  onDismiss?: () => void;
}

// A one-line nudge on a tinted ground ("عدّيت ميزانية الخروجات بـ ...", "عندك 3 مستحقات").
export function InsightCard({ tone, message, title, icon, actionLabel, onAction, dismissLabel, onDismiss }: InsightCardProps) {
  const t = TONES[tone];
  const hasAction = !!(actionLabel && onAction);
  const hasDismiss = !!(dismissLabel && onDismiss);
  return (
    <View style={[styles.card, { backgroundColor: colors[t.bg] }]}>
      <View style={styles.row}>
        <MaterialIcons name={icon ?? t.icon} size={22} color={colors[t.fg]} />
        <View style={styles.message}>
          {title ? <AppText variant="bodyStrong">{title}</AppText> : null}
          <AppText variant="secondary" color={title ? 'textSecondary' : 'text'}>
            {message}
          </AppText>
        </View>
      </View>
      {(hasAction || hasDismiss) && (
        <View style={styles.actions}>
          {hasAction && (
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
          {hasDismiss && (
            <Pressable
              onPress={onDismiss}
              hitSlop={8}
              accessibilityRole="button"
              style={({ pressed }) => [styles.action, pressed && { opacity: opacity.pressed }]}>
              <AppText variant="secondary" color="textSecondary">
                {dismissLabel}
              </AppText>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  row: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: space.md },
  message: { flex: 1 },
  // The actions keep their place at the card's end; within them, RTL: the main action first
  // (right), the quiet one after it.
  actions: { flexDirection: 'row-reverse', alignItems: 'center', alignSelf: 'flex-start', gap: space.lg },
  action: { paddingVertical: space.xs },
  actionText: { fontWeight: weight.bold },
});
