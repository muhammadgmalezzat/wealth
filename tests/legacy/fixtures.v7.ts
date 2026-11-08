// Data-v7 fixtures for the Phase B test oracle. Typed with the FROZEN v7 types, so they stay valid
// whatever the live model becomes. Hand-built to cover every v7 quirk the v8 migration must preserve:
// records with and without ratesSnapshot, a custom rateToEGP, cross-currency and same-currency
// transfers, gold bought through a transaction, currency-less fund movements, a SAR fund funded with
// EGP, holdings without a location, an archived account, estimated net-worth snapshots.
import { DEFAULT_CATEGORIES } from '@/store/defaultCategories';
import { SEED_V3 as EXAMPLE_SEED_V3 } from '@/store/seed.example';
import { migrateToV7 } from '@/store/migrations';
import type { FinanceState as FinanceStateV7, RatesSnapshot, Transaction } from '@/store/legacy/types.v7';

export const ORACLE_NOW = new Date(2026, 9, 15, 12); // 15 Oct 2026, local time
const T0 = '2026-01-01T00:00:00.000Z';
const CREATED = '2026-08-01T00:00:00.000Z';

export const RATES_NOW = { SAR_EGP: 12.5, USD_EGP: 50, lastUpdated: '2026-10-01T00:00:00.000Z' };
const S_OLD: RatesSnapshot = { SAR_EGP: 12, USD_EGP: 48 };
const S_NOW: RatesSnapshot = { SAR_EGP: 12.5, USD_EGP: 50 };

const base = (id: string, date: string, rate: number, snapshot?: RatesSnapshot) => ({
  id,
  date,
  rateToEGP: rate,
  ...(snapshot ? { ratesSnapshot: snapshot } : {}),
  createdAt: `${date}T10:00:00.000Z`,
  updatedAt: T0,
});

const TRANSACTIONS: Transaction[] = [
  { ...base('t-sal-sep', '2026-09-01', 12, S_OLD), type: 'income', amount: 3000, currency: 'SAR', accountId: 'a-sar-sa', categoryId: 'cat-income-salary', note: 'راتب' },
  { ...base('t-rent-sep', '2026-09-05', 12, S_OLD), type: 'expense', amount: 700, currency: 'SAR', accountId: 'a-sar-sa', categoryId: 'cat-essentials-rent' },
  { ...base('t-groc-oct', '2026-10-03', 12.5, S_NOW), type: 'expense', amount: 200, currency: 'SAR', accountId: 'a-sar-sa', categoryId: 'cat-essentials-groceries' },
  { ...base('t-trans-oct', '2026-10-04', 1, S_NOW), type: 'expense', amount: 1500, currency: 'EGP', accountId: 'a-egp', categoryId: 'cat-essentials-transport' },
  { ...base('t-sub-oct', '2026-10-05', 50, S_NOW), type: 'expense', amount: 30, currency: 'USD', accountId: 'a-usd', categoryId: 'cat-lifestyle-entertainment' },
  { ...base('t-inc-egp', '2026-10-01', 1), type: 'income', amount: 10000, currency: 'EGP', accountId: 'a-egp', categoryId: 'cat-income-freelance' },
  // No snapshot at all (v7 data from before snapshots existed), the seed's SAR rate.
  { ...base('t-old-sar', '2026-08-20', 12.57), type: 'expense', amount: 120, currency: 'SAR', accountId: 'a-sar-eg', categoryId: 'cat-essentials-telecom' },
  // A typed rate that differs from the snapshot's.
  { ...base('t-custom', '2026-10-06', 12.2, S_NOW), type: 'expense', amount: 90, currency: 'SAR', accountId: 'a-sar-eg', categoryId: 'cat-lifestyle-dining' },
  { ...base('t-onetime', '2026-10-02', 1, S_NOW), type: 'expense', amount: 4000, currency: 'EGP', accountId: 'a-egp', categoryId: 'cat-essentials-home-setup', oneTime: true },
  // Before tracking started: balances count it, cash-flow reports do not.
  { ...base('t-july', '2026-07-15', 12, S_OLD), type: 'expense', amount: 50, currency: 'SAR', accountId: 'a-sar-eg', categoryId: 'cat-essentials-bills' },
  {
    ...base('t-fx', '2026-10-07', 12.5, S_NOW),
    type: 'transfer',
    fromAccountId: 'a-sar-eg',
    toAccountId: 'a-egp',
    amount: 1000,
    toAmount: 12400,
    note: 'صرف ريال',
  },
  { ...base('t-same', '2026-10-09', 12.5, S_NOW), type: 'transfer', fromAccountId: 'a-sar-sa', toAccountId: 'a-sar-eg', amount: 500, toAmount: 500 },
  { ...base('t-gold', '2026-10-08', 1, S_NOW), type: 'asset_purchase', amount: 31000, currency: 'EGP', accountId: 'a-egp', holdingId: 'h-gold-1' },
  { ...base('t-loan', '2026-10-10', 50, S_NOW), type: 'expense', amount: 100, currency: 'USD', accountId: 'a-usd', categoryId: 'cat-essentials-bills', liabilityId: 'l-1' },
];

