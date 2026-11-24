/* eslint-disable @typescript-eslint/no-explicit-any -- the steps read states of several intermediate shapes; each checks what it needs. */
import { assertReceivableInvariants } from './invariants';
import type { MigrationContext } from './migrations';
import type { FinanceState } from './types';

// v8 → v9 (docs/architecture/RECEIVABLES_DESIGN.md §1.4), as ORDERED, IDEMPOTENT sub-steps, like migrateV8.ts:
// `settings.v9Step` records how many a state has had; each step does nothing to data already in its shape; a
// step that finds data it cannot trust throws, and the store then refuses the data and leaves it untouched
// (store/hydration.ts). Input must be a complete v8 state (applyV8Steps first).
//
// Nothing here changes an amount, a transaction or a reservation: every v8 number stays identical.

type Draft = Record<string, any>;

const isRecord = (value: unknown): value is Draft => typeof value === 'object' && value !== null && !Array.isArray(value);

class V9MigrationError extends Error {
  override name = 'V9MigrationError';
}

// --- 1. receivables ----------------------------------------------------------------------------------------

// Adds the (empty) receivables collection. A state that already has one keeps it, but only if it is a list of
// records and every receivable link in it holds (INV-9…11); real v8 data has neither receivables nor links.
function stepReceivables(s: Draft): Draft {
  if (s.receivables !== undefined && (!Array.isArray(s.receivables) || !s.receivables.every(isRecord))) {
    throw new V9MigrationError('receivables is not a list of records');
  }
  const next = s.receivables === undefined ? { ...s, receivables: [] } : s;
  if (!Array.isArray(next.transactions)) throw new V9MigrationError('transactions is not a list');
  assertReceivableInvariants(next as FinanceState);
  return next;
}

// --- the runner -----------------------------------------------------------------------------------------

// In order; a step's position + 1 is its number in `settings.v9Step`. Only ever append.
export const V9_STEPS: { name: string; run: (state: Draft) => Draft }[] = [{ name: 'receivables', run: stepReceivables }];

export const LATEST_V9_STEP = V9_STEPS.length;

// Runs the v9 steps a (complete v8 or v9) state hasn't had yet. A state already at `upTo` comes back as the same
// object. Throws if a step cannot run.
export function applyV9Steps(input: unknown, _ctx: MigrationContext, upTo: number = LATEST_V9_STEP): FinanceState {
  if (!isRecord(input) || !isRecord(input.settings)) throw new V9MigrationError('not a state');
  const done = typeof input.settings.v9Step === 'number' ? input.settings.v9Step : 0;
  if (done >= upTo) return input as FinanceState;
  let state: Draft = input;
  for (let i = done; i < upTo; i++) state = V9_STEPS[i].run(state);
  return { ...state, settings: { ...state.settings, v9Step: upTo } } as FinanceState;
}
