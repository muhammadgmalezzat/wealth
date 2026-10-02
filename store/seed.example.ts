import { DEFAULT_RATES } from '@/constants/currencies';
import { DEFAULT_TRACKING_START_DATE, GOLD_PRICE_21K, GOLD_PRICE_24K } from '@/constants/market';
import { DEFAULT_CATEGORIES } from './defaultCategories';
import { migrateV3toV4, type FinanceStateV3 } from './migrations';
import type { FinanceState } from './types';

// Sample data used when store/seed.local.ts is absent. All values are made up.
// Copy this file to seed.local.ts (git-ignored) to seed your own opening position.
const CREATED_AT = '2026-08-01T00:00:00.000Z';
const OPENING_DATE = '2026-08-01';

// Written in the v3 shape; migrateV3toV4 adds updatedAt (= createdAt) and the empty tombstone
// log. The device id stays empty here and is created on first launch.
const SEED_V3: FinanceStateV3 = {
  accounts: [
    {
      id: 'acct-sample-egp',
      name: 'Sample Cash EGP',
      type: 'cash',
      currency: 'EGP',
      location: 'EG',
      openingBalance: 5000,
      openingDate: OPENING_DATE,
      createdAt: CREATED_AT,
    },
    {
      id: 'acct-sample-sar',
      name: 'Sample Wallet SAR',
      type: 'wallet',
      currency: 'SAR',
      location: 'SA',
      openingBalance: 1500,
      openingDate: OPENING_DATE,
      createdAt: CREATED_AT,
    },
  ],
  categories: DEFAULT_CATEGORIES,
  holdings: [
    {
      id: 'holding-sample-gold',
      type: 'gold',
      name: 'Sample Gold 10g 21k',
      weightGrams: 10,
      karat: 21,
      purchaseCostEGP: 50000,
      purchaseDate: '2026-01-15',
      location: 'EG',
    },
  ],
  transactions: [
    {
      id: 'sample-tx-salary',
      type: 'income',
      amount: 3000,
      currency: 'SAR',
      accountId: 'acct-sample-sar',
      categoryId: 'cat-income-salary',
      date: '2026-08-28',
      rateToEGP: DEFAULT_RATES.SAR_EGP,
      createdAt: '2026-08-28T12:00:00.000Z',
    },
    {
      id: 'sample-tx-rent',
      type: 'expense',
      amount: 800,
      currency: 'SAR',
      accountId: 'acct-sample-sar',
      categoryId: 'cat-essentials-rent',
      date: '2026-08-02',
      rateToEGP: DEFAULT_RATES.SAR_EGP,
      createdAt: '2026-08-02T12:00:00.000Z',
    },
    {
      id: 'sample-tx-setup',
      type: 'expense',
      amount: 250,
      currency: 'SAR',
      accountId: 'acct-sample-sar',
      categoryId: 'cat-essentials-home-setup',
      date: '2026-08-03',
      rateToEGP: DEFAULT_RATES.SAR_EGP,
      createdAt: '2026-08-03T12:00:00.000Z',
      oneTime: true,
    },
  ],
  funds: [],
  fundMovements: [],
  liabilities: [],
  recurringRules: [],
  monthlyPlans: [],
  settings: {
    exchangeRates: DEFAULT_RATES,
    goldPrice24kEGP: GOLD_PRICE_24K,
    goldPrice21kEGP: GOLD_PRICE_21K,
    goldPriceUpdatedAt: CREATED_AT,
    trackingStartDate: DEFAULT_TRACKING_START_DATE,
  },
};

export const SEED_STATE: FinanceState = migrateV3toV4(SEED_V3, { now: CREATED_AT, newId: () => '' });
