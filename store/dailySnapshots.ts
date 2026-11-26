import { toDateKey } from '@/utils/dates';
import { roundIn, sumIn } from '@/utils/money';
import { accountBalance, liabilityRemaining } from './selectors';
import type { CurrencyCode, FinanceState, GoldKarat } from './types';

// The DAILY SNAPSHOT history (data v10, docs/architecture/PROFESSIONAL_ANALYTICS_AND_COMPARISON_DESIGN.md §16).
// Pure functions only (no React Native): the storage side is store/useDailySnapshots.ts.
//
// What it is: once per local date, a read-only OBSERVATION of the money positions as the app saw them, in their native
// currencies, plus the prices in force (by reference to the immutable rate snapshot, and the gold prices with their
// source and time). History that is not recorded can never be reconstructed later (reservations are dated by the day
// they were made, prices have no history), so this is recorded from now on, and never backfilled, interpolated or
// carried forward: a day the app was not opened simply has no record.
//
// Rules:
// - Building a record never changes anything (the caller may need to add the rate snapshot it points at, through the
//   finance store, BEFORE writing the record).
// - One record per date. The record of TODAY is updated in place while the date is today (the last observation of the
//   day is the one kept, D2 a); a past date is never touched again. A clock that went back never rewrites a later date.
// - It lives under its own storage key, never inside the ledger value, so a damaged or oversized history can never
//   stop the ledger from loading (it is then simply not recorded, and kept untouched for recovery).
// - Compact on disk: entity ids are interned once in `ids` and records refer to them by index; entries are tuples; and
//   a section identical to the PREVIOUS RECORD's is stored as `0` ("same as the previous record"). That is not carrying
//   anything forward: the record exists for its own date and its values were observed that day; they just equal the
//   last record's. `resolveDailyRecord` resolves it. The first record never uses it.

// --- On-disk format ------------------------------------------------------------------------------------------

export const DAILY_STORE_FORMAT = 1;
export const DAILY_RECORD_VERSION = 1;

// [24k EGP/g, 21k EGP/g, local premium %, 'a' (auto) | 'm' (manual), gold price updated at (ISO), world USD/oz or null]
type GoldTuple = [number, number, number, 'a' | 'm', string, number | null];
type AccountTuple = [id: number, currency: CurrencyCode, balance: number];
type ReservationTuple = [fund: number, account: number, amount: number];
type UnresolvedTuple = [fund: number, currency: CurrencyCode, amount: number];
type GoldHoldingTuple = [id: number, kind: 'g', karat: GoldKarat, grams: number];
type CurrencyHoldingTuple = [id: number, kind: 'c', currency: CurrencyCode, quantity: number];
type LiabilityTuple = [id: number, currency: CurrencyCode, remaining: number];

// A section stored as SAME means "identical to the previous record's (resolved) section".
export const SAME = 0;
type Section<T> = T[] | typeof SAME;

// A record with every section resolved (what building produces, and what readers get after resolving).
export interface FullDailyRecord {
  v: 1;
  d: string;
  t: string;
  r: string;
  fx: string;
  g: GoldTuple;
  a: AccountTuple[];
  rv: ReservationTuple[];
  u: UnresolvedTuple[];
  h: (GoldHoldingTuple | CurrencyHoldingTuple)[];
  l: LiabilityTuple[];
  f: number[];
  n: [count: number, lastUpdatedAt: string];
}

// As stored.
export interface DailyRecord {
  // Record schema version.
  v: 1;
  // Local date key, and the time of the observation kept for it (ISO).
  d: string;
  t: string;
  // The rate snapshot in force (state.rateSnapshots) and how fresh those rates were (settings.rates.updatedAt).
  r: string;
  fx: string;
  g: GoldTuple | typeof SAME;
  // Every account, archived ones included (they still hold money), native balance.
  a: Section<AccountTuple>;
  // Non-zero account-backed reservations, in the account's currency.
  rv: Section<ReservationTuple>;
  // Non-zero legacy reservations that no account backs yet (never assigned to one here).
  u: Section<UnresolvedTuple>;
  h: Section<GoldHoldingTuple | CurrencyHoldingTuple>;
  l: Section<LiabilityTuple>;
  // Achieved funds that day (the fund lifecycle the ledger itself doesn't keep).
  f: Section<number>;
  // The ledger as it was: transaction count and the latest updatedAt, to detect later edits of the past (D3).
  n: [count: number, lastUpdatedAt: string];
}

