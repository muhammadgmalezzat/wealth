import { DEFAULT_RATES } from '@/constants/currencies';
import type { FinanceState } from './types';

// Sample data used when store/seed.local.ts is absent.
// Copy this file to seed.local.ts (git-ignored) to seed your own figures.
export const SEED_STATE: FinanceState = {
  transactions: [],
  assets: [
    {
      id: 'asset-cash-sample',
      type: 'cash',
      name: 'Cash Wallet',
      amount: 1000,
      currency: 'SAR',
    },
    {
      id: 'asset-bank-sample',
      type: 'bank',
      name: 'Sample Bank',
      amount: 25000,
      currency: 'EGP',
    },
    {
      id: 'asset-gold-sample',
      type: 'gold',
      name: 'Gold Bar 10g 24k',
      amount: 0,
      currency: 'EGP',
      weightGrams: 10,
      karat: 24,
      purchasePrice: 60000,
    },
  ],
  goals: [
    {
      id: 'goal-sample',
      name: 'Sample Goal',
      targetAmount: 100000,
      currentAmount: 40000,
      deadline: '2027-06-30',
      currency: 'EGP',
    },
  ],
  exchangeRates: DEFAULT_RATES,
};
