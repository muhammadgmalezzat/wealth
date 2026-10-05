import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { colors, opacity, space, weight } from '@/constants/theme';

interface MoreDetailsProps {
  initiallyOpen: boolean;
  children: ReactNode;
}

// "تفاصيل أكتر": a collapsed tertiary row that reveals the less-used fields.
export function MoreDetails({ initiallyOpen, children }: MoreDetailsProps) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        hitSlop={8}
        style={({ pressed }) => [styles.toggle, pressed && { opacity: opacity.pressed }]}>
        <AppText variant="secondary" color="primary700" style={styles.label}>
          تفاصيل أكتر
        </AppText>
        <MaterialIcons name={open ? 'expand-less' : 'expand-more'} size={22} color={colors.primary700} />
      </Pressable>
      {open && <View>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: space.xl },
  // RTL: label on the right, chevron after it.
  toggle: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.xs, minHeight: 44, alignSelf: 'flex-end' },
  label: { fontWeight: weight.semibold },
});
