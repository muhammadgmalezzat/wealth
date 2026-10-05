import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Children, cloneElement, isValidElement, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type TextStyle } from 'react-native';

import { colors, space } from '@/constants/theme';

import { AppText } from './AppText';

interface FormFieldProps {
  label: string;
  helper?: string;
  // Shown instead of the helper; also marks the input (danger border + ground).
  error?: string | null;
  children: ReactNode;
}

// Label + input + helper / error. Pass a FormInput (or any input taking `style`) as the child.
export function FormField({ label, helper, error, children }: FormFieldProps) {
  const markInvalid = (child: ReactNode) =>
    isValidElement<{ style?: StyleProp<TextStyle> }>(child)
      ? cloneElement(child, { style: [child.props.style, styles.inputError] })
      : child;
  const content = error ? Children.map(children, markInvalid) : children;
  return (
    <View style={styles.field}>
      <AppText variant="caption" color="textSecondary">
        {label}
      </AppText>
      {content}
      {error ? (
        <View style={styles.errorRow}>
          <MaterialIcons name="error-outline" size={16} color={colors.danger} />
          <AppText variant="caption" color="danger" style={styles.flex}>
            {error}
          </AppText>
        </View>
      ) : helper ? (
        <AppText variant="caption" color="textSecondary">
          {helper}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginTop: space.lg, gap: space.xs + space.xxs },
  inputError: { borderColor: colors.danger, backgroundColor: colors.dangerSurface },
  // RTL: icon at the start (right).
  errorRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.xs },
  flex: { flex: 1 },
});
