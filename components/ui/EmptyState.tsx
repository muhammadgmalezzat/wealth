import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, space } from '@/constants/theme';

import { AppText } from './AppText';
import { Button } from './Button';

interface EmptyStateProps {
  icon: ComponentProps<typeof MaterialIcons>['name'];
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon, title, body, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.disc}>
        <MaterialIcons name={icon} size={32} color={colors.primary700} />
      </View>
      <AppText variant="section" align="center">
        {title}
      </AppText>
      {body ? (
        <AppText variant="secondary" color="textSecondary" align="center">
          {body}
        </AppText>
      ) : null}
      {actionLabel && onAction && (
        <View style={styles.action}>
          <Button label={actionLabel} onPress={onAction} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: space.xxxl, paddingHorizontal: space.xl, gap: space.sm },
  disc: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  action: { marginTop: space.md, alignSelf: 'center' },
});
