import { addIn, roundIn, sumIn } from '@/utils/money';
import { daysBetween } from '@/utils/dates';
import { periodTotals } from './analytics';
import { createMemoCache, memoOn } from './memo';
import { alignToElapsed, coverageOf, measuredTo, previousAnalyticsPeriod, type AnalyticsPeriod, type Coverage } from './periods';
import { fundMovementRows, isContribution, movementAmountIn, transactionAmountIn } from './selectors';
import type { CurrencyCode, ExpenseBucket, FinanceState } from './types';

// The comparison engine (Phase 1b, design §7). Pure and read-only: every number comes from the existing tested
// analytics (`periodTotals`: income, spending incl. fees, buckets, categories, transfers / exchanges / gold purchases
// excluded) and fund selectors; this module adds the «من صندوق» split, the D4 savings rate, coverage, alignment and
// the change rules. Nothing here can produce NaN or Infinity.

type State = FinanceState;
const EPSILON = 0.005;

// --- Values and changes ------------------------------------------------------------------------------------------

// recorded: what the records say (flows, as currently recorded; recorded snapshots) · reconstructed: derived from the
// current ledger for a past date · estimated: needs a value that wasn't recorded (e.g. today's prices for a past
// date) · unavailable: no value at all.
export type Quality = 'recorded' | 'reconstructed' | 'estimated' | 'unavailable';
const QUALITY_ORDER: Quality[] = ['recorded', 'reconstructed', 'estimated', 'unavailable'];
export const weakerQuality = (a: Quality, b: Quality): Quality => QUALITY_ORDER[Math.max(QUALITY_ORDER.indexOf(a), QUALITY_ORDER.indexOf(b))];

export type ValueReason =
  | 'before_tracking' // the period ends before tracking started
  | 'no_previous' // nothing to compare with (since-start, the first pay cycle)
  | 'no_income' // a rate without income
  | 'no_days' // an average over no tracked day
  | 'not_recorded' // a past date without a recorded snapshot (and not reconstructable for this metric)
  | 'future'
  | 'rates_missing'; // the rates the record points at are not in the data

export interface MetricValue {
  // In the comparison's currency (amounts) or a ratio 0..1+ (rates); null when there is none.
  value: number | null;
  quality: Quality;
  reason?: ValueReason;
}

export const unavailable = (reason: ValueReason): MetricValue => ({ value: null, quality: 'unavailable', reason });

export type MetricKind = 'amount' | 'ratio';
// Which direction is good news: 'none' for figures that aren't good or bad by themselves (spending, reservations).
export type GoodWhen = 'up' | 'down' | 'none';

export type ChangeReason = 'unavailable' | 'zero_base' | 'sign_flip';

export interface Change {
  kind: MetricKind;
  previous: MetricValue;
  current: MetricValue;
  // current − previous (rounded in the currency for amounts); null when a side has no value.
  delta: number | null;
  // Amounts only: delta ÷ |previous|; null on a zero or sign-flipped base (never ±∞).
  pct: number | null;
  // Ratios only: the difference in percentage points (0.042 = +4.2 points); never a % of a %.
  pp: number | null;
  direction: 'up' | 'down' | 'flat' | null;
  reason?: ChangeReason;
  tone: 'good' | 'attention' | 'neutral';
  quality: Quality;
}

export interface ChangeSpec {
  kind: MetricKind;
  goodWhen: GoodWhen;
  // Amounts: rounding of the delta.
  currency?: CurrencyCode;
}

// Below these a change is "flat": 1 % of the base (amounts, at least half a minor unit) / 0.1 point (ratios).
export const FLAT_SHARE = 0.01;
export const FLAT_POINTS = 0.001;