export interface DailySnapshotStore {
  format: 1;
  // Interned entity ids (accounts, funds, holdings, liabilities); only ever appended.
  ids: string[];
  // Oldest first, strictly increasing dates.
  days: DailyRecord[];
}

export const emptyDailyStore = (): DailySnapshotStore => ({ format: DAILY_STORE_FORMAT, ids: [], days: [] });

// --- Readable shape (what analytics will read) ---------------------------------------------------------------

export interface DailySnapshot {
  schemaVersion: 1;
  date: string;
  takenAt: string;
  rateSnapshotId: string;
  fxUpdatedAt: string;
  gold: {
    price24kEGP: number;
    price21kEGP: number;
    localPremiumPct: number;
    source: 'auto' | 'manual';
    updatedAt: string;
    usdPerOunce: number | null;
  };
  accounts: { id: string; currency: CurrencyCode; balance: number }[];
  reservations: { fundId: string; accountId: string; amount: number }[];
  unresolved: { fundId: string; currency: CurrencyCode; amount: number }[];
  holdings: ({ id: string; type: 'gold'; karat: GoldKarat; grams: number } | { id: string; type: 'currency'; currency: CurrencyCode; quantity: number })[];
  liabilities: { id: string; currency: CurrencyCode; remaining: number }[];
  achievedFundIds: string[];
  ledger: { transactions: number; lastUpdatedAt: string };
}

const SECTIONS = ['g', 'a', 'rv', 'u', 'h', 'l', 'f'] as const;

// The record at `index` with every SAME section replaced by the one it stands for (walking back). Validation
// guarantees this always ends at a real section.
export function resolveDailyRecord(store: Pick<DailySnapshotStore, 'days'>, index: number): FullDailyRecord {
  const out = { ...store.days[index] } as Record<string, unknown>;
  for (const key of SECTIONS) {
    let i = index;
    while (store.days[i][key] === SAME) i -= 1;
    out[key] = store.days[i][key];
  }
  return out as unknown as FullDailyRecord;
}

export function expandDailyRecord(store: DailySnapshotStore, index: number): DailySnapshot {
  const r = resolveDailyRecord(store, index);
  const id = (i: number) => store.ids[i];
  return {
    schemaVersion: r.v,
    date: r.d,
    takenAt: r.t,
    rateSnapshotId: r.r,
    fxUpdatedAt: r.fx,
    gold: {
      price24kEGP: r.g[0],
      price21kEGP: r.g[1],
      localPremiumPct: r.g[2],
      source: r.g[3] === 'a' ? 'auto' : 'manual',
      updatedAt: r.g[4],
      usdPerOunce: r.g[5],
    },
    accounts: r.a.map(([i, currency, balance]) => ({ id: id(i), currency, balance })),
    reservations: r.rv.map(([f, a, amount]) => ({ fundId: id(f), accountId: id(a), amount })),
    unresolved: r.u.map(([f, currency, amount]) => ({ fundId: id(f), currency, amount })),
    holdings: r.h.map((h) =>
      h[1] === 'g' ? { id: id(h[0]), type: 'gold' as const, karat: h[2], grams: h[3] } : { id: id(h[0]), type: 'currency' as const, currency: h[2], quantity: h[3] }
    ),
    liabilities: r.l.map(([i, currency, remaining]) => ({ id: id(i), currency, remaining })),
    achievedFundIds: r.f.map(id),
    ledger: { transactions: r.n[0], lastUpdatedAt: r.n[1] },
  };
}

// The snapshot of one date, or undefined when that date has no record (never a neighbour's).
export function dailySnapshotOn(store: DailySnapshotStore, date: string): DailySnapshot | undefined {
  const index = store.days.findIndex((r) => r.d === date);
  return index >= 0 ? expandDailyRecord(store, index) : undefined;
}

// --- Building a record ---------------------------------------------------------------------------------------

