import { daysBetween, monthOf, shiftDate, shiftMonth } from '@/utils/dates';
import { sumIn } from '@/utils/money';
import { monthEnd, monthStart, periodTotals } from './analytics';
import { compareValues, unavailable, type Change, type MetricValue, type PeriodComparison } from './comparison';
import { createMemoCache, memoOn } from './memo';
import { categoryShares } from './shares';
import { measuredTo, weekStart, type AnalyticsPeriod } from './periods';
import type { CurrencyCode, FinanceState } from './types';

// Data for the Overview's transaction-based charts (Phase 2b): the income-vs-spending bars, the sparklines and the
// spending footprint. Every figure is periodTotals' (so transfers, exchanges, fund allocations and gold purchases are
// never income or spending, fees are spending); nothing here depends on daily snapshots, so it is exact from day one.
// Pure and memoized. Days before tracking started are never drawn (no zero bars).

type State = FinanceState;
const EPSILON = 0.005;

export type BucketUnit = 'week' | 'month';

export interface FlowBucket {
  unit: BucketUnit;
  // The calendar month ('YYYY-MM') or the week's Saturday this bar stands for.
  key: string;
  // What was measured: [from, to] (to ≤ today; from ≥ tracking start).
  from: string;
  to: string;
  income: number;
  expense: number;
  net: number;
  // net ÷ income; null without income.
  savingsRate: number | null;
  // The month / week isn't over yet.
  inProgress: boolean;
  // Doesn't cover its whole month / week: tracking or the selected period starts inside it, or the period ends inside it.
  partial: boolean;
  // Inside the selected period (the bars before it are context).
  inPeriod: boolean;
}

export interface CashflowChart {
  unit: BucketUnit;
  buckets: FlowBucket[];
  // The tracking start, when the window nominally began before it (the chart says where the data starts).
  dataStart: string | null;
  // Averages over COMPLETE buckets (not in progress, not partial); null when there is none.
  averageIncome: number | null;
  averageExpense: number | null;
  completeCount: number;
  // Complete buckets with a positive / negative net (a zero net is neither).
  positive: number;
  negative: number;
}

export interface CashflowOptions {
  currency: CurrencyCode;
  // Force a unit (the sparklines are always monthly); default: weeks for periods of 31 days or less, months otherwise.
  unit?: BucketUnit;
  // Months shown at least (ending with the period's last month); the period's own months when it is longer.
  minMonths?: number;
  // false: the window is exactly `minMonths` months (sparklines), never widened to the period nor split at its start.
  followPeriod?: boolean;
}

const cache = createMemoCache<CashflowChart>();

export function cashflowChart(state: State, period: AnalyticsPeriod, options: CashflowOptions): CashflowChart {
  const key = JSON.stringify([period, options]);
  return memoOn(cache, [state.transactions, state.rateSnapshots, state.categories, state.accounts, state.settings], key, () => compute(state, period, options));
}

