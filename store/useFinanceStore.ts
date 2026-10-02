import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

import { newId } from '@/utils/id';
import { CURRENT_VERSION, migratePersistedState } from './migrations';
import * as ops from './operations';
import { stateSummary } from './selectors';
import type {
  Account,
  Category,
  ExchangeRates,
  FinanceStateV2,
  Fund,
  FundMovement,
  Holding,
  Liability,
  MonthlyPlan,
  RecurringRule,
  Transaction,
} from './types';

const STORAGE_KEY = '@wealth_finance_state';
const BACKUP_KEY_PREFIX = '@wealth_finance_state_backup_v';

// Prefer the git-ignored personal seed; fall back to the committed example.
// Expo's Metro config enables optional dependencies, so a missing file is fine here.
function loadSeed(): FinanceStateV2 {
  try {
    return require('./seed.local').SEED_STATE as FinanceStateV2;
  } catch {
    return require('./seed.example').SEED_STATE as FinanceStateV2;
  }
}

const SEED_STATE = loadSeed();

const ctx: ops.OpContext = { newId, now: () => new Date() };

// Every action validates its input and throws FinanceValidationError on bad data.
interface FinanceActions {
  addAccount: (input: ops.NewAccount) => void;
  updateAccount: (account: Account) => void;
  deleteAccount: (id: string) => void;

  addCategory: (input: ops.NewCategory) => void;
  updateCategory: (category: Category) => void;
  deleteCategory: (id: string) => void;

  addTransaction: (input: ops.NewIncomeExpense) => void;
  addTransfer: (input: ops.NewTransfer) => void;
  updateTransaction: (tx: Transaction) => void;
  deleteTransaction: (id: string) => void;

  addFund: (input: ops.NewFund) => void;
  updateFund: (fund: Fund) => void;
  deleteFund: (id: string) => void;
  editFund: (fundId: string, edit: ops.FundEdit) => void;
  allocateToFund: (fundId: string, amount: number, note?: string) => void;
  withdrawFromFund: (fundId: string, amount: number, note?: string) => void;
  updateFundMovement: (movement: FundMovement) => void;
  deleteFundMovement: (id: string) => void;

  addHolding: (input: ops.NewHolding) => void;
  updateHolding: (holding: Holding) => void;
  deleteHolding: (id: string) => void;

  addLiability: (input: ops.NewLiability) => void;
  updateLiability: (liability: Liability) => void;
  deleteLiability: (id: string) => void;

  addRecurringRule: (input: ops.NewRecurringRule) => void;
  updateRecurringRule: (rule: RecurringRule) => void;
  deleteRecurringRule: (id: string) => void;

  setMonthlyPlan: (plan: MonthlyPlan) => void;
  deleteMonthlyPlan: (month: string) => void;

  updateRates: (rates: ExchangeRates) => void;
  updateGoldPrice: (price: number) => void;
}

export type FinanceStore = FinanceStateV2 &
  FinanceActions & {
    // True once persisted state has been read from storage (successfully or not).
    hasHydrated: boolean;
  };

// Before Zustand, the store wrote the bare state JSON to the same key.
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
    // Each action runs a pure operation against the current state and merges its patch.
    (set, get) => ({
      ...SEED_STATE,
      hasHydrated: false,

      addAccount: (input) => set(ops.addAccount(get(), input, ctx)),
      updateAccount: (account) => set(ops.updateAccount(get(), account)),
      deleteAccount: (id) => set(ops.deleteAccount(get(), id)),

      addCategory: (input) => set(ops.addCategory(get(), input, ctx)),
      updateCategory: (category) => set(ops.updateCategory(get(), category)),
      deleteCategory: (id) => set(ops.deleteCategory(get(), id)),

      addTransaction: (input) => set(ops.addTransaction(get(), input, ctx)),
      addTransfer: (input) => set(ops.addTransfer(get(), input, ctx)),
      updateTransaction: (tx) => set(ops.updateTransaction(get(), tx)),
      deleteTransaction: (id) => set(ops.deleteTransaction(get(), id)),

      addFund: (input) => set(ops.addFund(get(), input, ctx)),
      updateFund: (fund) => set(ops.updateFund(get(), fund)),
      deleteFund: (id) => set(ops.deleteFund(get(), id)),
      editFund: (fundId, edit) => set(ops.editFund(get(), fundId, edit, ctx)),
      allocateToFund: (fundId, amount, note) =>
        set(ops.allocateToFund(get(), fundId, amount, note, ctx)),
      withdrawFromFund: (fundId, amount, note) =>
        set(ops.withdrawFromFund(get(), fundId, amount, note, ctx)),
      updateFundMovement: (movement) => set(ops.updateFundMovement(get(), movement)),
      deleteFundMovement: (id) => set(ops.deleteFundMovement(get(), id)),

      addHolding: (input) => set(ops.addHolding(get(), input, ctx)),
      updateHolding: (holding) => set(ops.updateHolding(get(), holding)),
      deleteHolding: (id) => set(ops.deleteHolding(get(), id)),

      addLiability: (input) => set(ops.addLiability(get(), input, ctx)),
      updateLiability: (liability) => set(ops.updateLiability(get(), liability)),
      deleteLiability: (id) => set(ops.deleteLiability(get(), id)),

      addRecurringRule: (input) => set(ops.addRecurringRule(get(), input, ctx)),
      updateRecurringRule: (rule) => set(ops.updateRecurringRule(get(), rule)),
      deleteRecurringRule: (id) => set(ops.deleteRecurringRule(get(), id)),

      setMonthlyPlan: (plan) => set(ops.setMonthlyPlan(get(), plan)),
      deleteMonthlyPlan: (month) => set(ops.deleteMonthlyPlan(get(), month)),

      updateRates: (rates) => set(ops.updateRates(get(), rates)),
      updateGoldPrice: (price) => set(ops.updateGoldPrice(get(), price, ctx)),
    }),
    {
      name: STORAGE_KEY,
      version: CURRENT_VERSION,
      storage: createJSONStorage(() => (isServer ? noopStorage : legacyAwareStorage)),
      // persist hydrates while the store is created (i.e. at import). On the server, skip that
      // so nothing reads storage, migrates, or calls setState; `hasHydrated` stays false and the
      // server renders the loading state, matching the client's first render.
      skipHydration: isServer,
      // Persist data only — never actions or hydration flags.
      partialize: (s): FinanceStateV2 => ({
        accounts: s.accounts,
        categories: s.categories,
        transactions: s.transactions,
        funds: s.funds,
        fundMovements: s.fundMovements,
        holdings: s.holdings,
        liabilities: s.liabilities,
        recurringRules: s.recurringRules,
        monthlyPlans: s.monthlyPlans,
        settings: s.settings,
      }),
      migrate: async (persisted, version) => {
        // Keep the untouched pre-migration payload so a failed or wrong migration never
        // loses data. It is written before the migrated state can overwrite the main key.
        await AsyncStorage.setItem(
          `${BACKUP_KEY_PREFIX}${version}`,
          JSON.stringify({ state: persisted, version })
        );
        const { state: migrated, clampedBy } = migratePersistedState(persisted, version, {
          now: new Date().toISOString(),
        });
        if (__DEV__) {
          console.log(`[wealth] migrated persisted state v${version} → v${CURRENT_VERSION}`, {
            ...stateSummary(migrated),
            ...(clampedBy > 0 ? { clampedBy: Math.round(clampedBy * 100) / 100 } : {}),
          });
        }
        return migrated;
      },
      onRehydrateStorage: () => () => {
        useFinanceStore.setState({ hasHydrated: true });
      },
    }
  )
);
