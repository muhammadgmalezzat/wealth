import Constants from 'expo-constants';

import type { AppInfo } from './appInfo';

// EAS Update doesn't apply to the web build.
export function appInfo(): AppInfo {
  return {
    version: Constants.expoConfig?.version ?? '—',
    runtimeVersion: null,
    channel: null,
    updateId: null,
  };
}
