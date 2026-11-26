import { convert, snapshotById, type RateTable } from '@/utils/rates';
import { decimalsFor, fromMinor, roundIn, sumIn, toMinor } from '@/utils/money';
import { shiftDate, toDateKey } from '@/utils/dates';
import { compareValues, unavailable, weakerQuality, type Change, type ChangeSpec, type MetricValue, type Quality } from './comparison';
import { buildDailyRecord, dailySnapshotOn, type DailySnapshot, type DailySnapshotStore } from './dailySnapshots';
import { createMemoCache, memoOn } from './memo';
import { accountBalance, liabilityRemaining, transactionAccountEffects } from './selectors';
import type { CurrencyCode, FinanceState, GoldKarat } from './types';

// Point-in-time positions and date-vs-date comparison (Mode B, Phase 1b, design §8–9). Pure and read-only.
//
// Where a position at date D comes from:
//   'live'   D is today: the current state (recorded).
//   'daily'  a daily snapshot of D (data v10): recorded. Per D3, account balances come from the CURRENT ledger as of
//            D (so they reconcile with flows) and the record says `ledgerDiverged` when the snapshot saw different
//            balances (a past edit, a backdated row); reservations, holdings, liabilities and prices come from the
//            snapshot.
//   'ledger' no snapshot: account balances, holdings (by purchase date) and liabilities reconstructed from the ledger
//            (labelled, never presented as recorded); reservations and free money are UNAVAILABLE (they can't be
//            rebuilt reliably: reservation movements are dated by the day they were made).
// Before tracking started, or after today: unavailable.

type State = FinanceState;

export type PositionSource = 'live' | 'daily' | 'ledger' | 'none';

export interface PriceSet {
  rates: RateTable;
  gold24kEGP: number;
  gold21kEGP: number;
  // Where the prices come from and which date they belong to.
  source: 'live' | 'daily';
  date: string;
}

export interface PositionAt {
  date: string;
  source: PositionSource;
  // The native position (the daily snapshot's readable shape); null when none.
  position: DailySnapshot | null;
  // The prices of that date, when recorded (live or daily); null for a ledger reconstruction (no price history) or
  // when the record's rate snapshot is missing.
  prices: PriceSet | null;
  reason?: 'before_tracking' | 'future';
  // D3: the snapshot saw other account balances than the ledger says today for that date.
  ledgerDiverged: boolean;
}

const livePrices = (state: Pick<State, 'settings'>, date: string): PriceSet => ({
  rates: state.settings.rates,
  gold24kEGP: state.settings.goldPrice24kEGP,
  gold21kEGP: state.settings.goldPrice21kEGP,
  source: 'live',
  date,
});

// The current state as a position (the same shape as a daily snapshot).
function livePosition(state: State, now: Date): DailySnapshot {
  const { record, ids } = buildDailyRecord(state, now, '');
  return dailySnapshotOn({ format: 1, ids, days: [record] }, record.d)!;
}

// The ledger as of the end of `date`: transactions dated after it left out (accountBalance on the filtered list).
const asOfCache = createMemoCache<State>();
function ledgerAsOf(state: State, date: string): State {
  return memoOn(asOfCache, [state.transactions], date, () => ({ ...state, transactions: state.transactions.filter((tx) => tx.date <= date) }));
}

function ledgerPosition(state: State, date: string): DailySnapshot {
  const past = ledgerAsOf(state, date);
  const onOrBefore = (d: string | undefined) => !d || d.slice(0, 10) <= date;
  return {
    schemaVersion: 1,
    date,
    takenAt: '',
    rateSnapshotId: '',
    fxUpdatedAt: '',
    gold: { price24kEGP: 0, price21kEGP: 0, localPremiumPct: 0, source: 'manual', updatedAt: '', usdPerOunce: null },
    accounts: state.accounts.filter((a) => onOrBefore(a.openingDate)).map((a) => ({ id: a.id, currency: a.currency, balance: accountBalance(past, a.id) })),
    reservations: [],
    unresolved: [],
    holdings: state.holdings
      .filter((h) => onOrBefore(h.purchaseDate))
      .map((h) => (h.type === 'gold' ? { id: h.id, type: 'gold' as const, karat: h.karat, grams: h.weightGrams } : { id: h.id, type: 'currency' as const, currency: h.currency, quantity: h.quantity })),
    liabilities: state.liabilities.filter((l) => onOrBefore(l.startDate)).map((l) => ({ id: l.id, currency: l.currency, remaining: liabilityRemaining(past, l) })),
    achievedFundIds: [],
    ledger: { transactions: past.transactions.length, lastUpdatedAt: '' },
  };
}

