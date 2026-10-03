import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

export interface AppInfo {
  version: string;
  // null in Expo Go / development builds (they aren't tied to a runtime or channel).
  runtimeVersion: string | null;
  channel: string | null;
  // null when running the JS bundled into the build rather than a downloaded update.
  updateId: string | null;
}

export function appInfo(): AppInfo {
  return {
    version: Constants.expoConfig?.version ?? '—',
    runtimeVersion: Updates.runtimeVersion ?? null,
    channel: Updates.channel ?? null,
    updateId: Updates.isEmbeddedLaunch ? null : (Updates.updateId ?? null),
  };
}
