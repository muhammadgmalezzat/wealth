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

import { Colors, FinanceColors } from '@/constants/theme';

// Page-sheet modal with cancel / title / save header, shared by the app's edit forms.

interface FormSheetProps {
  visible: boolean;
  title: string;
  onCancel: () => void;
  onSave: () => void;
  children: ReactNode;
}

export function FormSheet({ visible, title, onCancel, onSave, children }: FormSheetProps) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onCancel} hitSlop={8}>
            <Text style={styles.cancel}>إلغاء</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{title}</Text>
          <TouchableOpacity onPress={onSave} hitSlop={8}>
            <Text style={styles.save}>حفظ</Text>
          </TouchableOpacity>
        </View>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.body}
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