export function positionAt(state: State, store: DailySnapshotStore | null, date: string, now: Date): PositionAt {
  const today = toDateKey(now);
  const none = (reason: PositionAt['reason']): PositionAt => ({ date, source: 'none', position: null, prices: null, reason, ledgerDiverged: false });
  if (date > today) return none('future');
  if (date === today) return { date, source: 'live', position: livePosition(state, now), prices: livePrices(state, date), ledgerDiverged: false };
  if (date < state.settings.trackingStartDate) return none('before_tracking');
  const recorded = store ? dailySnapshotOn(store, date) : undefined;
  if (recorded) {
    const past = ledgerAsOf(state, date);
    return fromRecord(state, recorded, (id) => accountBalance(past, id));
  }
  return { date, source: 'ledger', position: ledgerPosition(state, date), prices: null, ledgerDiverged: false };
}

// D3: a recorded day with its account balances taken from the current ledger as of that date (`balanceOf`), for the
// accounts that still exist (a deleted account keeps the snapshot's value); `ledgerDiverged` when they differ.
function fromRecord(state: State, recorded: DailySnapshot, balanceOf: (accountId: string) => number): PositionAt {
  const existing = new Set(state.accounts.map((a) => a.id));
  let diverged = false;
  const accounts = recorded.accounts.map((a) => {
    if (!existing.has(a.id)) return a;
    const balance = balanceOf(a.id);
    if (Math.abs(balance - a.balance) >= 0.005) diverged = true;
    return { ...a, balance };
  });
  const rates = snapshotById(state.rateSnapshots, recorded.rateSnapshotId);
  return {
    date: recorded.date,
    source: 'daily',
    position: { ...recorded, accounts },
    prices: rates ? { rates, gold24kEGP: recorded.gold.price24kEGP, gold21kEGP: recorded.gold.price21kEGP, source: 'daily', date: recorded.date } : null,
    ledgerDiverged: diverged,
  };
}

// --- Valuation ---------------------------------------------------------------------------------------------------

export type PointMetricId = 'netWorth' | 'totalAssets' | 'liquid' | 'reserved' | 'freeMoney' | 'nonLiquid' | 'goldValue' | 'currencyHoldings' | 'liabilities';

export const POINT_METRICS: Record<PointMetricId, Omit<ChangeSpec, 'currency'>> = {
  netWorth: { kind: 'amount', goodWhen: 'up' },
  totalAssets: { kind: 'amount', goodWhen: 'up' },
  liquid: { kind: 'amount', goodWhen: 'up' },
  reserved: { kind: 'amount', goodWhen: 'none' },
  freeMoney: { kind: 'amount', goodWhen: 'up' },
  // Holdings (gold + currency holdings): not liquid money.
  nonLiquid: { kind: 'amount', goodWhen: 'none' },
  goldValue: { kind: 'amount', goodWhen: 'none' },
  currencyHoldings: { kind: 'amount', goodWhen: 'none' },
  liabilities: { kind: 'amount', goodWhen: 'down' },
};

const goldPerGram = (prices: PriceSet, karat: GoldKarat) =>
  karat === 24 ? prices.gold24kEGP : karat === 21 ? prices.gold21kEGP : prices.gold24kEGP * 0.75;

export type PositionValues = Record<PointMetricId, number>;

// A native position valued in `to` at `prices`, every item rounded to `to` before it is summed (INV-7), exactly as the
// live selectors value the current state (accountValue, holdingValue, liabilityValue, the runway's free money).
// Throws RateMissingError when a currency has no rate in `prices.rates` (callers treat that as unavailable).
export function valuePosition(position: DailySnapshot, prices: PriceSet, to: CurrencyCode): PositionValues {
  const value = (amount: number, from: CurrencyCode) => roundIn(convert(amount, from, to, prices.rates), to);
  const liquid = sumIn(position.accounts.map((a) => value(a.balance, a.currency)), to);
  const gold = sumIn(position.holdings.flatMap((h) => (h.type === 'gold' ? [value(h.grams * goldPerGram(prices, h.karat), 'EGP')] : [])), to);
  const currencies = sumIn(position.holdings.flatMap((h) => (h.type === 'currency' ? [value(h.quantity, h.currency)] : [])), to);
  const liabilities = sumIn(position.liabilities.map((l) => value(l.remaining, l.currency)), to);
  const currencyOf = new Map(position.accounts.map((a) => [a.id, a.currency]));

  // Per currency, native: liquid − account-backed reservations − unresolved = free money.
  const pool = new Map<CurrencyCode, number[]>();
  const add = (currency: CurrencyCode, amount: number) => pool.set(currency, [...(pool.get(currency) ?? []), amount]);
  for (const a of position.accounts) add(a.currency, a.balance);
  const reservedItems: number[] = [];
  for (const r of position.reservations) {
    const currency = currencyOf.get(r.accountId);
    if (!currency) continue;
    add(currency, -r.amount);
    reservedItems.push(value(r.amount, currency));
  }
  for (const u of position.unresolved) {
    add(u.currency, -u.amount);
    reservedItems.push(value(u.amount, u.currency));
  }
  const freeMoney = sumIn([...pool.entries()].map(([currency, amounts]) => value(roundIn(sumIn(amounts, currency), currency), currency)), to);
  const totalAssets = sumIn([liquid, gold, currencies], to);
  return {
    netWorth: sumIn([totalAssets, -liabilities], to),
    totalAssets,
    liquid,
    reserved: sumIn(reservedItems, to),
    freeMoney,
    nonLiquid: sumIn([gold, currencies], to),
    goldValue: gold,
    currencyHoldings: currencies,
    liabilities,
  };
}

