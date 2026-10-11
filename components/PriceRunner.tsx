import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useFinanceStore } from '@/store/useFinanceStore';

// Invisible root helper: in auto price mode, refreshes exchange rates and gold prices once data
// has loaded and whenever the app comes back to the foreground. refreshPrices throttles itself
// (6 hours since the last successful fetch) and never throws; offline, the saved prices stay.
export function PriceRunner() {
  const hydrated = useFinanceStore((s) => s.hasHydrated);

  useEffect(() => {
    if (!hydrated) return;
    const refresh = () => void useFinanceStore.getState().refreshPrices();
    refresh();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') refresh();
    });
    return () => subscription.remove();
  }, [hydrated]);

  return null;
}
