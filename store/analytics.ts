import { formatMoney } from '@/components/ui/formatMoney';
import { convertCurrency, fromEGP, toEGP } from '@/utils/currency';
import { addMonthsToDate, daysBetween, isDateKey, monthOf, shiftDate, shiftMonth, toDateKey, toMonthKey } from '@/utils/dates';
import { formatMonthLabel, formatPercent } from '@/utils/formatters';
import { CATEGORY_IDS } from './defaultCategories';
import {
  fundCashByCurrency,
  fundCurrent,
  fundDueDate,
  fundLinkedValue,
  fundProgress,
  fundsByPriority,
  fundStatus,
  goldPricePerGram,
  holdingValueEGP,
  liquidByCurrency,
  movementAmountIn,
  movementValueInFund,
  netWorthBreakdown,
  netWorthEGP,
  netWorthFigures,
  transactionAmountIn,
  unassignedSummary,
} from './selectors';
import { daysInMonth } from './shared';
import type {
  CurrencyCode,
  ExpenseBucket,
  FinanceState,
  GoldKarat,
  Location,
  NetWorthBreakdown,
  RatesSnapshot,
  Transaction,
} from './types';

// Numbers for the Analytics tab. Pure functions only (unit-tested), no React Native.
//
// Conversion rules, as everywhere in the app: a transaction or fund movement is shown in the
// display currency as it was worth when recorded (same currency: unchanged; otherwise its own
// rate snapshots), so history never moves when settings rates change. Only current valuations
// (the money map, runway, today's net worth) use today's rates; net worth snapshots use the
// rates they were valued at. Transfers are not spending; asset purchases (gold) are shown as a
// destination of money, never as spending. Presets never reach before trackingStartDate; a
// custom period that starts earlier explicitly covers it.

type State = FinanceState;

const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);
const EPSILON = 0.005;

export type DisplayCurrency = 'EGP' | 'SAR';
export type PeriodKind = 'month' | '3m' | '6m' | 'year' | 'sinceStart' | 'custom';

export const BUCKET_LABELS: Record<ExpenseBucket, string> = {
  essentials: 'أساسيات',
  lifestyle: 'رفاهيات',
  giving: 'عطاء',
};
const EXPENSE_BUCKETS: ExpenseBucket[] = ['essentials', 'lifestyle', 'giving'];

// --- Periods ------------------------------------------------------------------

export interface Period {
  kind: PeriodKind;
  // Inclusive date keys.
  from: string;
  to: string;
  // Whole calendar months for month / 3m / 6m / year (the nominal length, before `from` is
  // clamped to the tracking start).
  months?: number;
}

export interface AnalyticsQuery {
  period: Period;
  currency: DisplayCurrency;
  // Include expenses marked "لمرة واحدة".
  includeOneTime: boolean;
}

const PRESET_MONTHS: Partial<Record<PeriodKind, number>> = { month: 1, '3m': 3, '6m': 6, year: 12 };

const pad = (n: number) => String(n).padStart(2, '0');
export const monthStart = (month: string) => `${month}-01`;
export const monthEnd = (month: string) => `${month}-${pad(daysInMonth(month))}`;

// "الشهر ده" (this calendar month), "3 شهور" / "6 شهور" / "السنة" (that many calendar months up to
// and including this one), "من بداية التتبع", or a custom range. Presets start no earlier than
// the tracking start date.
export function resolvePeriod(
  state: Pick<State, 'settings'>,
  kind: PeriodKind,
  now: Date,
  custom?: { from: string; to: string }
): Period {
  const start = state.settings.trackingStartDate;
  const current = toMonthKey(now);
  const months = PRESET_MONTHS[kind];
  if (months) {
    const nominal = monthStart(shiftMonth(current, -(months - 1)));
    return { kind, months, from: nominal < start ? start : nominal, to: monthEnd(current) };
  }
  if (kind === 'sinceStart') return { kind, from: start, to: monthEnd(current) };
  const a = custom?.from ?? start;
  const b = custom?.to ?? monthEnd(current);
  return { kind: 'custom', from: a <= b ? a : b, to: a <= b ? b : a };
}

// The equal period right before (same number of months, or days for a custom one). null when
// there is nothing to compare with: it would start before tracking did.
export function previousPeriod(state: Pick<State, 'settings'>, period: Period): Period | null {
  const start = state.settings.trackingStartDate;
  if (period.months) {
    const endMonth = monthOf(period.to);
    const fromMonth = shiftMonth(endMonth, -(2 * period.months - 1));
    if (fromMonth < monthOf(start)) return null;
    const nominal = monthStart(fromMonth);
    return {
      kind: period.kind,
      months: period.months,
      from: nominal < start ? start : nominal,
      to: monthEnd(shiftMonth(endMonth, -period.months)),
    };
  }
  if (period.kind === 'sinceStart') return null;
  const length = daysBetween(period.from, period.to) + 1;
  const to = shiftDate(period.from, -1);
  const from = shiftDate(to, -(length - 1));
  return from < start ? null : { kind: 'custom', from, to };
}

// 'YYYY-MM' keys the period touches, oldest first.
export function monthsInPeriod(period: Pick<Period, 'from' | 'to'>): string[] {
  const result: string[] = [];
  for (let m = monthOf(period.from); m <= monthOf(period.to) && result.length < 600; m = shiftMonth(m, 1)) result.push(m);
  return result;
}