// --- Date vs date ----------------------------------------------------------------------------------------------------

// 'historical': each date at its own recorded prices ("بأسعار كل يوم"); 'constant': both at the LATER date's prices
// ("بأسعار ثابتة"), which isolates real changes from exchange-rate and gold-price moves.
export type ValuationMethod = 'historical' | 'constant';

export interface DateSide {
  at: PositionAt;
  metrics: Record<PointMetricId, MetricValue>;
}

export interface DateComparison {
  currency: CurrencyCode;
  method: ValuationMethod;
  // The prices both sides were valued at with 'constant' (the later date's); null for 'historical' or when the later
  // date has no recorded prices.
  constantPrices: PriceSet | null;
  a: DateSide;
  b: DateSide;
  // From A to B.
  metrics: Record<PointMetricId, Change>;
}

const ALL_POINT = Object.keys(POINT_METRICS) as PointMetricId[];
// Recorded positions give every metric; a ledger reconstruction gives no reservations, so no reserved / free money.
const LEDGER_UNAVAILABLE: PointMetricId[] = ['reserved', 'freeMoney'];

// `prices`: what values this side — its own recorded prices ('historical') or the later date's ('constant'); null
// when those don't exist. Never mixes: a ledger reconstruction under 'historical' is valued at today's prices and
// labelled estimated; under 'constant' it uses the constant prices and is reconstructed; without usable prices the
// side is unavailable.
function sideMetrics(at: PositionAt, method: ValuationMethod, prices: PriceSet | null, today: PriceSet, to: CurrencyCode): Record<PointMetricId, MetricValue> {
  const all = (v: MetricValue) => Object.fromEntries(ALL_POINT.map((id) => [id, v])) as Record<PointMetricId, MetricValue>;
  if (!at.position) return all(unavailable(at.reason === 'future' ? 'future' : at.reason === 'before_tracking' ? 'before_tracking' : 'not_recorded'));

  let used: PriceSet;
  let quality: Quality;
  if (method === 'constant') {
    if (!prices) return all(unavailable('rates_missing'));
    used = prices;
    quality = at.source === 'ledger' ? 'reconstructed' : 'recorded';
  } else if (at.source === 'ledger') {
    used = today;
    quality = 'estimated';
  } else {
    if (!prices) return all(unavailable('rates_missing'));
    used = prices;
    quality = 'recorded';
  }
  let values: PositionValues;
  try {
    values = valuePosition(at.position, used, to);
  } catch {
    return all(unavailable('rates_missing'));
  }
  return Object.fromEntries(
    ALL_POINT.map((id) => {
      if (at.source === 'ledger' && LEDGER_UNAVAILABLE.includes(id)) return [id, unavailable('not_recorded')];
      // Holdings rebuilt from purchase dates are never better than estimated (holding edits are undated).
      const holdingsBased = id === 'goldValue' || id === 'currencyHoldings' || id === 'nonLiquid' || id === 'totalAssets' || id === 'netWorth';
      const q = at.source === 'ledger' && holdingsBased ? weakerQuality(quality, 'estimated') : quality;
      return [id, { value: values[id], quality: q }];
    })
  ) as Record<PointMetricId, MetricValue>;
}

export interface CompareDatesInput {
  dateA: string;
  dateB: string;
  currency: CurrencyCode;
  method: ValuationMethod;
  now: Date;
}

export function compareDates(state: State, store: DailySnapshotStore | null, input: CompareDatesInput): DateComparison {
  const a = positionAt(state, store, input.dateA, input.now);
  const b = positionAt(state, store, input.dateB, input.now);
  const today = toDateKey(input.now);
  const later = input.dateA > input.dateB ? a : b;
  const live = livePrices(state, today);
  const constantPrices = input.method === 'constant' ? later.prices : null;
  const pricesFor = (side: PositionAt): PriceSet | null => (input.method === 'constant' ? constantPrices : side.prices);
  const sideA: DateSide = { at: a, metrics: sideMetrics(a, input.method, pricesFor(a), live, input.currency) };
  const sideB: DateSide = { at: b, metrics: sideMetrics(b, input.method, pricesFor(b), live, input.currency) };
  const metrics = Object.fromEntries(
    ALL_POINT.map((id) => [id, compareValues(sideA.metrics[id], sideB.metrics[id], { ...POINT_METRICS[id], currency: input.currency })])
  ) as Record<PointMetricId, Change>;
  return { currency: input.currency, method: input.method, constantPrices, a: sideA, b: sideB, metrics };
}

