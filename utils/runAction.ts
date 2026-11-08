import type { OpOptions } from '@/store/cover';

import { requestCover } from './coverRequests';
import { showMessage } from './dialogs';
import { errorMessage } from './errorMessages';
import { runActionWith } from './runActionCore';

// Runs a store action; on a validation error shows the Arabic message instead of crashing. An operation that
// would eat into money reserved for funds (or go below zero) is NOT an error: it opens the cover sheet with the
// account and the shortfall, and the sheet runs the action again with the user's decision. `action` therefore
// receives the retry's options and must pass them on to the store action. Returns whether the action succeeded.
export function runAction(failureTitle: string, action: (options?: OpOptions) => void, onRetried?: () => void): boolean {
  return runActionWith(
    {
      showMessage,
      errorMessage,
      openCover: requestCover,
      log: (error) => {
        if (__DEV__) console.warn(error);
      },
    },
    failureTitle,
    action,
    undefined,
    onRetried
  );
}