const inPeriod = (date: string, period: Pick<Period, 'from' | 'to'>) => date >= period.from && date <= period.to;

// --- Records --------------------------------------------------------------------

interface Rec {
  kind: 'income' | 'expense' | 'gold';
  id: string;
  date: string;
  month: string;
  // In the display currency, as recorded.
  amount: number;
  categoryId?: string;
  bucket?: ExpenseBucket;
  oneTime: boolean;
}

function bucketLookup(state: State) {
  const bucketOf = new Map(state.categories.map((c) => [c.id, c.bucket]));
  // A category that is gone counts as essentials, like the plan does.
  return (categoryId: string): ExpenseBucket => {
    const bucket = bucketOf.get(categoryId);
    return bucket && bucket !== 'income' ? bucket : 'essentials';
  };
}

function scan(state: State, period: Pick<Period, 'from' | 'to'>, currency: DisplayCurrency, includeOneTime: boolean): Rec[] {
  const bucketFor = bucketLookup(state);
  const result: Rec[] = [];
  for (const tx of state.transactions) {
    if (tx.type === 'transfer' || !inPeriod(tx.date, period)) continue;
    const base = { id: tx.id, date: tx.date, month: monthOf(tx.date), amount: transactionAmountIn(state, tx, currency) };
    if (tx.type === 'asset_purchase') {
      result.push({ ...base, kind: 'gold', oneTime: false });
    } else if (tx.type === 'income') {
      result.push({ ...base, kind: 'income', categoryId: tx.categoryId, oneTime: false });
    } else if (includeOneTime || !tx.oneTime) {
      result.push({ ...base, kind: 'expense', categoryId: tx.categoryId, bucket: bucketFor(tx.categoryId), oneTime: !!tx.oneTime });
    }
  }
  return result;
}

// Net fund movements in the period (allocations minus withdrawals), as made.
function fundsNet(state: State, period: Pick<Period, 'from' | 'to'>, currency: DisplayCurrency): number {
  return sum(
    state.fundMovements.filter((m) => inPeriod(m.date, period)).map((m) => movementAmountIn(state, m, currency))
  );
}

// --- Totals ---------------------------------------------------------------------

export interface PeriodTotals {
  income: number;
  expense: number;
  net: number;
  // net ÷ income; null without income.
  savingsRate: number | null;
  byBucket: Record<ExpenseBucket, number>;
  byCategory: Map<string, { amount: number; bucket: ExpenseBucket }>;
  incomeByCategory: Map<string, number>;
  // Cash turned into gold (not spending), and the net put into / released from funds.
  gold: number;
  fundsNet: number;
}

function totalsOf(state: State, query: AnalyticsQuery, period: Pick<Period, 'from' | 'to'>): PeriodTotals {
  const totals: PeriodTotals = {
    income: 0,
    expense: 0,
    net: 0,
    savingsRate: null,
    byBucket: { essentials: 0, lifestyle: 0, giving: 0 },
    byCategory: new Map(),
    incomeByCategory: new Map(),
    gold: 0,
    fundsNet: fundsNet(state, period, query.currency),
  };
  for (const r of scan(state, period, query.currency, query.includeOneTime)) {
    if (r.kind === 'gold') totals.gold += r.amount;
    else if (r.kind === 'income') {
      totals.income += r.amount;
      totals.incomeByCategory.set(r.categoryId!, (totals.incomeByCategory.get(r.categoryId!) ?? 0) + r.amount);
    } else {
      totals.expense += r.amount;
      totals.byBucket[r.bucket!] += r.amount;
      const entry = totals.byCategory.get(r.categoryId!) ?? { amount: 0, bucket: r.bucket! };
      entry.amount += r.amount;
      totals.byCategory.set(r.categoryId!, entry);
    }
  }
  totals.net = totals.income - totals.expense;
  totals.savingsRate = totals.income > EPSILON ? totals.net / totals.income : null;
  return totals;
}

export function periodTotals(state: State, query: AnalyticsQuery): PeriodTotals {
  return totalsOf(state, query, query.period);
}

// One-time expenses in the period, whatever the toggle says.
export function oneTimeSpend(state: State, query: AnalyticsQuery): number {
  return sum(
    scan(state, query.period, query.currency, true)
      .filter((r) => r.kind === 'expense' && r.oneTime)
      .map((r) => r.amount)
  );
}

// --- Drill-down (tap a node / insight → the transactions behind it) -----------------

export interface DrillFilter {
  type: 'income' | 'expense' | 'asset_purchase';
  bucket?: ExpenseBucket;
  categoryIds?: string[];
  excludeCategoryIds?: string[];
  // Only one-time expenses, even when the toggle leaves them out of the totals.
  oneTimeOnly?: boolean;
}

export interface DrillResult {
  transactions: Transaction[];
  // In the display currency, as recorded.
  total: number;
}