export function compareValues(previous: MetricValue, current: MetricValue, spec: ChangeSpec): Change {
  const quality = weakerQuality(previous.quality, current.quality);
  const base = { kind: spec.kind, previous, current, quality };
  if (previous.value === null || current.value === null || !Number.isFinite(previous.value) || !Number.isFinite(current.value)) {
    return { ...base, delta: null, pct: null, pp: null, direction: null, reason: 'unavailable', tone: 'neutral' };
  }
  const p = previous.value;
  const c = current.value;
  const tone = (direction: Change['direction']): Change['tone'] =>
    direction === 'up' || direction === 'down'
      ? spec.goodWhen === 'none'
        ? 'neutral'
        : (direction === 'up') === (spec.goodWhen === 'up')
          ? 'good'
          : 'attention'
      : 'neutral';

  if (spec.kind === 'ratio') {
    const pp = Math.round((c - p) * 1e9) / 1e9;
    const direction = Math.abs(pp) < FLAT_POINTS ? 'flat' : pp > 0 ? 'up' : 'down';
    return { ...base, delta: pp, pct: null, pp, direction, tone: tone(direction) };
  }

  const delta = spec.currency ? roundIn(c - p, spec.currency) : Math.round((c - p) * 1e9) / 1e9;
  const flat = Math.abs(delta) < Math.max(EPSILON, FLAT_SHARE * Math.abs(p));
  const direction = flat ? 'flat' : delta > 0 ? 'up' : 'down';
  let pct: number | null = null;
  let reason: ChangeReason | undefined;
  if (Math.abs(p) < EPSILON) reason = Math.abs(c) < EPSILON ? undefined : 'zero_base';
  else if (Math.abs(c) >= EPSILON && Math.sign(p) !== Math.sign(c)) reason = 'sign_flip';
  else pct = delta / Math.abs(p);
  return { ...base, delta, pct, pp: null, direction, ...(reason ? { reason } : {}), tone: tone(direction) };
}

// --- Flow metrics of one period (Mode A) ---------------------------------------------------------------------------

export type FlowMetricId =
  | 'income'
  | 'expense'
  | 'net'
  | 'savingsRate'
  | 'savingsRateExFundSpending'
  | 'avgDailySpending'
  | 'expenseFromFunds'
  | 'expenseFromFreeMoney'
  | 'fundContributions';

export const FLOW_METRICS: Record<FlowMetricId, Omit<ChangeSpec, 'currency'>> = {
  income: { kind: 'amount', goodWhen: 'up' },
  expense: { kind: 'amount', goodWhen: 'none' },
  net: { kind: 'amount', goodWhen: 'up' },
  savingsRate: { kind: 'ratio', goodWhen: 'up' },
  savingsRateExFundSpending: { kind: 'ratio', goodWhen: 'up' },
  avgDailySpending: { kind: 'amount', goodWhen: 'none' },
  expenseFromFunds: { kind: 'amount', goodWhen: 'none' },
  expenseFromFreeMoney: { kind: 'amount', goodWhen: 'none' },
  fundContributions: { kind: 'amount', goodWhen: 'up' },
};

export interface FlowOptions {
  currency: CurrencyCode;
  // Include expenses marked «مصروف لمرة واحدة» (as the Analytics toggle).
  includeOneTime: boolean;
}

export interface PeriodSide {
  period: AnalyticsPeriod;
  // The dates actually measured: [from, to] or up to today while in progress.
  measured: { from: string; to: string } | null;
  coverage: Coverage;
  metrics: Record<FlowMetricId, MetricValue>;
  // Spending per category in the measured range (null when the side has no data at all).
  categories: Map<string, { amount: number; bucket: ExpenseBucket }> | null;
}

// Fund money each expense SPENT («من صندوق», its 'spend' movements), in the expense's currency. Memoized on the
// movements.
const spendCache = createMemoCache<Map<string, number[]>>();
function spendByExpense(state: Pick<State, 'reservationMovements'>): Map<string, number[]> {
  return memoOn(spendCache, [state.reservationMovements], '', () => {
    const out = new Map<string, number[]>();
    for (const m of state.reservationMovements) {
      if (m.kind !== 'spend' || !m.sourceTransactionId) continue;
      const list = out.get(m.sourceTransactionId);
      if (list) list.push(-m.amount);
      else out.set(m.sourceTransactionId, [-m.amount]);
    }
    return out;
  });
}