function compute(state: State, period: AnalyticsPeriod, options: CashflowOptions): CashflowChart {
  const start = state.settings.trackingStartDate;
  const end = measuredTo(period);
  const followPeriod = options.followPeriod ?? true;
  const days = daysBetween(period.nominalFrom, period.nominalTo) + 1;
  const unit: BucketUnit = options.unit ?? (days <= 31 ? 'week' : 'month');

  // Nominal buckets (calendar months or Saturday weeks), oldest first.
  const nominal: { key: string; from: string; to: string }[] = [];
  if (unit === 'week') {
    for (let w = weekStart(period.nominalFrom); w <= end; w = shiftDate(w, 7)) nominal.push({ key: w, from: w, to: shiftDate(w, 6) });
  } else {
    const endMonth = monthOf(end);
    const fromWindow = shiftMonth(endMonth, -((options.minMonths ?? 6) - 1));
    const first = followPeriod && monthOf(period.nominalFrom) < fromWindow ? monthOf(period.nominalFrom) : fromWindow;
    for (let m = first; m <= endMonth; m = shiftMonth(m, 1)) nominal.push({ key: m, from: monthStart(m), to: monthEnd(m) });
  }
  const windowFrom = unit === 'week' ? period.nominalFrom : nominal[0]?.from ?? period.nominalFrom;

  const buckets: FlowBucket[] = [];
  for (const n of nominal) {
    // Weeks are clipped to the period; months are clipped to the tracking start and today, and split at the period's
    // start when it falls inside one (so the bars inside the period add up to the period exactly).
    let parts: { from: string; to: string }[];
    if (unit === 'week') parts = [{ from: n.from < period.from ? period.from : n.from, to: n.to > end ? end : n.to }];
    else if (followPeriod && period.from > n.from && period.from <= n.to) parts = [{ from: n.from, to: shiftDate(period.from, -1) }, { from: period.from, to: n.to }];
    else parts = [{ from: n.from, to: n.to }];
    for (const part of parts) {
      const from = part.from < start ? start : part.from;
      const to = part.to > end ? end : part.to;
      if (to < from) continue; // before tracking, or after the end: not drawn
      const inProgress = n.to >= period.today && to >= period.today;
      const totals = periodTotals(state, { period: { kind: 'custom', from, to }, currency: options.currency, includeOneTime: true });
      buckets.push({
        unit,
        key: n.key,
        from,
        to,
        income: totals.income,
        expense: totals.expense,
        net: totals.net,
        savingsRate: totals.savingsRate,
        inProgress,
        // Cut short at either end (tracking or the period starts inside it; the period ends inside it).
        partial: from > n.from || (!inProgress && to < n.to),
        inPeriod: from >= period.from && to <= end,
      });
    }
  }

  const complete = buckets.filter((b) => !b.inProgress && !b.partial);
  const c = options.currency;
  const average = (pick: (b: FlowBucket) => number) => (complete.length > 0 ? Math.round((sumIn(complete.map(pick), c) / complete.length) * 100) / 100 : null);
  return {
    unit,
    buckets,
    dataStart: windowFrom < start ? start : null,
    averageIncome: average((b) => b.income),
    averageExpense: average((b) => b.expense),
    completeCount: complete.length,
    positive: complete.filter((b) => b.net > EPSILON).length,
    negative: complete.filter((b) => b.net < -EPSILON).length,
  };
}

// --- Spending footprint -----------------------------------------------------------------------------------------

export interface FootprintSegment {
  // A category id, or 'rest' («باقي الفئات»).
  key: string;
  categoryIds: string[];
  amount: number;
  // Share of the period's spending (= tenths / 1000, so the segments add up to exactly 1).
  share: number;
  // The share in tenths of a percent, rounded so that the segments add up to exactly 1000 (100.0 %).
  tenths: number;
  change: Change;
}

export interface SpendingFootprint {
  // = the spending card (comparison.current.metrics.expense); null when the period has no data (before tracking).
  total: number | null;
  segments: FootprintSegment[];
}

export const FOOTPRINT_TOP = 4;

// The top categories of the period's spending plus «باقي الفئات», each with its change against the comparison's
// previous side. Built on categoryShares (store/spending.ts): the shares are the per-category shares over ALL
// categories (so a category shows the same % here and on «الإنفاق»), the rest is the sum of the others; amounts add up to
// the spending card exactly.
export function spendingFootprint(comparison: PeriodComparison, top: number = FOOTPRINT_TOP): SpendingFootprint {
  const c = comparison.currency;
  const shares = categoryShares(comparison);
  if (shares.total === null) return { total: null, segments: [] };
  if (shares.total <= EPSILON || shares.rows.length === 0) return { total: shares.total, segments: [] };
  const head = shares.rows.slice(0, top);
  const rest = shares.rows.slice(top);
  const segments: FootprintSegment[] = head.map((r) => ({ key: r.categoryId, categoryIds: [r.categoryId], amount: r.amount, share: r.tenths / 1000, tenths: r.tenths, change: r.change }));
  if (rest.length > 0) {
    const ids = rest.map((r) => r.categoryId);
    const amount = sumIn(rest.map((r) => r.amount), c);
    // The previous side of the same categories (a real 0 for a tracked side that didn't spend on them).
    const previousSide = comparison.previous?.categories;
    const previous: MetricValue = !comparison.previous
      ? unavailable('no_previous')
      : !previousSide
        ? unavailable('before_tracking')
        : { value: sumIn(ids.map((id) => previousSide.get(id)?.amount ?? 0), c), quality: 'recorded' };
    const tenths = rest.reduce((t, r) => t + r.tenths, 0);
    segments.push({
      key: 'rest',
      categoryIds: ids,
      amount,
      share: tenths / 1000,
      tenths,
      change: compareValues(previous, { value: amount, quality: 'recorded' }, { kind: 'amount', goodWhen: 'none', currency: c }),
    });
  }
  return { total: shares.total, segments };
}