const MONEY_EPSILON = 0.005;
const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// An id interner over a copy of the store's id list (the store itself is never changed).
function interner(ids: readonly string[]) {
  const list = [...ids];
  const index = new Map(list.map((id, i) => [id, i]));
  return {
    list,
    of(id: string): number {
      let i = index.get(id);
      if (i === undefined) {
        i = list.length;
        list.push(id);
        index.set(id, i);
      }
      return i;
    },
  };
}

type RecordState = FinanceState;

// Appends to the list under `key` (created on first use).
function push<K>(map: Map<K, number[]>, key: K, value: number) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

// The record of `now`'s local date, from the state as it is. `rateSnapshotId` must be the snapshot of the CURRENT rates
// (snapshotForNow), already in the state. Deterministic: entities in a fixed order (by id), numbers as the selectors
// give them.
export function buildDailyRecord(
  state: RecordState,
  now: Date,
  rateSnapshotId: string,
  ids: readonly string[] = []
): { record: FullDailyRecord; ids: string[] } {
  const intern = interner(ids);
  const { settings } = state;
  const currencyOf = new Map(state.accounts.map((a) => [a.id, a.currency]));

  const accounts = [...state.accounts].sort((x, y) => byString(x.id, y.id));
  const a: AccountTuple[] = accounts.map((acc) => [intern.of(acc.id), acc.currency, accountBalance(state, acc.id)]);

  // reservation(fund, account) = Σ amounts, rounded in the account's currency (exactly the selector's rule).
  const perPair = new Map<string, number[]>();
  for (const m of state.reservationMovements) {
    if (!currencyOf.has(m.accountId)) continue;
    push(perPair, `${m.fundId}\u0000${m.accountId}`, m.amount);
  }
  const rv: ReservationTuple[] = [...perPair.entries()]
    .sort((x, y) => byString(x[0], y[0]))
    .flatMap(([key, amounts]) => {
      const [fundId, accountId] = key.split('\u0000');
      const currency = currencyOf.get(accountId)!;
      const amount = roundIn(sumIn(amounts, currency), currency);
      return Math.abs(amount) > MONEY_EPSILON ? [[intern.of(fundId), intern.of(accountId), amount] as ReservationTuple] : [];
    });

  const perUnresolved = new Map<string, number[]>();
  for (const m of state.unresolvedMovements) {
    push(perUnresolved, `${m.fundId}\u0000${m.currency}`, m.amount);
  }
  const u: UnresolvedTuple[] = [...perUnresolved.entries()]
    .sort((x, y) => byString(x[0], y[0]))
    .flatMap(([key, amounts]) => {
      const [fundId, currency] = key.split('\u0000');
      const amount = roundIn(sumIn(amounts, currency), currency);
      return Math.abs(amount) > MONEY_EPSILON ? [[intern.of(fundId), currency, amount] as UnresolvedTuple] : [];
    });

  const h: DailyRecord['h'] = [...state.holdings]
    .sort((x, y) => byString(x.id, y.id))
    .map((holding) =>
      holding.type === 'gold'
        ? ([intern.of(holding.id), 'g', holding.karat, holding.weightGrams] as GoldHoldingTuple)
        : ([intern.of(holding.id), 'c', holding.currency, holding.quantity] as CurrencyHoldingTuple)
    );

  const l: LiabilityTuple[] = [...state.liabilities]
    .sort((x, y) => byString(x.id, y.id))
    .map((liability) => [intern.of(liability.id), liability.currency, liabilityRemaining(state, liability)]);

  const f = state.funds
    .filter((fund) => !!fund.achievedAt)
    .map((fund) => fund.id)
    .sort(byString)
    .map((id) => intern.of(id));

  let lastUpdatedAt = '';
  for (const tx of state.transactions) if (tx.updatedAt > lastUpdatedAt) lastUpdatedAt = tx.updatedAt;

  const record: FullDailyRecord = {
    v: DAILY_RECORD_VERSION,
    d: toDateKey(now),
    t: now.toISOString(),
    r: rateSnapshotId,
    fx: settings.rates.updatedAt,
    g: [
      settings.goldPrice24kEGP,
      settings.goldPrice21kEGP,
      settings.localPremiumPct ?? 0,
      settings.priceSource === 'auto' ? 'a' : 'm',
      settings.goldPriceUpdatedAt,
      settings.lastGoldUsdPerOunce ?? null,
    ],
    a,
    rv,
    u,
    h,
    l,
    f,
    n: [state.transactions.length, lastUpdatedAt],
  };
  return { record, ids: intern.list };
}

