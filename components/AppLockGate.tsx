import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Modal, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { colors, space } from '@/constants/theme';
import { useFinanceStore } from '@/store/useFinanceStore';
import { authenticate } from '@/utils/appLock';

const RELOCK_AFTER_MS = 60_000;

// Lock screen shown when "قفل التطبيق" is on. It's a Modal so it also covers any open sheet
// (React Native modals draw above regular views):
// - locks on cold start (once data has loaded) and after ≥1 minute in the background;
// - while the app is inactive/backgrounded it covers the screen, so the app switcher's
//   snapshot shows no balances (iOS; Android may snapshot before the cover renders).
export function AppLockGate() {
  const insets = useSafeAreaInsets();
  const enabled = useFinanceStore((s) => s.hasHydrated && !!s.settings.appLockEnabled);
  const [locked, setLocked] = useState(false);
  const [covered, setCovered] = useState(false);
  const enabledRef = useRef(enabled);
  const lockedOnStart = useRef(false);
  const backgroundedAt = useRef<number | null>(null);
  const prompting = useRef(false);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  // Cold start: lock as soon as we know the lock is on.
  useEffect(() => {
    if (enabled && !lockedOnStart.current) {
      lockedOnStart.current = true;
      setLocked(true);
    }
  }, [enabled]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        setCovered(false);
        const away = backgroundedAt.current;
        backgroundedAt.current = null;
        if (enabledRef.current && away !== null && Date.now() - away >= RELOCK_AFTER_MS) setLocked(true);
        return;
      }
      // The biometric prompt itself makes iOS "inactive"; don't cover or relock for it.
      if (prompting.current) return;
      if (enabledRef.current) setCovered(true);
      if (next === 'background' && backgroundedAt.current === null) backgroundedAt.current = Date.now();
    });
    return () => subscription.remove();
  }, []);

  const unlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    try {
      if (await authenticate()) setLocked(false);
    } finally {
      prompting.current = false;
    }
  }, []);

  // Ask right away whenever the app becomes locked.
  useEffect(() => {
    if (locked) void unlock();
  }, [locked, unlock]);

  if (!enabled || (!locked && !covered)) return null;

  return (
    // onRequestClose: the Android back button must not dismiss the lock.
    <Modal
      visible
      animationType="none"
      presentationStyle="fullScreen"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => {}}>
      {/* Covers the whole display; the content is centred inside the safe area. */}
      <View
        style={[
          styles.overlay,
          { paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right },
        ]}>
        <View style={styles.disc}>
          <MaterialIcons name="lock" size={32} color={colors.primary700} />
        </View>
        <AppText variant="display" align="center">
          Wealth
        </AppText>
        <AppText variant="secondary" color="textSecondary" align="center">
          بياناتك المالية محمية
        </AppText>
        {locked && (
          <View style={styles.action}>
            <Button label="فتح التطبيق" icon="lock-open" onPress={unlock} />
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  disc: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  action: { marginTop: space.xl },
});
