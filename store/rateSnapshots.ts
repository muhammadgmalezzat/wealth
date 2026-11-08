import { snapshotForWrite } from '@/utils/rates';

import type { FinanceState, RateSnapshot } from './types';

// The rate snapshot to attach to a record written now (docs/architecture/CURRENCY_AND_FUNDS_DESIGN.md §B1):
// the one whose table equals the CURRENT rates if it exists, otherwise a new one. `rateSnapshots` is set
// only when a snapshot was added: the operation then puts it in its patch. Pure; the state is never changed.
export function snapshotForNow(
  state: Pick<FinanceState, 'settings' | 'rateSnapshots'>,
  now: Date
): { id: string; rateSnapshots?: RateSnapshot[] } {
  const { snapshot, isNew } = snapshotForWrite(state.rateSnapshots, state.settings.rates, {
    takenAt: now.toISOString(),
    source: state.settings.rates.source,
  });
  return { id: snapshot.id, ...(isNew ? { rateSnapshots: [...state.rateSnapshots, snapshot] } : {}) };
}
