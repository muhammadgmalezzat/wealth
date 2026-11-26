import { daysBetween, monthOf, shiftDate } from '@/utils/dates';
import { sumIn } from '@/utils/money';
import { monthEnd, oneTimeSpend, spendingByAccount, spendingByCurrency, spendingByDay, type AnalyticsQuery, type NativeSpend, type Period } from './analytics';
import { spendingFootprint, type SpendingFootprint } from './cashflowCharts';
import { comparePeriods, compareValues, type Alignment, type Change, type PeriodComparison } from './comparison';
import { createMemoCache, memoOn } from './memo';
import { weekStart, type AnalyticsPeriod } from './periods';
import type { CurrencyCode, ExpenseBucket, FinanceState } from './types';

// The «الإنفاق» tab's numbers (Phase 3). Composition only: flows from comparePeriods (periodTotals underneath), the
// breakdowns from store/analytics.ts' scan (same rows), one-time from oneTimeSpend. Pure and memoized.

type State = FinanceState;
const EPSILON = 0.005;

export { categoryShares, largestRemainder, type CategoryShare, type CategoryShares } from './shares';
import { categoryShares, type CategoryShares } from './shares';

// --- Old-screen periods (the sections kept from the old tab) ------------------------------------------------------------

// The old Analytics period for a new one, so the sections kept from the old tab (money map, runway, funds, notes)
// show exactly the numbers they showed before: this month / 3 / 6 / 12 months and since-start as the old presets
// (to the end of this month, like before); anything else as a custom range of the same dates.
export function legacyPeriodOf(period: AnalyticsPeriod): Period {
  const months: Partial<Record<AnalyticsPeriod['preset'], [Period['kind'], number]>> = { month: ['month', 1], '3m': ['3m', 3], '6m': ['6m', 6], '12m': ['year', 12] };
  const legacy = months[period.preset];
  if (legacy) return { kind: legacy[0], months: legacy[1], from: period.from, to: period.to };
  if (period.preset === 'sinceStart') return { kind: 'sinceStart', from: period.from, to: monthEnd(monthOf(period.today)) };
  return { kind: 'custom', from: period.from, to: period.to };
}

// --- The tab -------------------------------------------------------------------------------------------------------------

export interface SpendBar {
  // The day, or the week's Saturday.
  key: string;
  from: string;
  to: string;
  amount: number;
}

export interface SpendingView {
  comparison: PeriodComparison;
  shares: CategoryShares;
  // The donut's slices: top 4 + «باقي الفئات», the same as the Overview's «بصمة الإنفاق».
  footprint: SpendingFootprint;
  // The measured range as a query (what drill-downs and the breakdowns use).
  query: AnalyticsQuery | null;
  // Day by day over the tracked, measured days (a day without spending is a real 0); weeks (from Saturday) beyond
  // MAX_DAILY_BARS days. `average` = spending ÷ bars (per day: the card's average daily spending).
  trend: { unit: 'day' | 'week'; bars: SpendBar[]; average: number | null };
  byAccount: NativeSpend[];
  byCurrency: NativeSpend[];
  // One-time spending in the period whatever the toggle says (oneTimeSpend), and its share of all spending.
  oneTime: { amount: number; ofTotal: number | null };
  // Where the spending came from: «من صندوق» vs free money (Phase 1b metrics).
  fromFunds: number | null;
  fromFree: number | null;
}

export const MAX_DAILY_BARS = 92;

export interface SpendingInput {
  period: AnalyticsPeriod;
  alignment: Alignment;
  currency: CurrencyCode;
  includeOneTime: boolean;
  // Defaults to the preset's previous period.
  previous?: AnalyticsPeriod | null;
}

const cache = createMemoCache<SpendingView>();

export function spendingView(state: State, input: SpendingInput): SpendingView {
  return memoOn(
    cache,
    [state.transactions, state.reservationMovements, state.unresolvedMovements, state.rateSnapshots, state.categories, state.accounts, state.settings],
    JSON.stringify(input),
    () => compute(state, input)
  );
}

function compute(state: State, input: SpendingInput): SpendingView {
  const { currency, includeOneTime } = input;
  const comparison = comparePeriods(state, { current: input.period, ...(input.previous !== undefined ? { previous: input.previous } : {}), alignment: input.alignment, currency, includeOneTime });
  const measured = comparison.current.measured;
  const shares = categoryShares(comparison);
  if (!measured) {
    return { comparison, shares, footprint: spendingFootprint(comparison), query: null, trend: { unit: 'day', bars: [], average: null }, byAccount: [], byCurrency: [], oneTime: { amount: 0, ofTotal: null }, fromFunds: null, fromFree: null };
  }
  const query: AnalyticsQuery = { period: { kind: 'custom', ...measured }, currency, includeOneTime };
  const perDay = spendingByDay(state, query);
  const days = daysBetween(measured.from, measured.to) + 1;
  const bars: SpendBar[] = [];
  if (days <= MAX_DAILY_BARS) {
    for (let d = measured.from; d <= measured.to; d = shiftDate(d, 1)) bars.push({ key: d, from: d, to: d, amount: perDay.get(d) ?? 0 });
  } else {
    for (let w = weekStart(measured.from); w <= measured.to; w = shiftDate(w, 7)) {
      const from = w < measured.from ? measured.from : w;
      const end = shiftDate(w, 6);
      const to = end > measured.to ? measured.to : end;
      const amounts: number[] = [];
      for (let d = from; d <= to; d = shiftDate(d, 1)) amounts.push(perDay.get(d) ?? 0);
      bars.push({ key: w, from, to, amount: sumIn(amounts, currency) });
    }
  }
  const total = comparison.current.metrics.expense.value ?? 0;
  const oneTime = oneTimeSpend(state, query);
  // The base the one-time share is of: all spending incl. one-time (like the old note).
  const base = total + (includeOneTime ? 0 : oneTime);
  return {
    comparison,
    shares,
    footprint: spendingFootprint(comparison),
    query,
    trend: { unit: days <= MAX_DAILY_BARS ? 'day' : 'week', bars, average: bars.length > 0 ? Math.round((total / bars.length) * 100) / 100 : null },
    byAccount: spendingByAccount(state, query),
    byCurrency: spendingByCurrency(state, query),
    oneTime: { amount: oneTime, ofTotal: base > EPSILON ? oneTime / base : null },
    fromFunds: comparison.current.metrics.expenseFromFunds.value,
    fromFree: comparison.current.metrics.expenseFromFreeMoney.value,
  };
}

// One category, period A against period B (the comparison engine's own category change).
export function compareCategory(view: SpendingView, categoryId: string): Change {
  const found = view.comparison.categories.find((c) => c.categoryId === categoryId);
  if (found) return found.change;
  // Spent in neither side: a real 0 on both tracked sides.
  const side = (has: boolean) => (has ? { value: 0, quality: 'recorded' as const } : { value: null, quality: 'unavailable' as const, reason: 'no_previous' as const });
  return compareValues(side(!!view.comparison.previous?.categories), side(!!view.comparison.current.categories), { kind: 'amount', goodWhen: 'none', currency: view.comparison.currency });
}