// --- One date's values (historical prices) ----------------------------------------------------------------------------

// The point metrics of one date at its own prices (what a card shows for "now" or a period's end).
export function pointValues(state: State, store: DailySnapshotStore | null, date: string, currency: CurrencyCode, now: Date): DateSide {
  const at = positionAt(state, store, date, now);
  return { at, metrics: sideMetrics(at, 'historical', at.prices, livePrices(state, toDateKey(now)), currency) };
}

// --- Daily net worth series (the hero chart) ----------------------------------------------------------------------

export interface SeriesPoint {
  date: string;
  // Net worth that day at that day's recorded prices; null = no record that day (a GAP, never a zero or a guess).
  value: number | null;
  source: 'daily' | 'live' | 'none';
  // Every point metric that day (null in gaps, and for metrics a day can't give).
  metrics: Record<PointMetricId, number | null> | null;
  // D3: the snapshot saw other balances than the ledger now says for that date.
  ledgerDiverged: boolean;
}

const seriesCache = createMemoCache<SeriesPoint[]>();

// One point per calendar day of [from, to] (to capped at today): recorded days (daily snapshots) and today (live) have
// a value; every other day is null. Balances follow D3 (the current ledger as of each day), computed in ONE pass over
// the date-sorted ledger with the same per-transaction effects as accountBalance. Memoized.
export function netWorthDailySeries(
  state: State,
  store: DailySnapshotStore | null,
  range: { from: string; to: string },
  currency: CurrencyCode,
  now: Date
): SeriesPoint[] {
  const today = toDateKey(now);
  const to = range.to > today ? today : range.to;
  const from = range.from < state.settings.trackingStartDate ? state.settings.trackingStartDate : range.from;
  const key = JSON.stringify([from, to, currency, today]);
  const refs = [state.transactions, state.accounts, state.holdings, state.liabilities, state.reservationMovements, state.unresolvedMovements, state.rateSnapshots, state.settings, state.funds, store ?? EMPTY_REF];
  return memoOn(seriesCache, refs, key, () => {
    if (to < from) return [];
    const recordedDates = new Set((store?.days ?? []).map((d) => d.d).filter((d) => d >= from && d <= to && d !== today));
    const sorted = sortedByDate(state);
    const minor = new Map<string, number>();
    const currencyOf = new Map(state.accounts.map((a) => [a.id, a.currency]));
    let next = 0;
    const live = toDateKey(now) <= to ? pointValues(state, store, today, currency, now) : null;
    const out: SeriesPoint[] = [];
    for (let d = from; d <= to; d = shiftDate(d, 1)) {
      if (d === today && live) {
        const v = live.metrics.netWorth;
        out.push({ date: d, value: v.value, source: 'live', ledgerDiverged: false, metrics: metricValues(live.metrics) });
        continue;
      }
      if (!recordedDates.has(d)) {
        out.push({ date: d, value: null, source: 'none', ledgerDiverged: false, metrics: null });
        continue;
      }
      // Apply every transaction dated on or before d (once each, in date order).
      while (next < sorted.length && sorted[next].date <= d) {
        for (const e of transactionAccountEffects(sorted[next])) {
          const c = currencyOf.get(e.accountId);
          if (c) minor.set(e.accountId, (minor.get(e.accountId) ?? 0) + toMinor(e.amount, decimalsFor(c)));
        }
        next += 1;
      }
      const balanceOf = (id: string) => {
        const account = state.accounts.find((a) => a.id === id)!;
        return roundIn(account.openingBalance + fromMinor(minor.get(id) ?? 0, decimalsFor(account.currency)), account.currency);
      };
      const at = fromRecord(state, dailySnapshotOn(store!, d)!, balanceOf);
      const all = sideMetrics(at, 'historical', at.prices, livePrices(state, today), currency);
      const v = all.netWorth;
      out.push({ date: d, value: v.value, source: v.value === null ? 'none' : 'daily', ledgerDiverged: at.ledgerDiverged, metrics: v.value === null ? null : metricValues(all) });
    }
    return out;
  });
}

const EMPTY_REF = {};
const metricValues = (m: Record<PointMetricId, MetricValue>) =>
  Object.fromEntries(Object.entries(m).map(([id, v]) => [id, v.value])) as Record<PointMetricId, number | null>;
const sortedCache = createMemoCache<FinanceState['transactions']>();
const sortedByDate = (state: State) =>
  memoOn(sortedCache, [state.transactions], '', () => [...state.transactions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)));