export function drillTransactions(state: State, query: AnalyticsQuery, filter: DrillFilter): DrillResult {
  const bucketFor = bucketLookup(state);
  const transactions = state.transactions
    .filter((tx) => {
      if (tx.type === 'transfer' || tx.type !== filter.type || !inPeriod(tx.date, query.period)) return false;
      if (tx.type === 'asset_purchase') return true;
      if (filter.categoryIds && !filter.categoryIds.includes(tx.categoryId)) return false;
      if (filter.excludeCategoryIds?.includes(tx.categoryId)) return false;
      if (tx.type === 'expense') {
        if (filter.bucket && bucketFor(tx.categoryId) !== filter.bucket) return false;
        if (filter.oneTimeOnly) return !!tx.oneTime;
        if (tx.oneTime && !query.includeOneTime) return false;
      }
      return true;
    })
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1));
  return { transactions, total: sum(transactions.map((tx) => transactionAmountIn(state, tx as never, query.currency))) };
}

// Route params for the drill-down screen, and back (anything invalid → null).
export function drillParams(query: AnalyticsQuery, filter: DrillFilter): Record<string, string> {
  return {
    from: query.period.from,
    to: query.period.to,
    currency: query.currency,
    oneTime: query.includeOneTime ? '1' : '0',
    type: filter.type,
    ...(filter.bucket ? { bucket: filter.bucket } : {}),
    ...(filter.categoryIds ? { cats: filter.categoryIds.join(',') } : {}),
    ...(filter.excludeCategoryIds ? { notCats: filter.excludeCategoryIds.join(',') } : {}),
    ...(filter.oneTimeOnly ? { oneTimeOnly: '1' } : {}),
  };
}

export function parseDrillParams(
  params: Record<string, string | string[] | undefined>
): { query: AnalyticsQuery; filter: DrillFilter } | null {
  const one = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const from = one('from');
  const to = one('to');
  const type = one('type');
  const currency = one('currency');
  if (!from || !to || !isDateKey(from) || !isDateKey(to) || from > to) return null;
  if (type !== 'income' && type !== 'expense' && type !== 'asset_purchase') return null;
  if (currency !== 'EGP' && currency !== 'SAR') return null;
  const bucket = one('bucket');
  const list = (key: string) => {
    const value = one(key);
    return value ? value.split(',').filter(Boolean) : undefined;
  };
  const categoryIds = list('cats');
  const excludeCategoryIds = list('notCats');
  return {
    query: { period: { kind: 'custom', from, to }, currency, includeOneTime: one('oneTime') !== '0' },
    filter: {
      type,
      ...(bucket === 'essentials' || bucket === 'lifestyle' || bucket === 'giving' ? { bucket } : {}),
      ...(categoryIds ? { categoryIds } : {}),
      ...(excludeCategoryIds ? { excludeCategoryIds } : {}),
      ...(one('oneTimeOnly') === '1' ? { oneTimeOnly: true } : {}),
    },
  };
}

const categoryName = (state: State, id: string) => state.categories.find((c) => c.id === id)?.name ?? '—';

// A title for the drill-down screen.
export function describeFilter(state: State, filter: DrillFilter): string {
  if (filter.type === 'asset_purchase') return 'شراء ذهب';
  if (filter.oneTimeOnly) return 'مصاريف لمرة واحدة';
  if (filter.categoryIds?.length === 1) return categoryName(state, filter.categoryIds[0]);
  if (filter.type === 'income') {
    if (filter.excludeCategoryIds) return 'دخل تاني';
    return 'الدخل';
  }
  if (filter.bucket) return filter.excludeCategoryIds ? `${BUCKET_LABELS[filter.bucket]} · تاني` : BUCKET_LABELS[filter.bucket];
  return 'المصاريف';
}

// --- 1. Where did the money go (Sankey) ------------------------------------------

export type FlowNodeKind = 'source' | 'bucket' | 'category' | 'leaf';

export interface FlowNode {
  id: string;
  label: string;
  kind: FlowNodeKind;
  // The node's flow in the display currency.
  value: number;
  // Group for colouring: a bucket, or 'income' / 'balance' / 'funds' / 'gold' / 'surplus'.
  group: ExpenseBucket | 'income' | 'balance' | 'funds' | 'gold' | 'surplus';
  // The transactions behind it; null when it isn't made of transactions.
  drill: DrillFilter | null;
}

export interface FlowLink {
  source: string;
  target: string;
  value: number;
}

export interface SpendingFlow {
  nodes: FlowNode[];
  links: FlowLink[];
  // Everything that flows in equals everything that flows out.
  totalIn: number;
  totalOut: number;
  empty: boolean;
}

const TOP_CATEGORIES_PER_BUCKET = 5;

