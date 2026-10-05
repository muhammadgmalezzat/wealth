import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Children, Fragment, type ComponentProps, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, opacity, radius, space, type ColorToken } from '@/constants/theme';

import { AppText } from './AppText';

type IconName = ComponentProps<typeof MaterialIcons>['name'];
export type IconTone = 'neutral' | 'ok' | 'gold';

const ICON_TONES: Record<IconTone, { bg: ColorToken; fg: ColorToken }> = {
  neutral: { bg: 'surfaceSubtle', fg: 'textSecondary' },
  ok: { bg: 'primary50', fg: 'primary700' },
  gold: { bg: 'goldSurface', fg: 'goldText' },
};

interface ListRowProps {
  title: string;
  subtitle?: string;
  icon?: IconName;
  iconTone?: IconTone;
  // Left side: Money, Switch, StatusChip…
  trailing?: ReactNode;
  // Shows a chevron (pointing left, the "forward" direction in RTL).
  chevron?: boolean;
  archived?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
}

// One row: [trailing][chevron] … [title / subtitle][icon tile] — reading order starts on the right.
export function ListRow({ title, subtitle, icon, iconTone = 'neutral', trailing, chevron, archived, onPress, accessibilityLabel }: ListRowProps) {
  const tone = ICON_TONES[iconTone];
  const body = (
    <>
      {icon && (
        <View style={[styles.iconTile, { backgroundColor: colors[tone.bg] }]}>
          <MaterialIcons name={icon} size={20} color={colors[tone.fg]} />
        </View>
      )}
      <View style={styles.text}>
        <AppText variant="bodyStrong" color={archived ? 'textSecondary' : 'text'} numberOfLines={1}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="secondary" color="textSecondary" numberOfLines={2}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {trailing}
      {chevron && <MaterialIcons name="chevron-left" size={22} color={colors.textSecondary} />}
    </>
  );
  if (!onPress) return <View style={[styles.row, archived && styles.archived]}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      style={({ pressed }) => [styles.row, archived && styles.archived, pressed && styles.pressed]}>
      {body}
    </Pressable>
  );
}

// Grouped surface with hairline separators between its rows.
export function ListGroup({ children }: { children: ReactNode }) {
  const rows = Children.toArray(children);
  return (
    <View style={styles.group}>
      {rows.map((row, i) => (
        <Fragment key={i}>
          {row}
          {i < rows.length - 1 && <View style={styles.separator} />}
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  iconTile: { width: 36, height: 36, borderRadius: radius.sm + 2, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1 },
  archived: { opacity: 0.6 },
  pressed: { backgroundColor: colors.surfaceSubtle, opacity: opacity.pressed },
  group: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  // Inset from the right (text start), like iOS grouped lists.
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginRight: space.lg },
});
