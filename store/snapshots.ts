import { snapshotRates } from '@/utils/currency';
import { monthOf, shiftMonth, toMonthKey } from '@/utils/dates';
import { netWorthAsOf, netWorthEGP, netWorthFigures, type NetWorthFigures } from './selectors';
import { daysInMonth } from './shared';
import type { FinanceState, NetWorthBreakdown, NetWorthSnapshot, RatesSnapshot } from './types';

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

function snapshot(
  month: string,
  figures: NetWorthFigures,
  at: string,
  estimated: boolean,
  rates: RatesSnapshot
): NetWorthSnapshot {
  return {
    id: snapshotIdFor(month),
    month,
    ...figures,
    ratesSnapshot: snapshotRates(rates),
    takenAt: at,
    updatedAt: at,
    ...(estimated ? { estimated: true } : {}),
  };
}

// Estimated snapshots for months from trackingStartDate's up to (not including) `now`'s month
// that have none yet. Existing snapshots are never touched.
export function missingPastSnapshots(state: State, now: Date): NetWorthSnapshot[] {
  const current = toMonthKey(now);
  const startMonth = monthOf(state.settings.trackingStartDate);
  const at = now.toISOString();
  const result: NetWorthSnapshot[] = [];
  for (let n = MAX_BACKFILL_MONTHS; n >= 1; n--) {
    const month = shiftMonth(current, -n);
    if (month < startMonth || snapshotFor(state, month)) continue;
    result.push(snapshot(month, netWorthAsOf(state, monthEnd(month)), at, true, state.settings.exchangeRates));
  }
  return result;
}

const sameBreakdown = (a: NetWorthBreakdown, b: NetWorthBreakdown) =>
  Math.abs(a.liabilitiesEGP - b.liabilitiesEGP) < EPSILON &&
  (['EG', 'SA'] as const).every((where) =>
    (['cashEGP', 'goldEGP', 'currenciesEGP'] as const).every((part) => Math.abs(a[where][part] - b[where][part]) < EPSILON)
  );

// Whether a stored snapshot already says what the live figures say (and carries the breakdown
// and rates analytics needs, which older snapshots lack).
const same = (a: NetWorthSnapshot, b: NetWorthFigures) =>
  Math.abs(a.netWorthEGP - b.netWorthEGP) < EPSILON &&
  Math.abs(a.liquidEGP - b.liquidEGP) < EPSILON &&
  Math.abs(a.holdingsEGP - b.holdingsEGP) < EPSILON &&
  !!a.ratesSnapshot &&
  !!a.breakdown &&
  sameBreakdown(a.breakdown, b.breakdown);

// Estimated snapshots from before the breakdown existed are estimates anyway: work them out
// again, now with the breakdown and the rates they are valued at.
function upgradedEstimates(state: State, now: Date): NetWorthSnapshot[] {
  const at = now.toISOString();
  return state.netWorthSnapshots
    .filter((s) => s.estimated && (!s.breakdown || !s.ratesSnapshot) && s.month < toMonthKey(now))
    .map((s) => snapshot(s.month, netWorthAsOf(state, monthEnd(s.month)), at, true, state.settings.exchangeRates));
}

// The snapshot list with missing past months filled in and the current month's snapshot set to
// the live figures, oldest first; null when nothing would change (so callers skip the write).
export function syncedSnapshots(state: State, now: Date): NetWorthSnapshot[] | null {
  const current = toMonthKey(now);
  const missing = [...missingPastSnapshots(state, now), ...upgradedEstimates(state, now)];
  const live = netWorthFigures(state);
  const existing = snapshotFor(state, current);
  const currentChanged = !existing || existing.estimated || !same(existing, live);
  if (missing.length === 0 && !currentChanged) return null;
  const replaced = new Set(missing.map((s) => s.month));
  const kept = state.netWorthSnapshots.filter((s) => !replaced.has(s.month) && !(currentChanged && s.month === current));
  const added = currentChanged ? [snapshot(current, live, now.toISOString(), false, state.settings.exchangeRates)] : [];
  return [...kept, ...missing, ...added].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
}

export interface NetWorthChange {
  amountEGP: number;
  // amount ÷ |starting net worth|; null when it started at 0.
  pct: number | null;
  // The month the change is measured from.
  fromMonth: string;
}

function change(from: number, to: number, fromMonth: string): NetWorthChange {
  const amountEGP = to - from;
  return { amountEGP, pct: Math.abs(from) >= EPSILON ? amountEGP / Math.abs(from) : null, fromMonth };
}

// Live net worth compared with last month's snapshot; null when there is none.
export function netWorthChange(state: State, now: Date = new Date()): NetWorthChange | null {
  const fromMonth = shiftMonth(toMonthKey(now), -1);
  const previous = snapshotFor(state, fromMonth);
  return previous ? change(previous.netWorthEGP, netWorthEGP(state), fromMonth) : null;
}

// How net worth moved over `month`: its end (its snapshot; live figures for the current month)
// against the previous month's snapshot. null when either is missing.
export function monthNetWorthChange(state: State, month: string, now: Date = new Date()): NetWorthChange | null {
  const fromMonth = shiftMonth(month, -1);
  const previous = snapshotFor(state, fromMonth);
  const end = month === toMonthKey(now) ? netWorthEGP(state) : snapshotFor(state, month)?.netWorthEGP;
  return previous && end !== undefined ? change(previous.netWorthEGP, end, fromMonth) : null;
}