// Money in (income by source, "من الصناديق" when funds gave money back, "من رصيدك" when more went
// out than came in) → where it went: the three spending buckets, funds, gold ("ذهب"), and
// what was left over ("فايض") → the top 5 categories of each bucket, the rest as "تاني". Each
// source is spread over the destinations in proportion to their size, so it always balances.
export function spendingFlow(state: State, query: AnalyticsQuery): SpendingFlow {
  const totals = periodTotals(state, query);
  const fundsOut = Math.max(0, totals.fundsNet);
  const fundsIn = Math.max(0, -totals.fundsNet);
  const spending = totals.expense;
  const out = spending + fundsOut + totals.gold;
  const inKnown = totals.income + fundsIn;
  const fromBalance = Math.max(0, out - inKnown);
  const surplus = Math.max(0, inKnown - out);

  const sources: FlowNode[] = [];
  const salary = totals.incomeByCategory.get(CATEGORY_IDS.salary) ?? 0;
  const freelance = totals.incomeByCategory.get(CATEGORY_IDS.freelance) ?? 0;
  const otherIncome = totals.income - salary - freelance;
  const incomeSource = (id: string, label: string, value: number, drill: DrillFilter): void => {
    if (value > EPSILON) sources.push({ id, label, kind: 'source', value, group: 'income', drill });
  };
  incomeSource('src:salary', 'راتب', salary, { type: 'income', categoryIds: [CATEGORY_IDS.salary] });
  incomeSource('src:freelance', 'فري لانس', freelance, { type: 'income', categoryIds: [CATEGORY_IDS.freelance] });
  incomeSource('src:other', 'دخل تاني', otherIncome, {
    type: 'income',
    excludeCategoryIds: [CATEGORY_IDS.salary, CATEGORY_IDS.freelance],
  });
  if (fundsIn > EPSILON) sources.push({ id: 'src:funds', label: 'من الصناديق', kind: 'source', value: fundsIn, group: 'funds', drill: null });
  if (fromBalance > EPSILON) sources.push({ id: 'src:balance', label: 'من رصيدك', kind: 'source', value: fromBalance, group: 'balance', drill: null });

  const buckets: FlowNode[] = EXPENSE_BUCKETS.filter((b) => totals.byBucket[b] > EPSILON).map((b) => ({
    id: `bucket:${b}`,
    label: BUCKET_LABELS[b],
    kind: 'bucket' as const,
    value: totals.byBucket[b],
    group: b,
    drill: { type: 'expense' as const, bucket: b },
  }));
  const leaves: FlowNode[] = [];
  if (fundsOut > EPSILON) leaves.push({ id: 'dest:funds', label: 'صناديق', kind: 'leaf', value: fundsOut, group: 'funds', drill: null });
  if (totals.gold > EPSILON) leaves.push({ id: 'dest:gold', label: 'ذهب', kind: 'leaf', value: totals.gold, group: 'gold', drill: { type: 'asset_purchase' } });
  if (surplus > EPSILON) leaves.push({ id: 'dest:surplus', label: 'فايض', kind: 'leaf', value: surplus, group: 'surplus', drill: null });
  const destinations = [...buckets, ...leaves];

  const totalIn = sum(sources.map((s) => s.value));
  const totalOut = sum(destinations.map((d) => d.value));
  const nodes: FlowNode[] = [...sources, ...destinations];
  const links: FlowLink[] = [];
  if (totalIn > EPSILON) {
    for (const source of sources) {
      for (const destination of destinations) {
        links.push({ source: source.id, target: destination.id, value: (source.value * destination.value) / totalIn });
      }
    }
  }

  // The top categories of each bucket; whatever is left over is grouped as "تاني".
  for (const bucket of buckets) {
    const key = bucket.group as ExpenseBucket;
    const ranked = [...totals.byCategory.entries()]
      .filter(([, e]) => e.bucket === key)
      .sort((a, b) => b[1].amount - a[1].amount);
    const top = ranked.slice(0, TOP_CATEGORIES_PER_BUCKET);
    for (const [categoryId, entry] of top) {
      const id = `cat:${key}:${categoryId}`;
      nodes.push({
        id,
        label: categoryName(state, categoryId),
        kind: 'category',
        value: entry.amount,
        group: key,
        drill: { type: 'expense', categoryIds: [categoryId] },
      });
      links.push({ source: bucket.id, target: id, value: entry.amount });
    }
    const rest = ranked.slice(TOP_CATEGORIES_PER_BUCKET);
    const restValue = sum(rest.map(([, e]) => e.amount));
    if (restValue > EPSILON) {
      const id = `cat:${key}:rest`;
      nodes.push({
        id,
        label: 'تاني',
        kind: 'category',
        value: restValue,
        group: key,
        drill: { type: 'expense', bucket: key, excludeCategoryIds: top.map(([categoryId]) => categoryId) },
      });
      links.push({ source: bucket.id, target: id, value: restValue });
    }
  }
  return { nodes, links: links.filter((l) => l.value > EPSILON), totalIn, totalOut, empty: totalIn <= EPSILON };
}

// --- 2. Monthly trend -------------------------------------------------------------

export interface TrendMonth {
  month: string;
  income: number;
  expense: number;
  net: number;
  savingsRate: number | null;
  overspent: boolean;
}

export interface MonthlyTrend {
  months: TrendMonth[];
  // The mean of the months' savings rates (months with income only); null without any.
  averageSavingsRate: number | null;
  monthsWithIncome: number;
}

export function monthlyTrend(state: State, query: AnalyticsQuery): MonthlyTrend {
  const months = monthsInPeriod(query.period);
  const byMonth = new Map(months.map((m) => [m, { income: 0, expense: 0 }]));
  for (const r of scan(state, query.period, query.currency, query.includeOneTime)) {
    const entry = byMonth.get(r.month);
    if (!entry) continue;
    if (r.kind === 'income') entry.income += r.amount;
    else if (r.kind === 'expense') entry.expense += r.amount;
  }
  const rows: TrendMonth[] = months.map((month) => {
    const { income, expense } = byMonth.get(month)!;
    return {
      month,
      income,
      expense,
      net: income - expense,
      savingsRate: income > EPSILON ? (income - expense) / income : null,
      overspent: expense > income + EPSILON,
    };
  });
  const rates = rows.map((r) => r.savingsRate).filter((r): r is number => r !== null);
  return {
    months: rows,
    averageSavingsRate: rates.length > 0 ? sum(rates) / rates.length : null,
    monthsWithIncome: rates.length,
  };
}

