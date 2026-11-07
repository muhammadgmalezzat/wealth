import { monthOf, shiftMonth, toMonthKey } from '@/utils/dates';
import { projectAmount } from '@/utils/currency';
import { roundIn } from '@/utils/money';
import { snapshotById } from '@/utils/rates';
import { snapshotForNow } from './rateSnapshots';
import { netWorth, netWorthAsOf, netWorthFigures, reportingCurrency, toStoredBreakdown } from './selectors';
import { daysInMonth } from './shared';
import type { CurrencyCode, FinanceState, NetWorthBreakdown, NetWorthSnapshot, RateSnapshot } from './types';

// Monthly net worth snapshots. Pure functions only.
//
// The current month's snapshot follows the live figures (upserted after hydration and after
// changes), so once a month is over its snapshot holds its last value. Past months without one
// (before v7, or months the app wasn't opened) are filled in as estimates (netWorthAsOf).

type State = FinanceState;

// Backfill never reaches further back than this, however old trackingStartDate is.
const MAX_BACKFILL_MONTHS = 36;
// Float noise isn't a change worth writing.
const EPSILON = 0.005;

export const snapshotIdFor = (month: string) => `nw-${month}`;

export function snapshotFor(state: Pick<State, 'netWorthSnapshots'>, month: string): NetWorthSnapshot | undefined {
  return state.netWorthSnapshots.find((s) => s.month === month);
}

