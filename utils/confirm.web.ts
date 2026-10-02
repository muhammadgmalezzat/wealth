import type { ConfirmOptions } from './confirm.types';

// react-native-web's Alert.alert is a no-op, so fall back to the browser dialog.
export function confirmAction({ title, message, onConfirm }: ConfirmOptions) {
  if (window.confirm(`${title}\n\n${message}`)) {
    onConfirm();
  }
}
