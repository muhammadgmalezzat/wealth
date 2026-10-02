import { DEFAULT_RATES } from '@/constants/currencies';
import { GOLD_PRICE_24K } from '@/constants/market';
import { DEFAULT_CATEGORIES } from './defaultCategories';
import type { FinanceStateV2 } from './types';

// Sample data used when store/seed.local.ts is absent.
// Copy this file to seed.local.ts (git-ignored) to seed your own figures.
const CREATED_AT = '2026-01-01T00:00:00.000Z';

export const SEED_STATE: FinanceStateV2 = {
  accounts: [
    {
      id: 'acct-cash-sample',
      name: 'Cash Wallet',
      type: 'cash',
      currency: 'SAR',
      openingBalance: 1000,
      createdAt: CREATED_AT,
    },
    {
      id: 'acct-bank-sample',
      name: 'Sample Bank',
      type: 'bank',
      currency: 'EGP',
      openingBalance: 25000,
      createdAt: CREATED_AT,
    },
  ],
  categories: DEFAULT_CATEGORIES,
  transactions: [],
  funds: [
    {
      id: 'fund-sample',
      name: 'Sample Goal',
      type: 'goal',
      targetAmount: 100000,
      currency: 'EGP',
      deadline: '2027-06-30',
      priority: 1,
      linkedHoldingIds: ['holding-gold-sample'],
      createdAt: CREATED_AT,
    },
  ],
  fundMovements: [
    {
      id: 'fund-sample-opening',
      fundId: 'fund-sample',
      amount: 10000,
      date: '2026-01-01',
      note: 'Opening balance',
    },
  ],
  holdings: [
    {
      id: 'holding-gold-sample',
      type: 'gold',
      name: 'Gold Bar 10g 24k',
      weightGrams: 10,
      karat: 24,
      purchaseCostEGP: 60000,
    },
  ],
  liabilities: [],
  recurringRules: [],
  monthlyPlans: [],
  settings: {
    exchangeRates: DEFAULT_RATES,
    goldPrice24kEGP: GOLD_PRICE_24K,
    goldPriceUpdatedAt: CREATED_AT,
  },
};
