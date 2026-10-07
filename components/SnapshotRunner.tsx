import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useFinanceStore } from '@/store/useFinanceStore';

// Changes usually come in bursts (a transfer, a restore); write the snapshot once they settle.
const DEBOUNCE_MS = 1500;

// Invisible root helper: keeps this month's net worth snapshot current. Records once data has
// loaded, when the app comes back to the foreground (a new month may have started), and shortly
// after anything that moves net worth changes. recordNetWorthSnapshots is a no-op when nothing
// changed, so its own write never retriggers it.
export function SnapshotRunner() {
  const hydrated = useFinanceStore((s) => s.hasHydrated);

  useEffect(() => {
    if (!hydrated) return;
    const record = () => useFinanceStore.getState().recordNetWorthSnapshots();
    record();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useFinanceStore.subscribe((s, prev) => {
      const moved =
        s.accounts !== prev.accounts ||
        s.transactions !== prev.transactions ||
        s.holdings !== prev.holdings ||
        s.liabilities !== prev.liabilities ||
        s.settings !== prev.settings;
      if (!moved) return;
      clearTimeout(timer);
      timer = setTimeout(record, DEBOUNCE_MS);
    });
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') record();
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
      subscription.remove();
    };
  }, [hydrated]);

  return null;
}