// --- Upserting -----------------------------------------------------------------------------------------------

// Two records say the same thing (the observation time aside).
const sameContent = (x: FullDailyRecord, y: FullDailyRecord) => JSON.stringify({ ...x, t: '' }) === JSON.stringify({ ...y, t: '' });

// `record` as stored after `previous`: each section equal to the previous record's becomes SAME.
function compact(record: FullDailyRecord, previous: FullDailyRecord | undefined): DailyRecord {
  if (!previous) return record;
  const out = { ...record } as Record<string, unknown>;
  for (const key of SECTIONS) if (JSON.stringify(record[key]) === JSON.stringify(previous[key])) out[key] = SAME;
  return out as unknown as DailyRecord;
}

// The store with today's record set to what the state says now; null when nothing would change (so the caller skips
// the write) or when the clock is behind the last recorded date (a later date is never rewritten). Pure.
export function syncDailyStore(
  store: DailySnapshotStore,
  state: RecordState,
  now: Date,
  rateSnapshotId: string
): DailySnapshotStore | null {
  const { record, ids } = buildDailyRecord(state, now, rateSnapshotId, store.ids);
  const count = store.days.length;
  const last = store.days[count - 1];
  if (last && last.d > record.d) return null;
  if (last && last.d === record.d) {
    if (sameContent(resolveDailyRecord(store, count - 1), record)) return null;
    const before = count >= 2 ? resolveDailyRecord(store, count - 2) : undefined;
    return { format: DAILY_STORE_FORMAT, ids, days: [...store.days.slice(0, -1), compact(record, before)] };
  }
  const previous = last ? resolveDailyRecord(store, count - 1) : undefined;
  return { format: DAILY_STORE_FORMAT, ids, days: [...store.days, compact(record, previous)] };
}

// --- Size ------------------------------------------------------------------------------------------------------

// The history is refused a write beyond this (it stays as it was, the app keeps working). Well under the ~2 MB a single
// Android AsyncStorage value can safely be read back with (SQLite CursorWindow) and the 6 MB default database size.
export const MAX_DAILY_STORE_BYTES = 1_500_000;
// A stored value larger than this is not even parsed on load (treated as oversized, kept untouched).
export const MAX_DAILY_READ_BYTES = 3_000_000;

export const serializeDailyStore = (store: DailySnapshotStore): string => JSON.stringify(store);

// UTF-16 length is what we have cheaply; the stored text is ASCII apart from ids and ISO strings, so it equals bytes.
export const dailyStoreBytes = (text: string): number => text.length;

export type DailyWritePlan =
  | { kind: 'none' }
  | { kind: 'write'; store: DailySnapshotStore; text: string; bytes: number }
  | { kind: 'full'; bytes: number };

// What recording now would do: nothing, a write of the new store (already serialized), or a refusal because the
// history would grow past MAX_DAILY_STORE_BYTES.
export function planDailyWrite(
  store: DailySnapshotStore,
  state: RecordState,
  now: Date,
  rateSnapshotId: string,
  maxBytes: number = MAX_DAILY_STORE_BYTES
): DailyWritePlan {
  const next = syncDailyStore(store, state, now, rateSnapshotId);
  if (!next) return { kind: 'none' };
  const text = serializeDailyStore(next);
  const bytes = dailyStoreBytes(text);
  return bytes > maxBytes ? { kind: 'full', bytes } : { kind: 'write', store: next, text, bytes };
}

// --- Loading and validation (never throws) -----------------------------------------------------------------------

export type DailyStoreProblem = 'unreadable' | 'oversized' | 'invalid';

export type DailyStoreLoad = { ok: true; store: DailySnapshotStore } | { ok: false; problem: DailyStoreProblem; detail: string };

const isRecordObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isDate = (v: unknown): v is string => isStr(v) && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isTuple = (v: unknown, n: number): v is unknown[] => Array.isArray(v) && v.length === n;