const monthEnd = (month: string) => `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;

// A snapshot stores its figures in EGP (the fields are named for it), at the rates of its moment; any
// other currency is a projection through those rates.
type StoredFigures = Pick<NetWorthSnapshot, 'netWorthEGP' | 'liquidEGP' | 'holdingsEGP'> & { breakdown: NetWorthBreakdown };

function stored(state: State, date: string | null): StoredFigures {
  const f = date === null ? netWorthFigures(state, 'EGP') : netWorthAsOf(state, date, 'EGP');
  return {
    netWorthEGP: f.netWorth,
    liquidEGP: f.liquid,
    holdingsEGP: f.holdings,
    breakdown: toStoredBreakdown(f.breakdown),
  };
}

function snapshot(
  month: string,
  figures: StoredFigures,
  at: string,
  estimated: boolean,
  rateSnapshotId: string
): NetWorthSnapshot {
  return {
    id: snapshotIdFor(month),
    month,
    ...figures,
    rateSnapshotId,
    takenAt: at,
    updatedAt: at,
    ...(estimated ? { estimated: true } : {}),
  };
}

// Estimated snapshots for months from trackingStartDate's up to (not including) `now`'s month
// that have none yet. Existing snapshots are never touched.
export function missingPastSnapshots(
  state: State,
  now: Date,
  rateSnapshotId: string = snapshotForNow(state, now).id
): NetWorthSnapshot[] {
  const current = toMonthKey(now);
  const startMonth = monthOf(state.settings.trackingStartDate);
  const at = now.toISOString();
  const result: NetWorthSnapshot[] = [];
  for (let n = MAX_BACKFILL_MONTHS; n >= 1; n--) {
    const month = shiftMonth(current, -n);
    if (month < startMonth || snapshotFor(state, month)) continue;
    result.push(snapshot(month, stored(state, monthEnd(month)), at, true, rateSnapshotId));
  }
  return result;
}

const PARTS = ['cashEGP', 'goldEGP', 'currenciesEGP', 'liabilitiesEGP'] as const;

const sameBreakdown = (a: NetWorthBreakdown, b: NetWorthBreakdown) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].every((country) =>
    PARTS.every((part) => Math.abs((a[country]?.[part] ?? 0) - (b[country]?.[part] ?? 0)) < EPSILON)
  );

// Whether the month has rates of its own. The migration gives a snapshot that had none a rate snapshot
// of quality 'estimated' (frozen at the rates of the migration), which counts as "none".
const hasOwnRates = (state: Pick<State, 'rateSnapshots'>, s: NetWorthSnapshot) =>
  snapshotById(state.rateSnapshots, s.rateSnapshotId)?.quality === 'recorded';

// Whether a stored snapshot already says what the live figures say (and carries the breakdown
// and rates analytics needs, which older snapshots lack).
const same = (state: Pick<State, 'rateSnapshots'>, a: NetWorthSnapshot, b: StoredFigures) =>
  Math.abs(a.netWorthEGP - b.netWorthEGP) < EPSILON &&
  Math.abs(a.liquidEGP - b.liquidEGP) < EPSILON &&
  Math.abs(a.holdingsEGP - b.holdingsEGP) < EPSILON &&
  hasOwnRates(state, a) &&
  !!a.breakdown &&
  sameBreakdown(a.breakdown, b.breakdown);

// Estimated snapshots from before the breakdown existed are estimates anyway: work them out
// again, now with the breakdown and the rates they are valued at.
function upgradedEstimates(state: State, now: Date, rateSnapshotId: string): NetWorthSnapshot[] {
  const at = now.toISOString();
  return state.netWorthSnapshots
    .filter((s) => s.estimated && (!s.breakdown || !hasOwnRates(state, s)) && s.month < toMonthKey(now))
    .map((s) => snapshot(s.month, stored(state, monthEnd(s.month)), at, true, rateSnapshotId));
}

export interface SnapshotSync {
  netWorthSnapshots: NetWorthSnapshot[];
  // Set when the sync needed a rate snapshot that did not exist yet: the full list, to be saved too.
  rateSnapshots?: RateSnapshot[];
}

// The snapshot list with missing past months filled in and the current month's snapshot set to
// the live figures, oldest first (plus the rate snapshot they point at, when it is new); null when
// nothing would change (so callers skip the write).
export function syncSnapshots(state: State, now: Date): SnapshotSync | null {
  const current = toMonthKey(now);
  const rates = snapshotForNow(state, now);
  const missing = [...missingPastSnapshots(state, now, rates.id), ...upgradedEstimates(state, now, rates.id)];
  const live = stored(state, null);
  const existing = snapshotFor(state, current);
  const currentChanged = !existing || existing.estimated || !same(state, existing, live);
  if (missing.length === 0 && !currentChanged) return null;
  const replaced = new Set(missing.map((s) => s.month));
  const kept = state.netWorthSnapshots.filter((s) => !replaced.has(s.month) && !(currentChanged && s.month === current));
  const added = currentChanged ? [snapshot(current, live, now.toISOString(), false, rates.id)] : [];
  const netWorthSnapshots = [...kept, ...missing, ...added].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
  return { netWorthSnapshots, ...(rates.rateSnapshots ? { rateSnapshots: rates.rateSnapshots } : {}) };
}

// Just the net-worth list of syncSnapshots.
export function syncedSnapshots(state: State, now: Date): NetWorthSnapshot[] | null {
  return syncSnapshots(state, now)?.netWorthSnapshots ?? null;
}

export interface NetWorthChange {
  // In the currency asked for (the reporting currency by default).
  amount: number;
  // amount ÷ |starting net worth|; null when it started at 0.
  pct: number | null;
  // The month the change is measured from.
  fromMonth: string;
}

// A stored snapshot's net worth in `to`, as it was worth at its own rates.
export function snapshotNetWorth(state: Pick<State, 'rateSnapshots'>, s: NetWorthSnapshot, to: CurrencyCode): number {
  return roundIn(projectAmount(state.rateSnapshots, s.rateSnapshotId, s.netWorthEGP, 'EGP', to), to);
}

function change(from: number, end: number, fromMonth: string, to: CurrencyCode): NetWorthChange {
  const amount = roundIn(end - from, to);
  return { amount, pct: Math.abs(from) >= EPSILON ? amount / Math.abs(from) : null, fromMonth };
}

// Live net worth compared with last month's snapshot; null when there is none.
export function netWorthChange(
  state: State,
  now: Date = new Date(),
  to: CurrencyCode = reportingCurrency(state)
): NetWorthChange | null {
  const fromMonth = shiftMonth(toMonthKey(now), -1);
  const previous = snapshotFor(state, fromMonth);
  return previous ? change(snapshotNetWorth(state, previous, to), netWorth(state, to), fromMonth, to) : null;
}

// How net worth moved over `month`: its end (its snapshot; live figures for the current month)
// against the previous month's snapshot. null when either is missing.
export function monthNetWorthChange(
  state: State,
  month: string,
  now: Date = new Date(),
  to: CurrencyCode = reportingCurrency(state)
): NetWorthChange | null {
  const fromMonth = shiftMonth(month, -1);
  const previous = snapshotFor(state, fromMonth);
  const endSnapshot = snapshotFor(state, month);
  const end = month === toMonthKey(now) ? netWorth(state, to) : endSnapshot ? snapshotNetWorth(state, endSnapshot, to) : undefined;
  return previous && end !== undefined ? change(snapshotNetWorth(state, previous, to), end, fromMonth, to) : null;
}
