import type { ConfirmOptions } from './dialogs.types';

// react-native-web's Alert.alert is a no-op, so fall back to the browser dialogs.

export function confirmAction({ title, message, onConfirm }: ConfirmOptions) {
  if (window.confirm(`${title}\n\n${message}`)) {
    onConfirm();
  }
}

export function showMessage(title: string, message: string) {
  window.alert(`${title}\n\n${message}`);
}