// --- 3. Spending breakdown ------------------------------------------------------------

export interface CategoryRow {
  categoryId: string;
  name: string;
  bucket: ExpenseBucket;
  amount: number;
  // Share of the period's spending.
  pct: number;
  // The previous equal period's amount; null when there is nothing to compare with.
  previous: number | null;
  // (amount − previous) ÷ previous; null when previous is 0 or unknown.
  changePct: number | null;
  direction: 'up' | 'down' | 'flat' | null;
  // Spent now, nothing in the previous period.
  isNew: boolean;
}

export interface SpendingBreakdown {
  total: number;
  buckets: { bucket: ExpenseBucket; amount: number; pct: number }[];
  categories: CategoryRow[];
  previousTotal: number | null;
  comparable: boolean;
}

// Below this, a change is "no change".
const FLAT_CHANGE = 0.01;

export function spendingBreakdown(state: State, query: AnalyticsQuery): SpendingBreakdown {
  const totals = periodTotals(state, query);
  const prevPeriod = previousPeriod(state, query.period);
  const prev = prevPeriod ? totalsOf(state, query, prevPeriod) : null;
  const share = (amount: number) => (totals.expense > EPSILON ? amount / totals.expense : 0);
  const categories: CategoryRow[] = [...totals.byCategory.entries()]
    .map(([categoryId, { amount, bucket }]) => {
      const previous = prev ? (prev.byCategory.get(categoryId)?.amount ?? 0) : null;
      const changePct = previous !== null && previous > EPSILON ? (amount - previous) / previous : null;
      const direction =
        previous === null
          ? null
          : changePct === null
            ? amount > EPSILON
              ? ('up' as const)
              : ('flat' as const)
            : Math.abs(changePct) < FLAT_CHANGE
              ? ('flat' as const)
              : changePct > 0
                ? ('up' as const)
                : ('down' as const);
      return {
        categoryId,
        name: categoryName(state, categoryId),
        bucket,
        amount,
        pct: share(amount),
        previous,
        changePct,
        direction,
        isNew: previous !== null && previous <= EPSILON && amount > EPSILON,
      };
    })
    .sort((a, b) => b.amount - a.amount);
  return {
    total: totals.expense,
    buckets: EXPENSE_BUCKETS.map((bucket) => ({ bucket, amount: totals.byBucket[bucket], pct: share(totals.byBucket[bucket]) })).filter(
      (b) => b.amount > EPSILON
    ),
    categories,
    previousTotal: prev ? prev.expense : null,
    comparable: prev !== null,
  };
}

// --- 4. Net worth over time ---------------------------------------------------------------

export type NetWorthLocation = 'all' | Location;

export interface NetWorthPoint {
  month: string;
  // Worked out afterwards rather than recorded in the month.
  estimated: boolean;
  // Today's figures for the current month.
  live: boolean;
  // Cash / gold / currency holdings and the net total (after liabilities), display currency.
  cash: number;
  gold: number;
  currencies: number;
  total: number;
}

export interface NetWorthSeries {
  points: NetWorthPoint[];
  estimatedCount: number;
  // Snapshots left out because they lack the breakdown the chosen location needs.
  skipped: number;
}

// Each snapshot's figures are in EGP at the rates it was valued at; showing them in SAR uses
// those same rates (today's for the current month and for snapshots that didn't keep theirs).
function breakdownPart(b: NetWorthBreakdown, location: NetWorthLocation) {
  const parts = location === 'all' ? [b.EG, b.SA] : [b[location]];
  return {
    cash: sum(parts.map((p) => p.cashEGP)),
    gold: sum(parts.map((p) => p.goldEGP)),
    currencies: sum(parts.map((p) => p.currenciesEGP)),
    // Liabilities are Egypt's.
    liabilities: location === 'SA' ? 0 : b.liabilitiesEGP,
  };
}

export function netWorthSeries(
  state: State,
  options: { location: NetWorthLocation; currency: DisplayCurrency; includeEstimated: boolean; now: Date }
): NetWorthSeries {
  const { location, currency, includeEstimated, now } = options;
  const current = toMonthKey(now);
  const liveRates = state.settings.exchangeRates;
  const points: NetWorthPoint[] = [];
  let skipped = 0;
  const stored = state.netWorthSnapshots.filter((s) => s.month !== current);
  const live = netWorthFigures(state);
  const entries = [
    ...stored.map((s) => ({
      month: s.month,
      estimated: !!s.estimated,
      live: false,
      breakdown: s.breakdown,
      totalEGP: s.netWorthEGP,
      rates: s.ratesSnapshot ?? liveRates,
    })),
    { month: current, estimated: false, live: true, breakdown: live.breakdown, totalEGP: live.netWorthEGP, rates: liveRates },
  ].sort((a, b) => (a.month < b.month ? -1 : 1));
  const show = (egp: number, rates: RatesSnapshot) => (currency === 'EGP' ? egp : fromEGP(egp, currency, rates));
  for (const e of entries) {
    if (e.estimated && !includeEstimated) continue;
    if (!e.breakdown) {
      // Only the total is known: fine for "all", but it can't be split by location.
      if (location !== 'all') {
        skipped += 1;
        continue;
      }
      points.push({ month: e.month, estimated: e.estimated, live: e.live, cash: 0, gold: 0, currencies: 0, total: show(e.totalEGP, e.rates) });
      continue;
    }
    const part = breakdownPart(e.breakdown, location);
    points.push({
      month: e.month,
      estimated: e.estimated,
      live: e.live,
      cash: show(part.cash, e.rates),
      gold: show(part.gold, e.rates),
      currencies: show(part.currencies, e.rates),
      total: show(part.cash + part.gold + part.currencies - part.liabilities, e.rates),
    });
  }
  return { points, estimatedCount: points.filter((p) => p.estimated).length, skipped };
}

