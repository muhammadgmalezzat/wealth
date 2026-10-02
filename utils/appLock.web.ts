// expo-local-authentication has no web implementation; the lock is a phone-only feature.

export interface LockAvailability {
  available: boolean;
  reason?: string;
}

export async function appLockAvailability(): Promise<LockAvailability> {
  return { available: false, reason: 'قفل التطبيق متاح على الموبايل بس' };
}

export async function authenticate(): Promise<boolean> {
  return false;
}
