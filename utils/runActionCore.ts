import { mergeOptions, NeedsCoverError, type OpOptions } from '@/store/cover';

// runAction without React Native (so the tests run it): the rule that a NeedsCoverError is NEVER an error message.
// It always opens the cover flow with the account and the shortfall, and the flow retries the same action with what
// the user decided.

export interface CoverRequest {
  error: NeedsCoverError;
  // Runs the same action again with the user's decisions added; returns whether it succeeded (or opened the flow again).
  retry: (options: OpOptions) => boolean;
}

export interface RunActionHandlers {
  showMessage: (title: string, message: string) => void;
  errorMessage: (error: unknown) => string;
  openCover: (request: CoverRequest) => void;
  log?: (error: unknown) => void;
}

// \`action\` receives the options of the retry (undefined on the first run) and must pass them to the store action
// that can need a cover.
// `onRetried` runs when the action finally succeeds from the cover flow (the caller's own "close the sheet": it
// already got `false` when the flow opened).
export function runActionWith(
  handlers: RunActionHandlers,
  failureTitle: string,
  action: (options?: OpOptions) => void,
  options?: OpOptions,
  onRetried?: () => void
): boolean {
  try {
    action(options);
    return true;
  } catch (error) {
    if (error instanceof NeedsCoverError) {
      handlers.openCover({
        error,
        retry: (decided) => {
          const done = runActionWith(handlers, failureTitle, action, mergeOptions(options, decided), onRetried);
          if (done) onRetried?.();
          return done;
        },
      });
      return false;
    }
    handlers.log?.(error);
    handlers.showMessage(failureTitle, handlers.errorMessage(error));
    return false;
  }
}
