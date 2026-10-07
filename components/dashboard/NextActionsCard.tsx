import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { InsightCard } from '@/components/ui/InsightCard';
import { ListGroup, ListRow } from '@/components/ui/ListRow';
import { colors, opacity, space } from '@/constants/theme';
import type { NextAction } from '@/store/nextActions';
import { moreThingsPhrase } from '@/utils/formatters';

import { SEVERITY_LOOK } from './homeInsights';

interface NextActionsCardProps {
  // Sorted, most important first (store/nextActions.ts). Renders nothing when empty.
  actions: NextAction[];
  onRun: (action: NextAction) => void;
  onDismiss: (action: NextAction) => void;
}

// The next best action as a prominent card ("بعدين" snoozes it for a day when allowed), and the
// rest behind "كمان X حاجات".
export function NextActionsCard({ actions, onRun, onDismiss }: NextActionsCardProps) {
  const [open, setOpen] = useState(false);
  const [top, ...rest] = actions;
  if (!top) return null;
  const look = SEVERITY_LOOK[top.severity];

  return (
    <View style={styles.stack}>
      <InsightCard
        tone={look.tone}
        icon={look.icon}
        title={top.title}
        message={top.subtitle ?? ''}
        actionLabel={top.cta.label}
        onAction={() => onRun(top)}
        {...(top.dismissible ? { dismissLabel: 'بعدين', onDismiss: () => onDismiss(top) } : {})}
      />
      {rest.length > 0 && (
        <View>
          <Pressable
            onPress={() => setOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            style={({ pressed }) => [styles.toggle, pressed && { opacity: opacity.pressed }]}>
            <AppText variant="secondary" color="primary700" style={styles.flex}>
              {moreThingsPhrase(rest.length)}
            </AppText>
            <MaterialIcons name={open ? 'expand-less' : 'expand-more'} size={20} color={colors.primary700} />
          </Pressable>
          {open && (
            <ListGroup>
              {rest.map((action) => {
                const rowLook = SEVERITY_LOOK[action.severity];
                return (
                  <ListRow
                    key={action.id}
                    title={action.title}
                    subtitle={action.subtitle}
                    icon={rowLook.icon}
                    iconTone={rowLook.listTone}
                    chevron
                    onPress={() => onRun(action)}
                    accessibilityLabel={`${action.title}، ${action.cta.label}`}
                  />
                );
              })}
            </ListGroup>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.xs },
  toggle: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.sm, minHeight: 44 },
  flex: { flex: 1 },
});
