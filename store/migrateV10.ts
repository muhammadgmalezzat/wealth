/* eslint-disable @typescript-eslint/no-explicit-any -- the steps read states of several intermediate shapes; each checks what it needs. */
import type { MigrationContext } from './migrations';
import type { FinanceState } from './types';

// v9 → v10 (docs/architecture/PROFESSIONAL_ANALYTICS_AND_COMPARISON_DESIGN.md §16), as ORDERED, IDEMPOTENT sub-steps,
// like migrateV9.ts: `settings.v10Step` records how many a state has had; each step does nothing to data already in
// its shape; a step that finds data it cannot trust throws, and the store then refuses the data and leaves it
// untouched (store/hydration.ts). Input must be a complete v9 state (applyV9Steps first).
//
// Data v10 adds the DAILY SNAPSHOT history (store/dailySnapshots.ts). It lives under its own storage key, never inside
// the ledger value, so a damaged or oversized history can never stop the ledger from loading. The version bump marks
// that this data set has (or may have) such a history, so that older builds refuse v10 data and v10 backup files
// (which carry the history) instead of silently restoring or saving without it.
//
// Nothing here changes an amount, a transaction or a reservation: every v9 number stays identical.

type Draft = Record<string, any>;

const isRecord = (value: unknown): value is Draft => typeof value === 'object' && value !== null && !Array.isArray(value);

class V10MigrationError extends Error {
  override name = 'V10MigrationError';
}

// --- 1. separate daily history ---------------------------------------------------------------------------------

// The ledger value never carries the daily history: a state that does was hand-edited or built by a wrong tool, and
// is refused rather than guessed about (the history has its own key and its own validation).
function stepSeparateDailyHistory(s: Draft): Draft {
  if ('dailySnapshots' in s) throw new V10MigrationError('the ledger value must not contain dailySnapshots');
  return s;
}

// --- the runner -----------------------------------------------------------------------------------------

// In order; a step's position + 1 is its number in `settings.v10Step`. Only ever append.
export const V10_STEPS: { name: string; run: (state: Draft) => Draft }[] = [
  { name: 'separateDailyHistory', run: stepSeparateDailyHistory },
];

export const LATEST_V10_STEP = V10_STEPS.length;

// Runs the v10 steps a (complete v9 or v10) state hasn't had yet. A state already at `upTo` comes back as the same
// object. Throws if a step cannot run.
export function applyV10Steps(input: unknown, _ctx: MigrationContext, upTo: number = LATEST_V10_STEP): FinanceState {
  if (!isRecord(input) || !isRecord(input.settings)) throw new V10MigrationError('not a state');
  const done = typeof input.settings.v10Step === 'number' ? input.settings.v10Step : 0;
  if (done >= upTo) return input as FinanceState;
  let state: Draft = input;
  for (let i = done; i < upTo; i++) state = V10_STEPS[i].run(state);
  return { ...state, settings: { ...state.settings, v10Step: upTo } } as FinanceState;
}
