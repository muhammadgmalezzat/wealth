import { DEFAULT_RATES } from '@/constants/currencies';
import { DEFAULT_TRACKING_START_DATE, GOLD_PRICE_21K, GOLD_PRICE_24K } from '@/constants/market';
import { fromEGP, rateToEGP, toEGP } from '@/utils/currency';
import { CATEGORY_IDS, DEFAULT_CATEGORIES } from './defaultCategories';
import { holdingValueEGP, liquidTotalEGP } from './selectors';
import type {
  Account,
  Category,
  CurrencyCode,
  ExchangeRates,
  FinanceState,
  Fund,
  FundMovement,
  GoldHolding,
  GoldKarat,
  Holding,
  IncomeExpenseTransaction,
  Liability,
  MonthlyPlan,
  RecurringRule,
  Settings,
  Tombstone,
  Transaction,
} from './types';

// Pure, deterministic migrations (no RN imports) so they run in Node tests.
//   v0: pre-Zustand bare JSON — same shape as v1.
//   v1: { transactions, assets, goals, exchangeRates }
//   v2: accounts/transactions/funds/holdings/… (first version of the current model)
//   v3: + account location & openingDate, holding location, oneTime expenses,
//       asset_purchase transactions, 21k gold price, trackingStartDate, new categories
//   v4: + updatedAt on every entity, tombstones (deletion log), settings.deviceId

export const CURRENT_VERSION = 4;

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
  // ISO timestamp used for createdAt / updatedAt / goldPriceUpdatedAt of migrated entities.
  now: string;
  // Creates the device id the first time (v3 → v4).
  newId: () => string;
}

// Entities as stored before v4 (no updatedAt yet).
type Unsynced<T> = T extends unknown ? Omit<T, 'updatedAt'> & { updatedAt?: string } : never;

// The v3 data shape. Also the shape v1→v2 and v2→v3 produce, and what seeds are written in.
export interface FinanceStateV3 {
  accounts: Unsynced<Account>[];
  categories: Unsynced<Category>[];
  transactions: Unsynced<Transaction>[];
  funds: Unsynced<Fund>[];
  fundMovements: Unsynced<FundMovement>[];
  holdings: Unsynced<Holding>[];
  liabilities: Unsynced<Liability>[];
  recurringRules: Unsynced<RecurringRule>[];
  monthlyPlans: Unsynced<MonthlyPlan>[];
  settings: Omit<Settings, 'deviceId'> & { deviceId?: string };
  tombstones?: Tombstone[];
}

// Selectors are typed for v4 but only read fields that v3 already had.
const asCurrent = (state: object) => state as unknown as FinanceState;

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


interface V2Result {
  state: FinanceStateV3;
  clampedBy: number;
}

export interface MigrationResult {
  state: FinanceState;
  // EGP of v1 goal savings that could not be backed by cash (opening allocations are capped
  // so unassigned money never starts negative). 0 when nothing was clamped.
  clampedBy: number;
}

