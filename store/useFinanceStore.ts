import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_RATES } from '@/constants/currencies';
import { toEGP } from '@/utils/currency';
import type { Asset, ExchangeRates, FinanceState, Goal, Transaction } from './types';

const STORAGE_KEY = '@wealth_finance_state';

const SEED_STATE: FinanceState = {
  transactions: [],
  assets: [
    {
      id: 'asset-cash-sar',
      type: 'cash',
      name: 'Cash SAR',
      amount: 8056,
      currency: 'SAR',
    },
    {
      id: 'asset-bank-egp',
      type: 'bank',
      name: 'Bank EGP',
      amount: 40000,
      currency: 'EGP',
    },
    {
      id: 'asset-gold-1',
      type: 'gold',
      name: 'Gold Bar 5g 24k',
      amount: 0,
      currency: 'EGP',
      weightGrams: 5,
      karat: 24,
      purchasePrice: 30510,
    },
    {
      id: 'asset-gold-2a',
      type: 'gold',
      name: 'Gold Bar 8g 21k (1)',
      amount: 0,
      currency: 'EGP',
      weightGrams: 8,
      karat: 21,
      purchasePrice: 42720,
    },
    {
      id: 'asset-gold-2b',
      type: 'gold',
      name: 'Gold Bar 8g 21k (2)',
      amount: 0,
      currency: 'EGP',
      weightGrams: 8,
      karat: 21,
      purchasePrice: 42720,
    },
  ],
  goals: [
    {
      id: 'goal-marriage',
      name: 'Marriage Fund',
      targetAmount: 450000,
      currentAmount: 345950,
      deadline: '2026-12-31',
      currency: 'EGP',
    },
  ],
  exchangeRates: DEFAULT_RATES,
};

export function useFinanceStore() {
  const [state, setState] = useState<FinanceState>(SEED_STATE);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) {
        try {
          setState(JSON.parse(raw));
        } catch {
          // corrupted data — fall back to seed
        }
      }
      setLoaded(true);
    });
  }, []);

  const persist = useCallback((next: FinanceState) => {
    setState(next);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  // --- Transactions ---
  const addTransaction = useCallback(
    (tx: Transaction) => persist({ ...state, transactions: [tx, ...state.transactions] }),
    [state, persist]
  );

  const updateTransaction = useCallback(
    (tx: Transaction) =>
      persist({
        ...state,
        transactions: state.transactions.map((t) => (t.id === tx.id ? tx : t)),
      }),
    [state, persist]
  );

  const deleteTransaction = useCallback(
    (id: string) =>
      persist({ ...state, transactions: state.transactions.filter((t) => t.id !== id) }),
    [state, persist]
  );

  // --- Assets ---
  const addAsset = useCallback(
    (asset: Asset) => persist({ ...state, assets: [...state.assets, asset] }),
    [state, persist]
  );

  const updateAsset = useCallback(
    (asset: Asset) =>
      persist({ ...state, assets: state.assets.map((a) => (a.id === asset.id ? asset : a)) }),
    [state, persist]
  );

  const deleteAsset = useCallback(
    (id: string) => persist({ ...state, assets: state.assets.filter((a) => a.id !== id) }),
    [state, persist]
  );

  // --- Goals ---
  const addGoal = useCallback(
    (goal: Goal) => persist({ ...state, goals: [...state.goals, goal] }),
    [state, persist]
  );

  const updateGoal = useCallback(
    (goal: Goal) =>
      persist({ ...state, goals: state.goals.map((g) => (g.id === goal.id ? goal : g)) }),
    [state, persist]
  );

  const deleteGoal = useCallback(
    (id: string) => persist({ ...state, goals: state.goals.filter((g) => g.id !== id) }),
    [state, persist]
  );

  // --- Exchange rates ---
  const updateRates = useCallback(
    (rates: ExchangeRates) => persist({ ...state, exchangeRates: rates }),
    [state, persist]
  );

  // --- Net worth ---
  const totalNetWorthEGP = useCallback((): number => {
    const { assets, exchangeRates } = state;
    return assets.reduce((sum, asset) => {
      if (asset.type === 'gold') {
        // Gold assets track value via amount field (0 = use purchase price as fallback)
        const cost = asset.purchasePrice ?? 0;
        return sum + toEGP(cost, asset.currency, exchangeRates);
      }
      return sum + toEGP(asset.amount, asset.currency, exchangeRates);
    }, 0);
  }, [state]);

  return {
    ...state,
    loaded,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    addAsset,
    updateAsset,
    deleteAsset,
    addGoal,
    updateGoal,
    deleteGoal,
    updateRates,
    totalNetWorthEGP,
  };
}
