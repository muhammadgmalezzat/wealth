import { Alert } from 'react-native';

import type { ConfirmOptions } from './confirm.types';

// Native: two-button alert. See confirm.web.ts for the web implementation.
export function confirmAction({ title, message, confirmText, cancelText, onConfirm }: ConfirmOptions) {
  Alert.alert(title, message, [
    { text: cancelText, style: 'cancel' },
    { text: confirmText, style: 'destructive', onPress: onConfirm },
  ]);
}
