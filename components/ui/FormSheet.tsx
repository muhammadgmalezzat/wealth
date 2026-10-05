import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type TextInputProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, opacity, radius, space, type } from '@/constants/theme';

// Page-sheet modal with cancel / title / save header, shared by the app's edit forms.
// Safe area: on Android the modal is a full-screen window drawn under the status and navigation
// bars (edge-to-edge), so the header is pushed below insets.top. On iOS a page sheet already
// starts below the status bar, so only the bottom inset (home indicator) applies. The scrolling
// body always ends insets.bottom above the bottom edge, so the last field/button is reachable.
export function useSheetInsets() {
  const insets = useSafeAreaInsets();
  return { top: Platform.OS === 'android' ? insets.top : 0, bottom: insets.bottom };
}

interface FormSheetProps {
  visible: boolean;
  title: string;
  onCancel: () => void;
  onSave: () => void;
  // Defaults to "حفظ".
  saveLabel?: string;
  // Greys out and ignores the save button (e.g. while working).
  saveDisabled?: boolean;
  children: ReactNode;
}

export function FormSheet({
  visible,
  title,
  onCancel,
  onSave,
  saveLabel = 'حفظ',
  saveDisabled = false,
  children,
}: FormSheetProps) {
  const insets = useSheetInsets();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={[styles.root, { paddingTop: insets.top }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onCancel} hitSlop={12} accessibilityRole="button">
            <Text style={styles.cancel}>إلغاء</Text>
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <TouchableOpacity
            onPress={onSave}
            disabled={saveDisabled}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityState={{ disabled: saveDisabled }}>
            <Text style={[styles.save, saveDisabled && styles.saveDisabled]}>{saveLabel}</Text>
          </TouchableOpacity>
        </View>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

export function FormInput(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={colors.textMuted}
      textAlign="right"
      {...props}
      style={[styles.input, props.style]}
    />
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    paddingHorizontal: space.xl,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: {
    flexShrink: 1,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '700',
    color: colors.text,
  },
  cancel: {
    ...type.body,
    color: colors.textSecondary,
  },
  save: {
    ...type.bodyStrong,
    color: colors.primary700,
  },
  saveDisabled: {
    opacity: opacity.disabled,
  },
  scroll: {
    flex: 1,
  },
  body: {
    paddingHorizontal: space.xl,
    paddingTop: space.xl,
    gap: space.xs,
  },
  fieldLabel: {
    ...type.caption,
    color: colors.textSecondary,
    textAlign: 'right',
    marginBottom: 6,
    marginTop: space.lg,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    ...type.body,
    color: colors.text,
    backgroundColor: colors.surface,
  },
});
