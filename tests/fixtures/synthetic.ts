// Synthetic fixtures for the analytics tests (made-up numbers only; never real data).
import { emptyDailyStore, syncDailyStore, type DailySnapshotStore } from '@/store/dailySnapshots';
import { CATEGORY_IDS, DEFAULT_CATEGORIES } from '@/store/defaultCategories';
import { LATEST_V8_STEP } from '@/store/migrateV8';
import { LATEST_V9_STEP } from '@/store/migrateV9';
import { LATEST_V10_STEP } from '@/store/migrateV10';
import { snapshotForNow } from '@/store/rateSnapshots';
import type { Account, FinanceState, IncomeExpenseTransaction, ReservationMovement, Transaction } from '@/store/types';
import { makeSnapshot } from '@/utils/rates';

export const T0 = '2026-08-01T08:00:00.000Z';
export const PER_USD = { USD: 1, EGP: 50, SAR: 4 }; // 1 SAR = 12.5 EGP
export const RATES = makeSnapshot({ base: 'USD', perUsd: PER_USD }, { takenAt: T0, source: 'manual' });

export function baseState(overrides: Partial<FinanceState['settings']> = {}): FinanceState {
  return {
    rateSnapshots: [RATES],
    accounts: [],
    categories: DEFAULT_CATEGORIES,
    transactions: [],
    funds: [],
    reservationMovements: [],
    unresolvedMovements: [],
    holdings: [],
    liabilities: [],
    recurringRules: [],
    monthlyPlans: [],
    netWorthSnapshots: [],
    actionDismissals: [],
    monthlyReviews: [],
    receivables: [],
    settings: {
      rates: { base: 'USD', perUsd: PER_USD, updatedAt: T0, source: 'manual' },
      enabledCurrencies: ['EGP', 'SAR', 'USD'],
      v8Step: LATEST_V8_STEP,
      v9Step: LATEST_V9_STEP,
      v10Step: LATEST_V10_STEP,
      reportingCurrency: 'EGP',
      planCurrency: 'EGP',
      goldPrice24kEGP: 6000,
      goldPrice21kEGP: 5250,
      goldPriceUpdatedAt: T0,
      trackingStartDate: '2026-08-01',
      deviceId: 'test-device',
      ...overrides,
    },
    tombstones: [],
  };
}

export const account = (id: string, currency: string, openingBalance: number, extra: Partial<Account> = {}): Account => ({
  id,
  name: id,
  type: 'bank',
  currency,
  openingBalance,
  country: currency === 'SAR' ? 'SA' : 'EG',
  createdAt: T0,
  updatedAt: T0,
  ...extra,
});

export const tx = (id: string, type: 'income' | 'expense', amount: number, date: string, extra: Partial<IncomeExpenseTransaction> = {}): IncomeExpenseTransaction => ({
  id,
  type,
  amount,
  currency: 'EGP',
  accountId: 'a-egp',
  categoryId: type === 'income' ? CATEGORY_IDS.salary : 'cat-essentials-groceries',
  date,
  rateSnapshotId: RATES.id,
  createdAt: T0,
  updatedAt: T0,
  ...extra,
});
export const income = (id: string, date: string, amount = 20_000, extra: Partial<IncomeExpenseTransaction> = {}) => tx(id, 'income', amount, date, extra);
export const expense = (id: string, amount: number, date: string, extra: Partial<IncomeExpenseTransaction> = {}) => tx(id, 'expense', amount, date, extra);

export const movement = (id: string, kind: ReservationMovement['kind'], amount: number, date: string, extra: Partial<ReservationMovement> = {}): ReservationMovement => ({
  id,
  fundId: 'f-home',
  accountId: 'a-egp',
  amount,
  kind,
  date,
  rateSnapshotId: RATES.id,
  updatedAt: T0,
  ...extra,
});

