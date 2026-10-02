import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type { Asset, ExchangeRates, FinanceState, Goal, Transaction } from './types';

const STORAGE_KEY = '@wealth_finance_state';
const STORAGE_VERSION = 1;

// Prefer the git-ignored personal seed; fall back to the committed example.
// Expo's Metro config enables optional dependencies, so a missing file is fine here.
function loadSeed(): FinanceState {
  try {
    return require('./seed.local').SEED_STATE as FinanceState;
  } catch {
    return require('./seed.example').SEED_STATE as FinanceState;
  }
}

const SEED_STATE = loadSeed();

interface FinanceActions {
  addTransaction: (tx: Transaction) => void;
  updateTransaction: (tx: Transaction) => void;
  deleteTransaction: (id: string) => void;
  addAsset: (asset: Asset) => void;
  updateAsset: (asset: Asset) => void;
  deleteAsset: (id: string) => void;
  addGoal: (goal: Goal) => void;
  updateGoal: (goal: Goal) => void;
  deleteGoal: (id: string) => void;
  updateRates: (rates: ExchangeRates) => void;
}

export type FinanceStore = FinanceState &
  FinanceActions & {
    // True once persisted state has been read from storage (successfully or not).
    hasHydrated: boolean;
  };

// Before Zustand, the store wrote the bare FinanceState JSON to the same key.
// Wrap that legacy shape as version 0 so `migrate` can upgrade it instead of discarding it.
const legacyAwareStorage: StateStorage = {
  getItem: async (name) => {
    const raw = await AsyncStorage.getItem(name);
    if (!raw) return raw;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !('state' in parsed)) {
        return JSON.stringify({ state: parsed, version: 0 });
      }
    } catch {
      // corrupted data — let persist fail hydration and keep the seed
    }
    return raw;
  },
  setItem: (name, value) => AsyncStorage.setItem(name, value),
  removeItem: (name) => AsyncStorage.removeItem(name),
};

// expo-router renders web pages in Node, where `window` (and so AsyncStorage's localStorage)
// doesn't exist. Native always defines `window`, so this is only true during web server rendering.
const isServer = Platform.OS === 'web' && typeof window === 'undefined';

const noopStorage: StateStorage = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
};

export const useFinanceStore = create<FinanceStore>()(
  persist(
    (set) => ({
      ...SEED_STATE,
      hasHydrated: false,

      // --- Transactions ---
      addTransaction: (tx) => set((s) => ({ transactions: [tx, ...s.transactions] })),
      updateTransaction: (tx) =>
        set((s) => ({ transactions: s.transactions.map((t) => (t.id === tx.id ? tx : t)) })),
      deleteTransaction: (id) =>
        set((s) => ({ transactions: s.transactions.filter((t) => t.id !== id) })),

      // --- Assets ---
      addAsset: (asset) => set((s) => ({ assets: [...s.assets, asset] })),
      updateAsset: (asset) =>
        set((s) => ({ assets: s.assets.map((a) => (a.id === asset.id ? asset : a)) })),
      deleteAsset: (id) => set((s) => ({ assets: s.assets.filter((a) => a.id !== id) })),

      // --- Goals ---
      addGoal: (goal) => set((s) => ({ goals: [...s.goals, goal] })),
      updateGoal: (goal) =>
        set((s) => ({ goals: s.goals.map((g) => (g.id === goal.id ? goal : g)) })),
      deleteGoal: (id) => set((s) => ({ goals: s.goals.filter((g) => g.id !== id) })),

      // --- Exchange rates ---
      updateRates: (rates) => set({ exchangeRates: rates }),
    }),
    {
      name: STORAGE_KEY,
      version: STORAGE_VERSION,
      storage: createJSONStorage(() => (isServer ? noopStorage : legacyAwareStorage)),
      // persist hydrates while the store is created (i.e. at import). On the server, skip that
      // so nothing reads storage, migrates, or calls setState; `hasHydrated` stays false and the
      // server renders the loading state, matching the client's first render.
      skipHydration: isServer,
      // Persist data only — never actions or hydration flags.
      partialize: (s): FinanceState => ({
        transactions: s.transactions,
        assets: s.assets,
        goals: s.goals,
        exchangeRates: s.exchangeRates,
      }),
      // v0 (pre-Zustand) has the same data shape as v1; only the storage envelope changed,
      // so no transformation is needed. Add `if (version < N)` steps here as the schema evolves.
      migrate: (persisted) => persisted as FinanceState,
      onRehydrateStorage: () => () => {
        useFinanceStore.setState({ hasHydrated: true });
      },
    }
  )
);
