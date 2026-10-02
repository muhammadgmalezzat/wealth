import * as LocalAuthentication from 'expo-local-authentication';

// Native app lock helpers (biometrics or the device PIN). See appLock.web.ts.

export interface LockAvailability {
  available: boolean;
  // Arabic explanation when unavailable.
  reason?: string;
}

export async function appLockAvailability(): Promise<LockAvailability> {
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    if (level === LocalAuthentication.SecurityLevel.NONE) {
      return { available: false, reason: 'فعّل بصمة أو قفل شاشة (PIN) على الجهاز الأول' };
    }
    return { available: true };
  } catch {
    return { available: false, reason: 'قفل التطبيق مش متاح على الجهاز ده' };
  }
}

// Biometrics with fallback to the device PIN/pattern. Resolves true on success.
export async function authenticate(promptMessage = 'افتح Wealth'): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: 'إلغاء',
      disableDeviceFallback: false,
    });
    return result.success;
  } catch {
    return false;
  }
}