export function migrateV1toV2(persisted: unknown, ctx: MigrationContext): V2Result {
  const v1 = normalizeV1(persisted);
  const rates = v1.exchangeRates;
  const settings: FinanceStateV3['settings'] = {
    exchangeRates: rates,
    goldPrice24kEGP: GOLD_PRICE_24K,
    goldPrice21kEGP: GOLD_PRICE_21K,
    goldPriceUpdatedAt: ctx.now,
    trackingStartDate: DEFAULT_TRACKING_START_DATE,
  };

  // Ids are carried over from v1 so migrated entities stay recognisable.
  const accounts: Unsynced<Account>[] = v1.assets
    .filter((a) => a.type === 'cash' || a.type === 'bank')
    .map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type === 'bank' ? 'bank' : 'cash',
      currency: a.currency,
      openingBalance: a.amount,
      location: 'EG',
      createdAt: ctx.now,
    }));

  // v1 transactions had free-text categories and no account. Attach each to the first
  // account in its currency, creating an empty one per currency if none exists.
  const accountFor = (currency: CurrencyCode): string => {
    const existing = accounts.find((a) => a.currency === currency);
    if (existing) return existing.id;
    const created: Unsynced<Account> = {
      id: `acct-legacy-${currency.toLowerCase()}`,
      name: `Legacy ${currency}`,
      type: 'cash',
      currency,
      openingBalance: 0,
      location: 'EG',
      createdAt: ctx.now,
    };
    accounts.push(created);
    return created.id;
  };

  const transactions: Unsynced<IncomeExpenseTransaction>[] = v1.transactions.map((tx) => ({
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

  const holdings: Unsynced<GoldHolding>[] = v1.assets
    .filter((a) => a.type === 'gold')
    .map((a) => ({
      id: a.id,
      type: 'gold',
      name: a.name,
      weightGrams: a.weightGrams ?? 0,
      karat: toKarat(a.karat),
      purchaseCostEGP: toEGP(a.purchasePrice ?? 0, a.currency, rates),
    }));

  const goldMarketEGP = holdings.reduce((total, h) => total + holdingValueEGP(asCurrent({ settings }), h as GoldHolding), 0);

  // A holding backs at most one fund, so all gold goes to the first goal. Each goal's
  // remaining savings become an opening cash allocation, capped by the cash still
  // unallocated: max(0, min(currentAmount − linked gold, available liquid)).
  let availableEGP = liquidTotalEGP(asCurrent({ accounts, transactions, settings }));
  let clampedBy = 0;
  const funds: Unsynced<Fund>[] = [];
  const fundMovements: Unsynced<FundMovement>[] = [];
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

// v2 → v3: fills the new required fields with defaults and adds default categories that
// are missing (matched by id, so user-renamed defaults are kept). Idempotent.
export function migrateV2toV3(persisted: unknown): FinanceStateV3 {
  const s = (persisted ?? {}) as Partial<FinanceStateV3>;
  const list = <T,>(value: T[] | undefined): T[] => (Array.isArray(value) ? value : []);
  const categories = list(s.categories);
  const settings: Omit<FinanceStateV3['settings'], 'goldPrice21kEGP' | 'trackingStartDate'> &
    Partial<Settings> = s.settings ?? {
    exchangeRates: DEFAULT_RATES,
    goldPrice24kEGP: GOLD_PRICE_24K,
    goldPriceUpdatedAt: new Date(0).toISOString(),
  };
  return {
    accounts: list(s.accounts).map((a) => ({ ...a, location: a.location ?? 'EG' })),
    categories: [...categories, ...DEFAULT_CATEGORIES.filter((d) => !categories.some((c) => c.id === d.id))],
    transactions: list(s.transactions),
    funds: list(s.funds),
    fundMovements: list(s.fundMovements),
    holdings: list(s.holdings),
    liabilities: list(s.liabilities),
    recurringRules: list(s.recurringRules),
    monthlyPlans: list(s.monthlyPlans),
    settings: {
      ...settings,
      goldPrice21kEGP: settings.goldPrice21kEGP ?? (settings.goldPrice24kEGP * 21) / 24,
      trackingStartDate: settings.trackingStartDate ?? DEFAULT_TRACKING_START_DATE,
    },
  };
}

// v3 → v4: every entity gets updatedAt (its createdAt, or `now` when it has none), the
// tombstone log starts empty and the installation gets its device id. Idempotent: values
// that already exist are kept.
export function migrateV3toV4(persisted: unknown, ctx: MigrationContext): FinanceState {
  const s = (persisted ?? {}) as Partial<FinanceStateV3>;
  const synced = <T extends { updatedAt?: string; createdAt?: string }>(value: T[] | undefined) =>
    (Array.isArray(value) ? value : []).map((e) => ({ ...e, updatedAt: e.updatedAt ?? e.createdAt ?? ctx.now }));
  const settings = migrateV2toV3(s).settings;
  return {
    accounts: synced(s.accounts) as Account[],
    categories: synced(s.categories) as Category[],
    transactions: synced(s.transactions) as Transaction[],
    funds: synced(s.funds) as Fund[],
    fundMovements: synced(s.fundMovements) as FundMovement[],
    holdings: synced(s.holdings) as Holding[],
    liabilities: synced(s.liabilities) as Liability[],
    recurringRules: synced(s.recurringRules) as RecurringRule[],
    monthlyPlans: synced(s.monthlyPlans) as MonthlyPlan[],
    settings: { ...settings, deviceId: settings.deviceId || ctx.newId() },
    tombstones: Array.isArray(s.tombstones) ? s.tombstones : [],
  };
}

// Entry point used by zustand persist and backup restore: upgrades any older payload step by step.
export function migratePersistedState(
  persisted: unknown,
  version: number,
  ctx: MigrationContext
): MigrationResult {
  let state = persisted;
  let clampedBy = 0;
  if (version < 1) state = migrateV0toV1(state);
  if (version < 2) ({ state, clampedBy } = migrateV1toV2(state, ctx));
  if (version < 3) state = migrateV2toV3(state);
  if (version < 4) state = migrateV3toV4(state, ctx);
  return { state: state as FinanceState, clampedBy };
}