// --- 5. Money map (current valuations) -------------------------------------------------------

export interface LiquidRow {
  currency: CurrencyCode;
  // In its own currency, never converted.
  native: number;
  valueEGP: number;
  // In the display currency at today's rate.
  value: number;
}

export interface GoldRow {
  karat: GoldKarat;
  grams: number;
  value: number;
  cost: number;
  pnl: number;
}

export interface MoneyMap {
  liquid: LiquidRow[];
  liquidTotal: number;
  byLocation: { location: Location; cash: number; gold: number; currencies: number; total: number }[];
  gold: { rows: GoldRow[]; grams: number; value: number; cost: number; pnl: number };
  netWorth: number;
  // Gold's share of net worth (0..1); null when net worth isn't positive.
  goldShare: number | null;
}

export function moneyMap(state: State, currency: DisplayCurrency): MoneyMap {
  const rates = state.settings.exchangeRates;
  const show = (egp: number) => (currency === 'EGP' ? egp : fromEGP(egp, currency, rates));
  const native = liquidByCurrency(state);
  const liquid: LiquidRow[] = (['EGP', 'SAR', 'USD'] as CurrencyCode[])
    .filter((c) => state.accounts.some((a) => a.currency === c) || Math.abs(native[c]) > EPSILON)
    .map((c) => ({
      currency: c,
      native: native[c],
      valueEGP: toEGP(native[c], c, rates),
      value: convertCurrency(native[c], c, currency, rates),
    }));

  const breakdown = netWorthBreakdown(state);
  const byLocation = (['EG', 'SA'] as Location[]).map((location) => {
    const b = breakdown[location];
    return {
      location,
      cash: show(b.cashEGP),
      gold: show(b.goldEGP),
      currencies: show(b.currenciesEGP),
      total: show(b.cashEGP + b.goldEGP + b.currenciesEGP),
    };
  });

  const karats = new Map<GoldKarat, { grams: number; valueEGP: number; costEGP: number }>();
  for (const h of state.holdings) {
    if (h.type !== 'gold') continue;
    const row = karats.get(h.karat) ?? { grams: 0, valueEGP: 0, costEGP: 0 };
    row.grams += h.weightGrams;
    row.valueEGP += h.weightGrams * goldPricePerGram(state.settings, h.karat);
    row.costEGP += h.purchaseCostEGP;
    karats.set(h.karat, row);
  }
  const goldRows: GoldRow[] = ([24, 21, 18] as GoldKarat[])
    .filter((k) => karats.has(k))
    .map((karat) => {
      const r = karats.get(karat)!;
      return { karat, grams: r.grams, value: show(r.valueEGP), cost: show(r.costEGP), pnl: show(r.valueEGP - r.costEGP) };
    });
  const goldValueEGP = sum(state.holdings.filter((h) => h.type === 'gold').map((h) => holdingValueEGP(state, h)));
  const goldCostEGP = sum(state.holdings.filter((h) => h.type === 'gold').map((h) => h.purchaseCostEGP));
  const net = netWorthEGP(state);
  return {
    liquid,
    liquidTotal: sum(liquid.map((l) => l.value)),
    byLocation,
    gold: {
      rows: goldRows,
      grams: sum(goldRows.map((r) => r.grams)),
      value: show(goldValueEGP),
      cost: show(goldCostEGP),
      pnl: show(goldValueEGP - goldCostEGP),
    },
    netWorth: show(net),
    goldShare: net > EPSILON ? goldValueEGP / net : null,
  };
}

// --- 6. Runway -----------------------------------------------------------------------------------

export interface RunwayCurrencyRow {
  currency: CurrencyCode;
  liquid: number;
  unassigned: number;
  // Average monthly essentials spent in this currency; 0 when none.
  avgEssentials: number;
  liquidMonths: number | null;
  unassignedMonths: number | null;
}

export interface Runway {
  // Completed months averaged (up to 3, only months with essentials recorded); 0 = not enough data.
  monthsObserved: number;
  // Average monthly essentials (one-time excluded), display currency, as recorded.
  avgEssentials: number;
  unassigned: { amount: number; months: number | null };
  liquid: { amount: number; months: number | null };
  perCurrency: RunwayCurrencyRow[];
}

const RUNWAY_WINDOW = 3;