const flowCache = createMemoCache<PeriodSide>();

// The flow metrics of a period. A period that ends before tracking started has none (unavailable, never zero).
export function periodSide(state: State, period: AnalyticsPeriod, options: FlowOptions): PeriodSide {
  const key = JSON.stringify([period, options]);
  return memoOn(
    flowCache,
    [state.transactions, state.reservationMovements, state.unresolvedMovements, state.rateSnapshots, state.categories, state.accounts, state.settings],
    key,
    () => computeSide(state, period, options)
  );
}

function computeSide(state: State, period: AnalyticsPeriod, options: FlowOptions): PeriodSide {
  const coverage = coverageOf(state, period);
  const c = options.currency;
  if (period.notes.includes('before_tracking')) {
    const none = unavailable('before_tracking');
    return {
      period,
      measured: null,
      coverage,
      metrics: Object.fromEntries(Object.keys(FLOW_METRICS).map((id) => [id, none])) as Record<FlowMetricId, MetricValue>,
      categories: null,
    };
  }
  const measured = { from: period.from, to: measuredTo(period) };
  const totals = periodTotals(state, { period: { kind: 'custom', ...measured }, currency: c, includeOneTime: options.includeOneTime });

  // «من صندوق»: the spends of the expenses counted above (same range, same one-time rule), each at its expense's rates.
  const spends = spendByExpense(state);
  let fromFunds = 0;
  for (const tx of state.transactions) {
    if (tx.type !== 'expense' || tx.date < measured.from || tx.date > measured.to) continue;
    if (tx.oneTime && !options.includeOneTime) continue;
    const amounts = spends.get(tx.id);
    if (!amounts) continue;
    const native = Math.min(roundIn(sumIn(amounts, tx.currency), tx.currency), tx.amount);
    fromFunds = addIn(fromFunds, transactionAmountIn(state, { amount: native, currency: tx.currency, rateSnapshotId: tx.rateSnapshotId }, c), c);
  }

  const contributions = sumIn(
    fundMovementRows(state)
      .filter((m) => m.date >= measured.from && m.date <= measured.to && isContribution(m))
      .map((m) => movementAmountIn(state, m, c)),
    c
  );

  const recorded = (value: number): MetricValue => ({ value, quality: 'recorded' });
  const ratio = (numerator: number): MetricValue =>
    totals.income > EPSILON ? recorded(numerator / totals.income) : unavailable('no_income');
  // Tracked days measured (the clamped start up to today while in progress).
  const elapsedTracked = measured.to < measured.from ? 0 : daysBetween(measured.from, measured.to) + 1;
  const freeSpending = roundIn(totals.expense - fromFunds, c);

  return {
    period,
    measured,
    coverage,
    metrics: {
      income: recorded(totals.income),
      expense: recorded(totals.expense),
      net: recorded(totals.net),
      savingsRate: ratio(totals.net),
      savingsRateExFundSpending: ratio(roundIn(totals.income - freeSpending, c)),
      avgDailySpending: elapsedTracked > 0 ? recorded(roundIn(totals.expense / elapsedTracked, c)) : unavailable('no_days'),
      expenseFromFunds: recorded(fromFunds),
      expenseFromFreeMoney: recorded(freeSpending),
      fundContributions: recorded(contributions),
    },
    categories: totals.byCategory,
  };
}

// --- Period vs period ----------------------------------------------------------------------------------------------

// 'elapsed': an in-progress current period against the same number of days of the previous one (D10 default);
// 'full': against the whole previous period.
export type Alignment = 'elapsed' | 'full';

