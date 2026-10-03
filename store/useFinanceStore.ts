import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

import { newId } from '@/utils/id';
import { CURRENT_VERSION, migratePersistedState } from './migrations';
import * as ops from './operations';
import { stateSummary, type FundAmount } from './selectors';
import type {
  Account,
  Category,
  ExchangeRates,
  FinanceState,
  Fund,
  FundMovement,
  Holding,
  Liability,
  RecurringRule,
  Transaction,
} from './types';

const STORAGE_KEY = '@wealth_finance_state';
const BACKUP_KEY_PREFIX = '@wealth_finance_state_backup_v';
const IMPORT_BACKUP_KEY = '@wealth_finance_state_backup_before_import';
const RESTORE_BACKUP_KEY = '@wealth_finance_state_backup_before_restore';

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

const ctx: ops.OpContext = { newId, now: () => new Date() };

// The persisted part of the store: data only, never actions or hydration flags. Also what a
// backup contains.
export function dataOf(s: FinanceState): FinanceState {
  return {
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
    tombstones: s.tombstones,
  };
}

// Saves the current data under `key` before a destructive replace, so it can be recovered.
async function saveSnapshot(key: string, state: FinanceState) {
  await AsyncStorage.setItem(
    key,
    JSON.stringify({ state: dataOf(state), version: CURRENT_VERSION, savedAt: new Date().toISOString() })
  );
}

// Every action validates its input and throws FinanceValidationError on bad data.
interface FinanceActions {
  addAccount: (input: ops.NewAccount) => void;
  updateAccount: (account: ops.Editable<Account>) => void;
  deleteAccount: (id: string) => void;

  addCategory: (input: ops.NewCategory) => void;
  updateCategory: (category: ops.Editable<Category>) => void;
  deleteCategory: (id: string) => void;
  archiveCategory: (id: string, archived: boolean) => void;
  // Returns the new category's id.
  addCategoryWithPlanLine: (input: Pick<ops.NewCategory, 'name' | 'bucket'>, line: ops.NewPlanLine) => string;

  addTransaction: (input: ops.NewIncomeExpense) => void;
  addTransfer: (input: ops.NewTransfer) => void;
  updateTransaction: (tx: ops.Editable<Transaction>) => void;
  deleteTransaction: (id: string) => void;

  addFund: (input: ops.NewFund) => void;
  updateFund: (fund: ops.Editable<Fund>) => void;
  deleteFund: (id: string) => void;
  editFund: (fundId: string, edit: ops.FundEdit) => void;
  allocateMany: (allocations: FundAmount[], note?: string) => void;
  withdrawMany: (withdrawals: FundAmount[], note?: string) => void;
  paySinkingFund: (payment: ops.SinkingPayment) => void;
  allocateToFund: (fundId: string, amount: number, note?: string) => void;
  withdrawFromFund: (fundId: string, amount: number, note?: string) => void;
  updateFundMovement: (movement: ops.Editable<FundMovement>) => void;
  deleteFundMovement: (id: string) => void;

  addHolding: (input: ops.NewHolding) => void;
  updateHolding: (holding: ops.Editable<Holding>) => void;
  deleteHolding: (id: string) => void;

  addLiability: (input: ops.NewLiability) => void;
  updateLiability: (liability: ops.Editable<Liability>) => void;
  deleteLiability: (id: string) => void;

  // `linkTransactionId`: the transaction a rule is being made from ("خليها متكررة").
  addRecurringRule: (input: ops.NewRecurringRule, linkTransactionId?: string) => void;
  updateRecurringRule: (rule: ops.Editable<RecurringRule>) => void;
  deleteRecurringRule: (id: string) => void;
  setRecurringActive: (id: string, active: boolean) => void;
  // Records due occurrences of 'auto' rules. Safe to call any time (idempotent).
  processDue: () => void;
  confirmOccurrence: (ruleId: string, occurrenceDate: string, overrides: ops.OccurrenceOverrides) => void;
  skipOccurrence: (ruleId: string, occurrenceDate: string) => void;

  savePlan: (plan: ops.PlanInput) => void;
  copyPlan: (fromMonth: string, toMonth: string) => void;
  deletePlan: (month: string) => void;

  updateRates: (rates: ExchangeRates) => void;
  updateSettings: (update: ops.SettingsUpdate) => void;

  buyGold: (purchase: ops.GoldPurchase) => void;
  updateGoldPurchase: (txId: string, purchase: ops.GoldPurchase) => void;

  // Backs up the current data, then replaces it with the opening seed.
  importOpeningData: () => Promise<void>;
  // Backs up the current data, then replaces it with a decrypted, migrated backup.
  restoreBackup: (restored: FinanceState) => Promise<void>;
  markBackedUp: (at: string) => void;
  setAppLock: (enabled: boolean) => void;
  setDueNotifications: (enabled: boolean) => void;
}

