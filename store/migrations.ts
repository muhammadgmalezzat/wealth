import { DEFAULT_RATES } from '@/constants/currencies';
import { GOLD_PRICE_24K } from '@/constants/market';
import { fromEGP, rateToEGP, toEGP } from '@/utils/currency';
import { CATEGORY_IDS, DEFAULT_CATEGORIES } from './defaultCategories';
import { holdingValueEGP, liquidTotalEGP } from './selectors';
import type {
  Account,
  CurrencyCode,
  ExchangeRates,
  FinanceStateV2,
  Fund,
  FundMovement,
  GoldHolding,
  GoldKarat,
  IncomeExpenseTransaction,
  Settings,
} from './types';

// Pure, deterministic migrations (no RN imports) so they run in Node tests.
//   v0: pre-Zustand bare JSON — same shape as v1.
//   v1: { transactions, assets, goals, exchangeRates }
//   v2: FinanceStateV2

export const CURRENT_VERSION = 2;

interface LegacyTransactionV1 {
  id: string;
  amount: number;
  currency: CurrencyCode;
  type: 'income' | 'expense';
  category: string;
  date: string;
  note?: string;
}

interface LegacyAssetV1 {
  id: string;
  type: 'cash' | 'gold' | 'bank';
  name: string;
  amount: number;
  currency: CurrencyCode;
  purchasePrice?: number;
  weightGrams?: number;
  karat?: number;
}

interface LegacyGoalV1 {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  deadline?: string;
  currency: CurrencyCode;
}

export interface FinanceStateV1 {
  transactions: LegacyTransactionV1[];
  assets: LegacyAssetV1[];
  goals: LegacyGoalV1[];
  exchangeRates: ExchangeRates;
}

export interface MigrationContext {
  // ISO timestamp used for createdAt / goldPriceUpdatedAt of migrated entities.
  now: string;
}

// Tolerate partially written or older payloads: missing collections become empty.
function normalizeV1(persisted: unknown): FinanceStateV1 {
  const s = (persisted ?? {}) as Partial<FinanceStateV1>;
  return {
    transactions: Array.isArray(s.transactions) ? s.transactions : [],
    assets: Array.isArray(s.assets) ? s.assets : [],
    goals: Array.isArray(s.goals) ? s.goals : [],
    exchangeRates: s.exchangeRates ?? DEFAULT_RATES,
  };
}

export function migrateV0toV1(persisted: unknown): FinanceStateV1 {
  // Only the storage envelope changed between v0 and v1.
  return normalizeV1(persisted);
}

const toKarat = (karat: number | undefined): GoldKarat =>
  karat === 18 || karat === 21 ? karat : 24;

const toDateKey = (date: string) => date.slice(0, 10);


export interface MigrationResult {
  state: FinanceStateV2;
  // EGP of v1 goal savings that could not be backed by cash (opening allocations are capped
  // so unassigned money never starts negative). 0 when nothing was clamped.
  clampedBy: number;
}

export function migrateV1toV2(persisted: unknown, ctx: MigrationContext): MigrationResult {
  const v1 = normalizeV1(persisted);
  const rates = v1.exchangeRates;
  const settings: Settings = {
    exchangeRates: rates,
    goldPrice24kEGP: GOLD_PRICE_24K,
    goldPriceUpdatedAt: ctx.now,
  };

  // Ids are carried over from v1 so migrated entities stay recognisable.
  const accounts: Account[] = v1.assets
    .filter((a) => a.type === 'cash' || a.type === 'bank')
    .map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type === 'bank' ? 'bank' : 'cash',
      currency: a.currency,
      openingBalance: a.amount,
      createdAt: ctx.now,
    }));

  // v1 transactions had free-text categories and no account. Attach each to the first
  // account in its currency, creating an empty one per currency if none exists.
  const accountFor = (currency: CurrencyCode): string => {
    const existing = accounts.find((a) => a.currency === currency);
    if (existing) return existing.id;
    const created: Account = {
      id: `acct-legacy-${currency.toLowerCase()}`,
      name: `Legacy ${currency}`,
      type: 'cash',
      currency,
      openingBalance: 0,
      createdAt: ctx.now,
    };
    accounts.push(created);
    return created.id;
  };

  const transactions: IncomeExpenseTransaction[] = v1.transactions.map((tx) => ({
    id: tx.id,
    type: tx.type,
    amount: tx.amount,
    currency: tx.currency,
    accountId: accountFor(tx.currency),
    categoryId: tx.type === 'income' ? CATEGORY_IDS.otherIncome : CATEGORY_IDS.groceries,
    date: toDateKey(tx.date),
    // Keep the old free-text category so no information is lost.
    note: [tx.category, tx.note].filter(Boolean).join(' — ') || undefined,
    rateToEGP: rateToEGP(tx.currency, rates),
    createdAt: tx.date,
  }));

  const holdings: GoldHolding[] = v1.assets
    .filter((a) => a.type === 'gold')
    .map((a) => ({
      id: a.id,
      type: 'gold',
      name: a.name,
      weightGrams: a.weightGrams ?? 0,
      karat: toKarat(a.karat),
      purchaseCostEGP: toEGP(a.purchasePrice ?? 0, a.currency, rates),
    }));

  const goldMarketEGP = holdings.reduce((total, h) => total + holdingValueEGP({ settings }, h), 0);

  // A holding backs at most one fund, so all gold goes to the first goal. Each goal's
  // remaining savings become an opening cash allocation, capped by the cash still
  // unallocated: max(0, min(currentAmount − linked gold, available liquid)).
  let availableEGP = liquidTotalEGP({ accounts, transactions, settings });
  let clampedBy = 0;
  const funds: Fund[] = [];
  const fundMovements: FundMovement[] = [];
  v1.goals.forEach((goal, index) => {
    const ownsGold = index === 0;
    funds.push({
      id: goal.id,
      name: goal.name,
      type: 'goal',
      targetAmount: goal.targetAmount,
      currency: goal.currency,
      deadline: goal.deadline,
      priority: index + 1,
      linkedHoldingIds: ownsGold ? holdings.map((h) => h.id) : [],
      createdAt: ctx.now,
    });

    const wantedEGP = Math.max(
      0,
      toEGP(goal.currentAmount, goal.currency, rates) - (ownsGold ? goldMarketEGP : 0)
    );
    const openingEGP = Math.max(0, Math.min(wantedEGP, availableEGP));
    clampedBy += wantedEGP - openingEGP;
    availableEGP -= openingEGP;
    if (openingEGP > 0) {
      fundMovements.push({
        id: `${goal.id}-opening`,
        fundId: goal.id,
        amount: fromEGP(openingEGP, goal.currency, rates),
        date: ctx.now.slice(0, 10),
        note: 'Opening balance (migrated)',
      });
    }
  });

  return {
    state: {
      accounts,
      categories: DEFAULT_CATEGORIES,
      transactions,
      funds,
      fundMovements,
      holdings,
      liabilities: [],
      recurringRules: [],
      monthlyPlans: [],
      settings,
    },
    clampedBy,
  };
}

// Entry point used by zustand persist: upgrades any older payload step by step.
export function migratePersistedState(
  persisted: unknown,
  version: number,
  ctx: MigrationContext
): MigrationResult {
  let state = persisted;
  let clampedBy = 0;
  if (version < 1) state = migrateV0toV1(state);
  if (version < 2) ({ state, clampedBy } = migrateV1toV2(state, ctx));
  return { state: state as FinanceStateV2, clampedBy };
}