// How many months the money lasts at the average essentials of the last 3 completed months.
// "Unassigned" is money no fund has set aside; "liquid" is everything in accounts. Both are
// today's values (current rates for the display currency); the average is as recorded.
export function runway(state: State, currency: DisplayCurrency, now: Date): Runway {
  const current = toMonthKey(now);
  const startMonth = monthOf(state.settings.trackingStartDate);
  const window = Array.from({ length: RUNWAY_WINDOW }, (_, i) => shiftMonth(current, -(i + 1))).filter((m) => m >= startMonth);
  const bucketFor = bucketLookup(state);
  const perMonth = new Map<string, number>();
  const nativeTotals: Record<CurrencyCode, number> = { EGP: 0, SAR: 0, USD: 0 };
  const monthsWithEssentials = new Set<string>();
  for (const tx of state.transactions) {
    if (tx.type !== 'expense' || tx.oneTime) continue;
    const month = monthOf(tx.date);
    if (!window.includes(month) || tx.date < state.settings.trackingStartDate) continue;
    if (bucketFor(tx.categoryId) !== 'essentials') continue;
    monthsWithEssentials.add(month);
    perMonth.set(month, (perMonth.get(month) ?? 0) + transactionAmountIn(state, tx, currency));
    nativeTotals[tx.currency] += tx.amount;
  }
  const monthsObserved = monthsWithEssentials.size;
  const avg = monthsObserved > 0 ? sum([...perMonth.values()]) / monthsObserved : 0;
  const months = (amount: number, per: number) => (per > EPSILON ? Math.max(0, amount) / per : null);

  const rates = state.settings.exchangeRates;
  const unassigned = unassignedSummary(state);
  const liquidNative = liquidByCurrency(state);
  const liquidAmount = sum((['EGP', 'SAR', 'USD'] as CurrencyCode[]).map((c) => convertCurrency(liquidNative[c], c, currency, rates)));
  const unassignedAmount = sum(
    (['EGP', 'SAR', 'USD'] as CurrencyCode[]).map((c) => convertCurrency(unassigned.byCurrency[c], c, currency, rates))
  );
  const perCurrency: RunwayCurrencyRow[] = (['EGP', 'SAR', 'USD'] as CurrencyCode[])
    .filter((c) => Math.abs(liquidNative[c]) > EPSILON || nativeTotals[c] > EPSILON)
    .map((c) => {
      const avgNative = monthsObserved > 0 ? nativeTotals[c] / monthsObserved : 0;
      return {
        currency: c,
        liquid: liquidNative[c],
        unassigned: unassigned.byCurrency[c],
        avgEssentials: avgNative,
        liquidMonths: months(liquidNative[c], avgNative),
        unassignedMonths: months(unassigned.byCurrency[c], avgNative),
      };
    });
  return {
    monthsObserved,
    avgEssentials: avg,
    unassigned: { amount: unassignedAmount, months: months(unassignedAmount, avg) },
    liquid: { amount: liquidAmount, months: months(liquidAmount, avg) },
    perCurrency,
  };
}

// --- 7. Funds ----------------------------------------------------------------------------------------

export interface FundProjection {
  fundId: string;
  name: string;
  type: 'emergency' | 'goal' | 'sinking';
  currency: CurrencyCode;
  // Linked gold counts towards `current`.
  current: number;
  target: number;
  // fundProgress as a ratio (can exceed 1).
  pct: number;
  cashByCurrency: Record<CurrencyCode, number>;
  linkedValue: number;
  // Average net allocation per month over the last 3 completed months (fund currency).
  pace: number;
  status: 'completed' | 'projected' | 'stalled';
  // When the target is reached at that pace; null when completed or the pace is 0.
  projectedDate: string | null;
  dueDate: string | null;
  // Projected after the fund's deadline / due date.
  lateVsDue: boolean;
  behind: boolean;
}

export function fundsProjection(state: State, now: Date): FundProjection[] {
  const month = toMonthKey(now);
  const today = toDateKey(now);
  const window = Array.from({ length: RUNWAY_WINDOW }, (_, i) => shiftMonth(month, -(i + 1)));
  return fundsByPriority(state).map((fund) => {
    const moves = state.fundMovements.filter((m) => m.fundId === fund.id);
    const first = moves.map((m) => monthOf(m.date)).sort()[0];
    // The completed months the fund has existed in; a fund started this month is judged on it.
    const observed = first === undefined ? [] : window.filter((m) => m >= first);
    const paced = observed.length > 0 ? observed : [month];
    const pace = sum(moves.filter((m) => paced.includes(monthOf(m.date))).map((m) => movementValueInFund(state, m))) / paced.length;
    const current = fundCurrent(state, fund.id);
    const remaining = Math.max(0, fund.targetAmount - current);
    const dueDate = fundDueDate(fund) ?? null;
    let status: FundProjection['status'] = 'stalled';
    let projectedDate: string | null = null;
    if (remaining <= EPSILON) status = 'completed';
    else if (pace > EPSILON) {
      status = 'projected';
      projectedDate = addMonthsToDate(today, Math.ceil(remaining / pace));
    }
    return {
      fundId: fund.id,
      name: fund.name,
      type: fund.type,
      currency: fund.currency,
      current,
      target: fund.targetAmount,
      pct: fundProgress(state, fund.id),
      cashByCurrency: fundCashByCurrency(state, fund.id),
      linkedValue: fundLinkedValue(state, fund.id),
      pace,
      status,
      projectedDate,
      dueDate,
      lateVsDue: !!projectedDate && !!dueDate && projectedDate > dueDate,
      behind: fundStatus(state, fund.id, now) === 'behind',
    };
  });
}

