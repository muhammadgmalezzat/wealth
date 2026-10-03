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

import { Colors, FinanceColors } from '@/constants/theme';

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
          <TouchableOpacity onPress={onCancel} hitSlop={8}>
            <Text style={styles.cancel}>إلغاء</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{title}</Text>
          <TouchableOpacity onPress={onSave} disabled={saveDisabled} hitSlop={8}>
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
      placeholderTextColor={Colors.light.icon}
      textAlign="right"
      {...props}
      style={[styles.input, props.style]}
    />
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: FinanceColors.progressTrack,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.light.text,
  },
  cancel: {
    fontSize: 16,
    color: Colors.light.icon,
  },
  save: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.light.tint,
  },
  saveDisabled: {
    opacity: 0.4,
  },
  scroll: {
    flex: 1,
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
    gap: 4,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.light.icon,
    textAlign: 'right',
    marginBottom: 6,
    marginTop: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: FinanceColors.progressTrack,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.light.text,
    backgroundColor: FinanceColors.cardBackground,
  },
});
