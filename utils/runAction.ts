import { showMessage } from './dialogs';
import { errorMessage } from './errorMessages';

// Runs a store action; on a validation error shows the Arabic message instead of crashing.
// Returns whether the action succeeded.
export function runAction(failureTitle: string, action: () => void): boolean {
  try {
    action();
    return true;
  } catch (error) {
    if (__DEV__) console.warn(error);
    showMessage(failureTitle, errorMessage(error));
    return false;
  }
}