// A rich v7 state, in the shape the v7 app persisted.
export function richV7(): FinanceStateV7 {
  return {
    accounts: [
      { id: 'a-egp', name: 'كاش مصر', type: 'cash', currency: 'EGP', openingBalance: 60000, openingDate: '2026-01-01', location: 'EG', createdAt: CREATED, updatedAt: T0 },
      { id: 'a-sar-eg', name: 'ريال مصر', type: 'bank', currency: 'SAR', openingBalance: 5000, location: 'EG', createdAt: CREATED, updatedAt: T0 },
      { id: 'a-sar-sa', name: 'بنك السعودية', type: 'bank', currency: 'SAR', openingBalance: 3000, location: 'SA', createdAt: CREATED, updatedAt: T0 },
      { id: 'a-usd', name: 'دولار', type: 'wallet', currency: 'USD', openingBalance: 400, location: 'EG', createdAt: CREATED, updatedAt: T0 },
      { id: 'a-old', name: 'قديم', type: 'cash', currency: 'EGP', openingBalance: 100, location: 'EG', archived: true, createdAt: CREATED, updatedAt: T0 },
    ],
    categories: DEFAULT_CATEGORIES,
    transactions: TRANSACTIONS,
    funds: [
      { id: 'f-emg', name: 'طوارئ', type: 'emergency', targetAmount: 60000, currency: 'EGP', priority: 1, linkedHoldingIds: [], createdAt: CREATED, updatedAt: T0 },
      { id: 'f-trip', name: 'سفر', type: 'goal', targetAmount: 4000, currency: 'SAR', deadline: '2027-03-01', priority: 2, linkedHoldingIds: [], createdAt: CREATED, updatedAt: T0 },
      { id: 'f-ins', name: 'تأمين', type: 'sinking', targetAmount: 1200, currency: 'SAR', frequency: 'yearly', nextDueDate: '2026-12-01', priority: 3, linkedHoldingIds: [], createdAt: CREATED, updatedAt: T0 },
      { id: 'f-gold', name: 'ذهب', type: 'goal', targetAmount: 120000, currency: 'EGP', priority: 4, linkedHoldingIds: ['h-gold-1'], createdAt: CREATED, updatedAt: T0 },
    ],
    fundMovements: [
      { id: 'm1', fundId: 'f-emg', amount: 8000, currency: 'EGP', date: '2026-09-10', ratesSnapshot: S_OLD, updatedAt: T0 },
      // Currency-less (saved before currencies existed): in the fund's currency.
      { id: 'm2', fundId: 'f-emg', amount: 3000, date: '2026-09-15', updatedAt: T0 },
      { id: 'm3', fundId: 'f-trip', amount: 1500, currency: 'SAR', date: '2026-10-02', ratesSnapshot: S_NOW, updatedAt: T0 },
      { id: 'm4', fundId: 'f-trip', amount: -200, currency: 'SAR', date: '2026-10-09', ratesSnapshot: S_NOW, updatedAt: T0 },
      { id: 'm5', fundId: 'f-ins', amount: 400, date: '2026-10-03', ratesSnapshot: S_NOW, updatedAt: T0 },
      // A SAR fund funded with EGP money.
      { id: 'm6', fundId: 'f-trip', amount: 2000, currency: 'EGP', date: '2026-10-04', ratesSnapshot: S_OLD, updatedAt: T0 },
      { id: 'm7', fundId: 'f-emg', amount: 500, currency: 'USD', date: '2026-10-05', ratesSnapshot: S_NOW, updatedAt: T0 },
    ],
    holdings: [
      { id: 'h-gold-1', type: 'gold', name: 'ذهب 10 جم عيار 21', weightGrams: 10, karat: 21, purchaseCostEGP: 31000, purchaseDate: '2026-10-08', location: 'EG', updatedAt: T0 },
      // No location (v7 reads it as Egypt).
      { id: 'h-gold-2', type: 'gold', name: 'ذهب 5 جم عيار 24', weightGrams: 5, karat: 24, purchaseCostEGP: 30000, updatedAt: T0 },
      { id: 'h-gold-3', type: 'gold', name: 'ذهب 4 جم عيار 18', weightGrams: 4, karat: 18, purchaseCostEGP: 18000.55, location: 'SA', updatedAt: T0 },
      { id: 'h-usd', type: 'currency', name: 'دولار نقدي', currency: 'USD', quantity: 300, purchaseCostEGP: 14000, location: 'SA', updatedAt: T0 },
    ],
    liabilities: [{ id: 'l-1', name: 'قرض', principal: 1000, currency: 'USD', startDate: '2026-06-01', updatedAt: T0 }],
    recurringRules: [
      { id: 'r-sal', name: 'راتب', kind: 'income', amount: 3000, currency: 'SAR', accountId: 'a-sar-sa', categoryId: 'cat-income-salary', frequency: 'monthly', interval: 1, dayOfMonth: 1, startDate: '2026-08-01', nextDate: '2026-11-01', mode: 'confirm', variableAmount: false, active: true, skippedDates: [], createdAt: CREATED, updatedAt: T0 },
      { id: 'r-rent', name: 'إيجار', kind: 'expense', amount: 700, currency: 'SAR', accountId: 'a-sar-sa', categoryId: 'cat-essentials-rent', frequency: 'monthly', interval: 1, dayOfMonth: 5, startDate: '2026-08-05', nextDate: '2026-11-05', mode: 'confirm', variableAmount: false, active: true, skippedDates: [], createdAt: CREATED, updatedAt: T0 },
      { id: 'r-fx', name: 'تحويل شهري', kind: 'transfer', amount: 500, currency: 'SAR', accountId: 'a-sar-eg', toAccountId: 'a-egp', toAmount: 6200, frequency: 'monthly', interval: 1, dayOfMonth: 20, startDate: '2026-08-20', nextDate: '2026-10-20', mode: 'confirm', variableAmount: false, active: true, skippedDates: [], createdAt: CREATED, updatedAt: T0 },
    ],
    monthlyPlans: [
      {
        id: 'plan-2026-10', month: '2026-10', currency: 'SAR', expectedIncome: 4000,
        lines: [
          { categoryId: 'cat-essentials-rent', limit: 700, kind: 'fixed' },
          { categoryId: 'cat-essentials-groceries', limit: 600, kind: 'flexible' },
          { categoryId: 'cat-lifestyle-dining', limit: 300, kind: 'flexible' },
          { categoryId: 'cat-essentials-transport', limit: 150, kind: 'flexible' },
        ],
        fundContributions: [{ fundId: 'f-trip', amount: 200 }, { fundId: 'f-ins', amount: 100 }],
        createdAt: CREATED, updatedAt: T0,
      },
      {
        id: 'plan-2026-09', month: '2026-09', currency: 'EGP', expectedIncome: 50000,
        lines: [{ categoryId: 'cat-essentials-rent', limit: 8000, kind: 'fixed' }],
        fundContributions: [{ fundId: 'f-emg', amount: 3000 }],
        createdAt: CREATED, updatedAt: T0,
      },
    ],
    netWorthSnapshots: [
      {
        id: 'nw-2026-08', month: '2026-08', netWorthEGP: 400000, liquidEGP: 150000, holdingsEGP: 250000,
        takenAt: '2026-09-30T00:00:00.000Z', updatedAt: T0, estimated: true,
      },
      {
        id: 'nw-2026-09', month: '2026-09', netWorthEGP: 450000, liquidEGP: 170000, holdingsEGP: 280000,
        breakdown: {
          EG: { cashEGP: 120000, goldEGP: 200000, currenciesEGP: 0 },
          SA: { cashEGP: 50000, goldEGP: 20000, currenciesEGP: 14400 },
          liabilitiesEGP: 54400,
        },
        ratesSnapshot: S_OLD,
        takenAt: '2026-09-30T20:00:00.000Z', updatedAt: T0,
      },
    ],
    actionDismissals: [],
    monthlyReviews: [],
    settings: {
      exchangeRates: RATES_NOW,
      goldPrice24kEGP: 6000,
      goldPrice21kEGP: 5250,
      goldPriceUpdatedAt: '2026-10-01T00:00:00.000Z',
      trackingStartDate: '2026-08-01',
      deviceId: 'device-1',
      priceSource: 'manual',
      localPremiumPct: 0,
    },
    tombstones: [],
  };
}

// The committed example seed, taken through the frozen chain to v7.
export function exampleSeedV7(): FinanceStateV7 {
  return migrateToV7(EXAMPLE_SEED_V3, 3, { now: '2026-08-01T00:00:00.000Z', newId: () => '' }).state;
}

// The private opening seed (git-ignored), or null when the file is absent.
export function localSeedV7(): FinanceStateV7 | null {
  try {
    const { SEED_V3 } = require('../../store/seed.local');
    return migrateToV7(SEED_V3, 3, { now: '2026-08-05T00:00:00.000Z', newId: () => '' }).state;
  } catch {
    return null;
  }
}