// --- 8. Insights -----------------------------------------------------------------------------------------

export type InsightTarget =
  | { type: 'drill'; filter: DrillFilter }
  | { type: 'fund'; fundId: string }
  | { type: 'assets' }
  | { type: 'trend' };

export interface Insight {
  id: 'category-increase' | 'savings-rate' | 'one-time' | 'fund-behind' | 'overspent-months' | 'gold-share';
  tone: 'attention' | 'ok' | 'neutral';
  text: string;
  target: InsightTarget;
}

export const MAX_INSIGHTS = 5;
// A category's increase has to be this big (a share of the previous amount, and of the period's
// spending) to be worth a mention.
const INCREASE_MIN_PCT = 0.2;
const INCREASE_MIN_SHARE = 0.05;
const SAVINGS_RATE_GAP = 0.05;
const ONE_TIME_MIN_SHARE = 0.1;
const GOLD_SHARE_MIN = 0.3;

export function insights(state: State, query: AnalyticsQuery, now: Date): Insight[] {
  const result: Insight[] = [];
  const money = (amount: number) => formatMoney(amount, query.currency);
  const breakdown = spendingBreakdown(state, query);
  const totals = periodTotals(state, query);

  // 1. The category that grew the most.
  const grown = breakdown.categories
    .filter((c) => c.previous !== null && c.previous > EPSILON && c.changePct !== null && c.changePct >= INCREASE_MIN_PCT)
    .filter((c) => c.amount - (c.previous ?? 0) >= breakdown.total * INCREASE_MIN_SHARE)
    .sort((a, b) => b.amount - b.previous! - (a.amount - a.previous!))[0];
  if (grown) {
    result.push({
      id: 'category-increase',
      tone: 'attention',
      text: `«${grown.name}» زادت ${formatPercent(grown.changePct!)} عن الفترة اللي فاتت (+${money(grown.amount - grown.previous!)}).`,
      target: { type: 'drill', filter: { type: 'expense', categoryIds: [grown.categoryId] } },
    });
  }

  // 2. Savings rate against your own average since tracking started.
  const history = monthlyTrend(state, { ...query, period: resolvePeriod(state, 'sinceStart', now) });
  if (totals.savingsRate !== null && history.averageSavingsRate !== null && history.monthsWithIncome >= 2) {
    const gap = totals.savingsRate - history.averageSavingsRate;
    if (Math.abs(gap) >= SAVINGS_RATE_GAP) {
      const higher = gap > 0;
      result.push({
        id: 'savings-rate',
        tone: higher ? 'ok' : 'attention',
        text: `معدل تحويشك ${formatPercent(totals.savingsRate)} ${higher ? 'أعلى' : 'أقل'} من متوسطك ${formatPercent(history.averageSavingsRate)}.`,
        target: { type: 'trend' },
      });
    }
  }

  // 3. One-time spending, whatever the toggle says.
  const oneTime = oneTimeSpend(state, query);
  const oneTimeBase = totals.expense + (query.includeOneTime ? 0 : oneTime);
  if (oneTime > EPSILON && oneTimeBase > EPSILON && oneTime / oneTimeBase >= ONE_TIME_MIN_SHARE) {
    result.push({
      id: 'one-time',
      tone: 'neutral',
      text: `صرفت ${money(oneTime)} في مصاريف لمرة واحدة (${formatPercent(oneTime / oneTimeBase)} من مصروف الفترة).`,
      target: { type: 'drill', filter: { type: 'expense', oneTimeOnly: true } },
    });
  }

  // 4. A fund that is behind this month.
  const behind = fundsProjection(state, now).find((f) => f.behind);
  if (behind) {
    result.push({
      id: 'fund-behind',
      tone: 'attention',
      text: `صندوق «${behind.name}» متأخر عن المطلوب الشهر ده.`,
      target: { type: 'fund', fundId: behind.fundId },
    });
  }

  // 5. Months that cost more than they brought in.
  const overspent = monthlyTrend(state, query).months.filter((m) => m.overspent);
  if (overspent.length > 0) {
    const names = overspent.map((m) => formatMonthLabel(m.month)).join('، ');
    result.push({
      id: 'overspent-months',
      tone: 'attention',
      text:
        overspent.length === 1
          ? `صرفت أكتر من دخلك في ${names}.`
          : `صرفت أكتر من دخلك في ${overspent.length} شهور: ${names}.`,
      target: { type: 'trend' },
    });
  }

  // 6. A lot of net worth sitting in gold.
  const map = moneyMap(state, query.currency);
  if (map.goldShare !== null && map.goldShare >= GOLD_SHARE_MIN) {
    result.push({
      id: 'gold-share',
      tone: 'neutral',
      text: `الذهب ${formatPercent(map.goldShare)} من صافي ثروتك.`,
      target: { type: 'assets' },
    });
  }
  return result.slice(0, MAX_INSIGHTS);
}

// --- Readiness ---------------------------------------------------------------------------------------------

// Whether there is any income or spending to analyse since tracking started.
export function hasAnalyticsData(state: Pick<State, 'transactions' | 'settings'>): boolean {
  return state.transactions.some(
    (tx) => (tx.type === 'income' || tx.type === 'expense') && tx.date >= state.settings.trackingStartDate
  );
}