export type FinanceStore = FinanceState &
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
      updateAccount: (account) => set(ops.updateAccount(get(), account, ctx)),
      deleteAccount: (id) => set(ops.deleteAccount(get(), id, ctx)),

      addCategory: (input) => set(ops.addCategory(get(), input, ctx)),
      updateCategory: (category) => set(ops.updateCategory(get(), category, ctx)),
      deleteCategory: (id) => set(ops.deleteCategory(get(), id, ctx)),
      archiveCategory: (id, archived) => set(ops.archiveCategory(get(), id, archived, ctx)),
      addCategoryWithPlanLine: (input, line) => {
        const patch = ops.addCategoryWithPlanLine(get(), input, line, ctx);
        set(patch);
        return patch.categories![patch.categories!.length - 1].id;
      },

      addTransaction: (input) => set(ops.addTransaction(get(), input, ctx)),
      addTransfer: (input) => set(ops.addTransfer(get(), input, ctx)),
      updateTransaction: (tx) => set(ops.updateTransaction(get(), tx, ctx)),
      deleteTransaction: (id) => set(ops.deleteTransaction(get(), id, ctx)),

      addFund: (input) => set(ops.addFund(get(), input, ctx)),
      updateFund: (fund) => set(ops.updateFund(get(), fund, ctx)),
      deleteFund: (id) => set(ops.deleteFund(get(), id, ctx)),
      editFund: (fundId, edit) => set(ops.editFund(get(), fundId, edit, ctx)),
      allocateMany: (allocations, note) => set(ops.allocateMany(get(), allocations, note, ctx)),
      withdrawMany: (withdrawals, note) => set(ops.withdrawMany(get(), withdrawals, note, ctx)),
      paySinkingFund: (payment) => set(ops.paySinkingFund(get(), payment, ctx)),
      allocateToFund: (fundId, amount, note) =>
        set(ops.allocateToFund(get(), fundId, amount, note, ctx)),
      withdrawFromFund: (fundId, amount, note) =>
        set(ops.withdrawFromFund(get(), fundId, amount, note, ctx)),
      updateFundMovement: (movement) => set(ops.updateFundMovement(get(), movement, ctx)),
      deleteFundMovement: (id) => set(ops.deleteFundMovement(get(), id, ctx)),

      addHolding: (input) => set(ops.addHolding(get(), input, ctx)),
      updateHolding: (holding) => set(ops.updateHolding(get(), holding, ctx)),
      deleteHolding: (id) => set(ops.deleteHolding(get(), id, ctx)),

      addLiability: (input) => set(ops.addLiability(get(), input, ctx)),
      updateLiability: (liability) => set(ops.updateLiability(get(), liability, ctx)),
      deleteLiability: (id) => set(ops.deleteLiability(get(), id, ctx)),

      addRecurringRule: (input, linkTransactionId) => set(ops.addRecurringRule(get(), input, ctx, linkTransactionId)),
      updateRecurringRule: (rule) => set(ops.updateRecurringRule(get(), rule, ctx)),
      deleteRecurringRule: (id) => set(ops.deleteRecurringRule(get(), id, ctx)),
      setRecurringActive: (id, active) => set(ops.setRecurringActive(get(), id, active, ctx)),
      processDue: () => {
        const patch = ops.processDue(get(), ctx);
        if (Object.keys(patch).length > 0) set(patch);
      },
      confirmOccurrence: (ruleId, occurrenceDate, overrides) =>
        set(ops.confirmOccurrence(get(), ruleId, occurrenceDate, overrides, ctx)),
      skipOccurrence: (ruleId, occurrenceDate) => set(ops.skipOccurrence(get(), ruleId, occurrenceDate, ctx)),

      savePlan: (plan) => set(ops.savePlan(get(), plan, ctx)),
      copyPlan: (fromMonth, toMonth) => set(ops.copyPlan(get(), fromMonth, toMonth, ctx)),
      deletePlan: (month) => set(ops.deletePlan(get(), month, ctx)),

      updateRates: (rates) => set(ops.updateRates(get(), rates)),
      updateSettings: (update) => set(ops.updateSettings(get(), update, ctx)),

      buyGold: (purchase) => set(ops.buyGold(get(), purchase, ctx)),
      updateGoldPurchase: (txId, purchase) => set(ops.updateGoldPurchase(get(), txId, purchase, ctx)),

      // Snapshots are written before anything changes, so a mistaken import or restore can
      // always be undone by hand.
      importOpeningData: async () => {
        await saveSnapshot(IMPORT_BACKUP_KEY, get());
        set(ops.replaceWithSeed(get(), SEED_STATE, ctx));
      },
      restoreBackup: async (restored) => {
        await saveSnapshot(RESTORE_BACKUP_KEY, get());
        set(ops.restoreFromBackup(get(), restored, ctx));
      },
      markBackedUp: (at) => set(ops.markBackedUp(get(), at)),
      setAppLock: (enabled) => set(ops.setAppLock(get(), enabled)),
      setDueNotifications: (enabled) => set(ops.setDueNotifications(get(), enabled)),
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
      partialize: (s: FinanceStore) => dataOf(s),
      migrate: async (persisted, version) => {
        // Keep the untouched pre-migration payload so a failed or wrong migration never
        // loses data. It is written before the migrated state can overwrite the main key.
        await AsyncStorage.setItem(
          `${BACKUP_KEY_PREFIX}${version}`,
          JSON.stringify({ state: persisted, version })
        );
        const { state: migrated, clampedBy } = migratePersistedState(persisted, version, {
          now: new Date().toISOString(),
          newId,
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
        // A fresh install starts from the seed, which has no device id yet.
        const state = useFinanceStore.getState();
        useFinanceStore.setState({ ...ops.ensureDeviceId(state, ctx), hasHydrated: true });
      },
    }
  )
);
