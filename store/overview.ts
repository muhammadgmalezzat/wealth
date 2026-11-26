import { monthOf, shiftMonth, toDateKey } from '@/utils/dates';
import { netWorthSeries } from './analytics';
import { cashflowChart, spendingFootprint, type CashflowChart, type SpendingFootprint } from './cashflowCharts';
import { compareValues, comparePeriods, unavailable, type Alignment, type Change, type MetricValue, type PeriodComparison } from './comparison';
import type { DailySnapshotStore } from './dailySnapshots';
import { netWorthDailySeries, pointValues, POINT_METRICS, type DateSide, type PointMetricId, type SeriesPoint } from './history';
import type { AnalyticsPeriod } from './periods';
import { openReceivablesValue } from './selectors';
import type { CurrencyCode, FinanceState } from './types';

// The Overview tab's numbers (Phase 2), composed from the Phase 1b engine only: Mode A for the flows, point values at
// the two sides' measured end dates for net worth and the money position, the daily series for the chart. No UI
// strings, no new formulas.

type State = FinanceState;

export interface OverviewInput {
  period: AnalyticsPeriod;
  alignment: Alignment;
  currency: CurrencyCode;
  now: Date;
  dailyStore: DailySnapshotStore | null;
}

export interface Overview {
  comparison: PeriodComparison;
  // The dates point metrics are read at: the current side's measured end (today while in progress) and the previous
  // side's (aligned) end; null without a comparable previous side.
  endDate: string;
  previousEndDate: string | null;
  current: DateSide;
  previous: DateSide | null;
  // Point metrics from the previous end to the current end.
  point: Record<PointMetricId, Change>;
  // The daily chart (gaps are null).
  series: SeriesPoint[];
  // The first recorded day of the daily history, or null when there is none yet.
  dailySince: string | null;
  // «التدفق الشهري» (weeks for periods of a month or less), the monthly sparklines of the flow cards (always the last 6
  // months up to the period's end), and «بصمة الإنفاق». All from recorded transactions only.
  cashflow: CashflowChart;
  sparkline: CashflowChart;
  footprint: SpendingFootprint;
  // Day-by-day values for the snapshot-based cards, only once the period has at least MIN_SPARK_DAYS recorded days
  // (null days are gaps); null before that.
  pointSparks: { freeMoney: (number | null)[]; reserved: (number | null)[] } | null;
  // The hero's «شهري» view: one point per month from the monthly net worth snapshots (the old «صافي الثروة عبر الوقت»
  // numbers, all locations, estimated ones included), months without one are gaps; up to MAX_MONTHS ending with the
  // period's last month. Every point is an estimate of the month's end (the last value the app saw that month).
  monthly: { month: string; value: number | null; live: boolean }[];
  // «فلوس ليّا غير محصّلة»: informational, never part of net worth; only when the end date is today (it is a
  // current figure).
  openReceivables: number | null;
}

export const MAX_MONTHS = 24;

function monthlyPoints(state: State, currency: CurrencyCode, now: Date, endMonth: string): Overview['monthly'] {
  const points = netWorthSeries(state, { location: 'all', currency, includeEstimated: true, now }).points.filter((p) => p.month <= endMonth);
  if (points.length === 0) return [];
  const byMonth = new Map(points.map((p) => [p.month, p]));
  const first = points[0].month < shiftMonth(endMonth, -(MAX_MONTHS - 1)) ? shiftMonth(endMonth, -(MAX_MONTHS - 1)) : points[0].month;
  const out: Overview['monthly'] = [];
  for (let m = first; m <= endMonth; m = shiftMonth(m, 1)) {
    const p = byMonth.get(m);
    out.push({ month: m, value: p ? p.total : null, live: !!p?.live });
  }
  return out;
}

// Snapshot-based sparklines need at least this many recorded days.
export const MIN_SPARK_DAYS = 7;

export function overview(state: State, input: OverviewInput): Overview {
  const { period, alignment, currency, now, dailyStore } = input;
  const today = toDateKey(now);
  const comparison = comparePeriods(state, { current: period, alignment, currency, includeOneTime: true });
  const endDate = comparison.current.measured?.to ?? period.to;
  const previousEndDate = comparison.previous?.measured?.to ?? null;
  const current = pointValues(state, dailyStore, endDate > today ? today : endDate, currency, now);
  const previous = previousEndDate ? pointValues(state, dailyStore, previousEndDate, currency, now) : null;
  const ids = Object.keys(POINT_METRICS) as PointMetricId[];
  const point = Object.fromEntries(
    ids.map((id) => {
      const before: MetricValue = previous ? previous.metrics[id] : unavailable('no_previous');
      return [id, compareValues(before, current.metrics[id], { ...POINT_METRICS[id], currency })];
    })
  ) as Record<PointMetricId, Change>;
  const receivables = endDate >= today ? openReceivablesValue(state, currency) : null;
  const series = netWorthDailySeries(state, dailyStore, { from: period.from, to: endDate }, currency, now);
  const recordedDays = series.filter((p) => p.metrics !== null).length;
  return {
    comparison,
    endDate: current.at.date,
    previousEndDate,
    current,
    previous,
    point,
    series,
    cashflow: cashflowChart(state, period, { currency }),
    sparkline: cashflowChart(state, period, { currency, unit: 'month', minMonths: 6, followPeriod: false }),
    footprint: spendingFootprint(comparison),
    pointSparks:
      recordedDays >= MIN_SPARK_DAYS
        ? { freeMoney: series.map((p) => p.metrics?.freeMoney ?? null), reserved: series.map((p) => p.metrics?.reserved ?? null) }
        : null,
    monthly: monthlyPoints(state, currency, now, monthOf(endDate > today ? today : endDate)),
    dailySince: dailyStore?.days[0]?.d ?? null,
    openReceivables: receivables !== null && Math.abs(receivables) >= 0.005 ? receivables : null,
  };
}