export type ComparisonNote =
  | 'aligned_elapsed' // the previous side was cut to the same elapsed days
  | 'current_in_progress' // compared with a whole previous period while the current one isn't over
  | 'previous_partly_untracked' // the previous side starts before tracking (clamped)
  | 'current_partly_untracked'
  | 'previous_untracked' // the previous side ends before tracking: nothing to compare
  | 'no_previous';

export interface CategoryChange {
  categoryId: string;
  bucket: ExpenseBucket;
  change: Change;
}

export interface PeriodComparison {
  currency: CurrencyCode;
  current: PeriodSide;
  previous: PeriodSide | null;
  alignment: Alignment | null;
  metrics: Record<FlowMetricId, Change>;
  // Union of both sides' categories, biggest absolute change first.
  categories: CategoryChange[];
  notes: ComparisonNote[];
  // When the previous side isn't (fully) tracked: the earliest date that is.
  earliestReliable?: string;
}

export interface ComparePeriodsInput extends FlowOptions {
  current: AnalyticsPeriod;
  // Defaults to the preset's previous period; null = compare with nothing.
  previous?: AnalyticsPeriod | null;
  // Defaults to 'elapsed' (applies only while `current` is in progress).
  alignment?: Alignment;
}

export function comparePeriods(state: State, input: ComparePeriodsInput): PeriodComparison {
  const options: FlowOptions = { currency: input.currency, includeOneTime: input.includeOneTime };
  const current = periodSide(state, input.current, options);
  const notes: ComparisonNote[] = [];
  if (input.current.notes.includes('clamped_to_tracking')) notes.push('current_partly_untracked');

  let previousPeriod = input.previous === undefined ? previousAnalyticsPeriod(state, input.current) : input.previous;
  let alignment: Alignment | null = null;
  if (previousPeriod && input.current.inProgress) {
    alignment = input.alignment ?? 'elapsed';
    if (alignment === 'elapsed') {
      previousPeriod = alignToElapsed(state, input.current, previousPeriod);
      notes.push('aligned_elapsed');
    } else notes.push('current_in_progress');
  }
  const previous = previousPeriod ? periodSide(state, previousPeriod, options) : null;
  if (!previous) notes.push('no_previous');
  else if (previous.period.notes.includes('before_tracking')) notes.push('previous_untracked');
  else if (previous.period.notes.includes('clamped_to_tracking')) notes.push('previous_partly_untracked');

  const metrics = Object.fromEntries(
    (Object.keys(FLOW_METRICS) as FlowMetricId[]).map((id) => [
      id,
      compareValues(previous ? previous.metrics[id] : unavailable('no_previous'), current.metrics[id], {
        ...FLOW_METRICS[id],
        currency: input.currency,
      }),
    ])
  ) as Record<FlowMetricId, Change>;

  // Categories: a category missing on a side that HAS data spent 0 there (a real 0); a side without data is unavailable.
  const ids = new Set([...(current.categories?.keys() ?? []), ...(previous?.categories?.keys() ?? [])]);
  const side = (s: PeriodSide | null, id: string): MetricValue =>
    !s || !s.categories ? unavailable(s ? 'before_tracking' : 'no_previous') : { value: s.categories.get(id)?.amount ?? 0, quality: 'recorded' };
  const categories: CategoryChange[] = [...ids]
    .map((categoryId) => ({
      categoryId,
      bucket: (current.categories?.get(categoryId) ?? previous?.categories?.get(categoryId))!.bucket,
      change: compareValues(side(previous, categoryId), side(current, categoryId), { kind: 'amount', goodWhen: 'none', currency: input.currency }),
    }))
    .sort((a, b) => Math.abs(b.change.delta ?? 0) - Math.abs(a.change.delta ?? 0) || (a.categoryId < b.categoryId ? -1 : 1));

  const partly = notes.includes('previous_untracked') || notes.includes('previous_partly_untracked');
  return {
    currency: input.currency,
    current,
    previous,
    alignment,
    metrics,
    categories,
    notes,
    ...(partly ? { earliestReliable: state.settings.trackingStartDate } : {}),
  };
}
