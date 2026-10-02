import { Alert } from 'react-native';

import type { ConfirmOptions } from './dialogs.types';

// Native implementations. See dialogs.web.ts for the web versions.

export function confirmAction({ title, message, confirmText, cancelText, onConfirm }: ConfirmOptions) {
  Alert.alert(title, message, [
    { text: cancelText, style: 'cancel' },
    { text: confirmText, style: 'destructive', onPress: onConfirm },
  ]);
}

export function showMessage(title: string, message: string) {
  Alert.alert(title, message);
}