// Salary 20,000 a month; October spending 3,000 (10th) + 1,000 (28th); November: 3,300, a 2,000 purchase paid 1,500
// «من صندوق», a one-time 700, a transfer (fee 10), an exchange (fee 5), gold 4,000, a reservation of 3,000, a release
// of 200. A gold holding of 0.5 g 24k.
export function flowWorld(settings: Partial<FinanceState['settings']> = {}): FinanceState {
  const s = baseState(settings);
  const transfer: Transaction = { id: 't-move', type: 'transfer', fromAccountId: 'a-egp', toAccountId: 'a-egp2', amount: 5_000, fees: [{ accountId: 'a-egp', amount: 10 }], date: '2026-11-10', rateSnapshotId: RATES.id, createdAt: T0, updatedAt: T0 };
  const exchange: Transaction = { id: 't-fx', type: 'exchange', fromAccountId: 'a-egp', toAccountId: 'a-sar', sentAmount: 1_250, receivedAmount: 100, fees: [{ accountId: 'a-egp', amount: 5 }], date: '2026-11-12', rateSnapshotId: RATES.id, createdAt: T0, updatedAt: T0 };
  const gold: Transaction = { id: 't-gold', type: 'asset_purchase', amount: 4_000, accountId: 'a-egp', currency: 'EGP', holdingId: 'h-gold', date: '2026-11-15', rateSnapshotId: RATES.id, createdAt: T0, updatedAt: T0 };
  return {
    ...s,
    accounts: [account('a-egp', 'EGP', 10_000, { openingDate: '2026-08-01' }), account('a-egp2', 'EGP', 0), account('a-sar', 'SAR', 1_000)],
    funds: [{ id: 'f-home', name: 'البيت', type: 'goal', targetAmount: 10_000, currency: 'EGP', priority: 1, linkedHoldingIds: [], createdAt: T0, updatedAt: T0 }],
    holdings: [{ id: 'h-gold', type: 'gold', name: 'سبيكة', weightGrams: 0.5, karat: 24, purchaseCost: { amount: 4_000, currency: 'EGP' }, purchaseRateSnapshotId: RATES.id, purchaseDate: '2026-11-15', country: 'EG', updatedAt: T0 }],
    transactions: [
      income('s-oct', '2026-10-01'),
      expense('e-oct1', 3_000, '2026-10-10'),
      expense('e-oct2', 1_000, '2026-10-28', { categoryId: 'cat-lifestyle-dining' }),
      income('s-nov', '2026-11-01'),
      expense('e-nov1', 3_300, '2026-11-05'),
      expense('e-home', 2_000, '2026-11-20', { categoryId: 'cat-essentials-home-setup' }),
      expense('e-once', 700, '2026-11-22', { categoryId: 'cat-lifestyle-gadgets', oneTime: true }),
      transfer,
      exchange,
      gold,
    ],
    reservationMovements: [
      movement('m-res', 'reserve', 3_000, '2026-11-02'),
      movement('m-spend', 'spend', -1_500, '2026-11-20', { sourceTransactionId: 'e-home' }),
      movement('m-rel', 'release', -200, '2026-11-21'),
    ],
  };
}

// The daily history as the app would have recorded it on `date` (the ledger then had only what was dated up to it).
export function recordOn(state: FinanceState, date: string, store: DailySnapshotStore = emptyDailyStore()): DailySnapshotStore {
  const now = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), 21);
  const then = { ...state, transactions: state.transactions.filter((t) => t.date <= date) };
  return syncDailyStore(store, then, now, snapshotForNow(then, now).id)!;
}

// Every number either finite or null (no NaN / Infinity anywhere in a result).
export function findNonFinite(value: unknown, path = 'value'): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? null : `${path} = ${value}`;
  if (value && typeof value === 'object' && !(value instanceof Map)) {
    for (const [k, v] of Object.entries(value)) {
      const found = findNonFinite(v, `${path}.${k}`);
      if (found) return found;
    }
  }
  return null;
}

// flowWorld plus months of history and many categories (so the footprint has a «باقي الفئات»), and a late salary
// (so the pay cycle is long and starts mid-month).
export function richWorld(trackingStartDate = '2026-03-01') {
  const s = flowWorld({ trackingStartDate });
  const more = [
    income('s-jun', '2026-06-03'),
    expense('e-jun', 4_100, '2026-06-12'),
    income('s-jul', '2026-07-02'),
    expense('e-jul', 21_500.25, '2026-07-20', { categoryId: 'cat-essentials-rent' }),
    income('s-aug', '2026-08-01'),
    expense('e-aug', 3_333.33, '2026-08-19', { categoryId: 'cat-lifestyle-dining' }),
    income('s-sep', '2026-09-28'),
    expense('e-sep', 999.99, '2026-09-29', { categoryId: 'cat-giving-sadaqah' }),
    expense('n1', 450.5, '2026-11-03', { categoryId: 'cat-essentials-transport' }),
    expense('n2', 120.75, '2026-11-08', { categoryId: 'cat-lifestyle-entertainment' }),
    expense('n3', 88.8, '2026-11-09', { categoryId: 'cat-giving-gifts' }),
    expense('n4', 333.33, '2026-11-16', { categoryId: 'cat-essentials-health' }),
    expense('n5', 15.01, '2026-11-25', { categoryId: 'cat-lifestyle-misc', currency: 'SAR', accountId: 'a-sar' }),
  ];
  return { ...s, transactions: [...s.transactions, ...more] };
}

