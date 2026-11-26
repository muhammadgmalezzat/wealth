import { useEffect } from 'react';
import { AppState } from 'react-native';

import { loadDailySnapshots, recordDailySnapshot } from '@/store/useDailySnapshots';
import { useFinanceStore } from '@/store/useFinanceStore';

// Changes usually come in bursts (a transfer, a restore); write the snapshot once they settle.
const DEBOUNCE_MS = 1500;

// Invisible root helper: keeps this month's net worth snapshot current, and today's record of the daily history
// (data v10, store/useDailySnapshots.ts). Records once data has loaded, when the app comes back to the foreground (a
// new day or month may have started), and shortly after anything that moves money or reservations changes. Both
// writers are no-ops when nothing changed, so their own writes never retrigger them. The daily history is loaded only
// after the ledger hydrated successfully, and a problem with it never affects the ledger.
export function SnapshotRunner() {
  const hydrated = useFinanceStore((s) => s.hasHydrated);

  useEffect(() => {
    if (!hydrated) return;
    const record = () => {
      useFinanceStore.getState().recordNetWorthSnapshots();
      void recordDailySnapshot();
    };
    void loadDailySnapshots().then(record);
    useFinanceStore.getState().recordNetWorthSnapshots();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useFinanceStore.subscribe((s, prev) => {
      const moved =
        s.accounts !== prev.accounts ||
        s.transactions !== prev.transactions ||
        s.holdings !== prev.holdings ||
        s.liabilities !== prev.liabilities ||
        s.reservationMovements !== prev.reservationMovements ||
        s.unresolvedMovements !== prev.unresolvedMovements ||
        s.funds !== prev.funds ||
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