// Why the record is not valid, or null.
function recordProblem(r: unknown, idCount: number, first: boolean): string | null {
  if (!isRecordObject(r)) return 'not an object';
  // SAME ("as the previous record") is fine anywhere but in the first record.
  const same = (v: unknown) => !first && v === SAME;
  const idx = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < idCount;
  if (r.v !== 1) return 'record version';
  if (!isDate(r.d) || !isStr(r.t) || !isStr(r.r) || !isStr(r.fx)) return 'header';
  const g = r.g;
  if (same(g)) {
    // as the previous record
  } else if (!isTuple(g, 6) || !isNum(g[0]) || !isNum(g[1]) || !isNum(g[2]) || (g[3] !== 'a' && g[3] !== 'm') || !isStr(g[4]) || !(g[5] === null || isNum(g[5]))) {
    return 'gold';
  }
  const list = (v: unknown, ok: (e: unknown) => boolean) => same(v) || (Array.isArray(v) && v.every(ok));
  if (!list(r.a, (e) => isTuple(e, 3) && idx(e[0]) && isStr(e[1]) && isNum(e[2]))) return 'accounts';
  if (!list(r.rv, (e) => isTuple(e, 3) && idx(e[0]) && idx(e[1]) && isNum(e[2]))) return 'reservations';
  if (!list(r.u, (e) => isTuple(e, 3) && idx(e[0]) && isStr(e[1]) && isNum(e[2]))) return 'unresolved';
  if (
    !list(
      r.h,
      (e) =>
        isTuple(e, 4) &&
        idx(e[0]) &&
        ((e[1] === 'g' && (e[2] === 18 || e[2] === 21 || e[2] === 24) && isNum(e[3])) || (e[1] === 'c' && isStr(e[2]) && isNum(e[3])))
    )
  ) {
    return 'holdings';
  }
  if (!list(r.l, (e) => isTuple(e, 3) && idx(e[0]) && isStr(e[1]) && isNum(e[2]))) return 'liabilities';
  if (!list(r.f, idx)) return 'achieved funds';
  if (!isTuple(r.n, 2) || !Number.isInteger(r.n[0]) || !isStr(r.n[1])) return 'ledger';
  return null;
}

// Validates a parsed value as a history store.
export function validateDailyStore(value: unknown): DailyStoreLoad {
  if (!isRecordObject(value)) return { ok: false, problem: 'invalid', detail: 'not an object' };
  if (value.format !== DAILY_STORE_FORMAT) return { ok: false, problem: 'invalid', detail: `unknown format ${String(value.format)}` };
  const { ids, days } = value;
  if (!Array.isArray(ids) || !ids.every(isStr) || new Set(ids).size !== ids.length) return { ok: false, problem: 'invalid', detail: 'ids' };
  if (!Array.isArray(days)) return { ok: false, problem: 'invalid', detail: 'days' };
  for (let i = 0; i < days.length; i++) {
    const problem = recordProblem(days[i], ids.length, i === 0);
    if (problem) return { ok: false, problem: 'invalid', detail: `day ${i}: ${problem}` };
    if (i > 0 && !((days[i] as DailyRecord).d > (days[i - 1] as DailyRecord).d)) {
      return { ok: false, problem: 'invalid', detail: `day ${i}: dates not increasing` };
    }
  }
  return { ok: true, store: value as unknown as DailySnapshotStore };
}

// The history from its stored text: nothing stored → an empty history; too large → not parsed; anything that isn't a
// valid history → refused with the reason. Never throws, so it can never stop anything else from loading.
export function parseDailyStore(raw: string | null, maxReadBytes: number = MAX_DAILY_READ_BYTES): DailyStoreLoad {
  if (raw === null || raw === '') return { ok: true, store: emptyDailyStore() };
  if (dailyStoreBytes(raw) > maxReadBytes) return { ok: false, problem: 'oversized', detail: `${dailyStoreBytes(raw)} bytes` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, problem: 'invalid', detail: 'not JSON' };
  }
  return validateDailyStore(parsed);
}

// --- Summary (Settings, restore preview) --------------------------------------------------------------------------

export interface DailyStoreSummary {
  days: number;
  firstDate: string | null;
  lastDate: string | null;
}

export const summarizeDailyStore = (store: DailySnapshotStore): DailyStoreSummary => ({
  days: store.days.length,
  firstDate: store.days[0]?.d ?? null,
  lastDate: store.days[store.days.length - 1]?.d ?? null,
});
