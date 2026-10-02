// Data model V2. Monetary amounts are stored in the entity's own currency unless the
// field name says EGP. Dates are local calendar dates ('YYYY-MM-DD'); createdAt is an ISO timestamp.
// Deliberately no interest/APR fields anywhere.

export type CurrencyCode = 'EGP' | 'SAR' | 'USD';

export type Bucket = 'essentials' | 'lifestyle' | 'giving' | 'income';
export type ExpenseBucket = Exclude<Bucket, 'income'>;

export interface Account {
  id: string;
  name: string;
  type: 'cash' | 'bank' | 'wallet';
  currency: CurrencyCode;
  // Balance is derived (see accountBalance selector), never stored.
  openingBalance: number;
  createdAt: string;
  archived?: boolean;
}

export interface Category {
  id: string;
  name: string;
  kind: 'income' | 'expense';
  bucket: Bucket;
  isDefault: boolean;
}

interface TransactionBase {
  id: string;
  amount: number;
  date: string;
  note?: string;
  // Exchange rate of the transaction's currency to EGP, snapshotted at creation.
  rateToEGP: number;
  createdAt: string;
}

export interface IncomeExpenseTransaction extends TransactionBase {
  type: 'income' | 'expense';
  // Always equals the account's currency.
  currency: CurrencyCode;
  accountId: string;
  categoryId: string;
  recurringRuleId?: string;
  liabilityId?: string;
}

export interface TransferTransaction extends TransactionBase {
  type: 'transfer';
  fromAccountId: string;
  toAccountId: string;
  // `amount` leaves the source account (its currency); `toAmount` arrives in the target
  // account's currency, so SAR→EGP transfers record the real converted amount.
  toAmount: number;
}

export type Transaction = IncomeExpenseTransaction | TransferTransaction;

export interface Fund {
  id: string;
  name: string;
  type: 'emergency' | 'goal' | 'sinking';
  targetAmount: number;
  currency: CurrencyCode;
  deadline?: string;
  priority: number;
  monthlyContribution?: number;
  linkedHoldingIds: string[];
  createdAt: string;
  archived?: boolean;
}

export interface FundMovement {
  id: string;
  fundId: string;
  // In the fund's currency: positive = allocate, negative = withdraw.
  amount: number;
  date: string;
  note?: string;
}

export type GoldKarat = 18 | 21 | 24;

export interface GoldHolding {
  id: string;
  type: 'gold';
  name: string;
  weightGrams: number;
  karat: GoldKarat;
  purchaseCostEGP: number;
  purchaseDate?: string;
}

export interface CurrencyHolding {
  id: string;
  type: 'currency';
  name: string;
  currency: CurrencyCode;
  quantity: number;
  purchaseCostEGP: number;
  purchaseDate?: string;
}

export type Holding = GoldHolding | CurrencyHolding;

export interface Liability {
  id: string;
  name: string;
  principal: number;
  currency: CurrencyCode;
  monthlyPayment?: number;
  startDate: string;
  notes?: string;
}

export interface RecurringRule {
  id: string;
  name: string;
  type: 'income' | 'expense';
  amount: number;
  currency: CurrencyCode;
  accountId: string;
  categoryId: string;
  frequency: 'weekly' | 'monthly' | 'yearly';
  nextDate: string;
  active: boolean;
}

export interface MonthlyPlan {
  month: string; // 'YYYY-MM'
  expectedIncomeEGP: number;
  bucketLimitsEGP: Partial<Record<Bucket, number>>;
}

export interface ExchangeRates {
  SAR_EGP: number;
  USD_EGP: number;
  lastUpdated: string;
}

// Defaults for the next transaction form, remembered per type. Ids may point at entities
// that were deleted since, so readers must check they still exist.
export interface LastUsedSelection {
  expense?: { accountId: string; categoryId: string };
  income?: { accountId: string; categoryId: string };
  transfer?: { fromAccountId: string; toAccountId: string };
}

export interface Settings {
  exchangeRates: ExchangeRates;
  goldPrice24kEGP: number;
  goldPriceUpdatedAt: string;
  // Optional, so v2 data without it stays valid (no migration needed).
  lastUsed?: LastUsedSelection;
}

export interface FinanceStateV2 {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  funds: Fund[];
  fundMovements: FundMovement[];
  holdings: Holding[];
  liabilities: Liability[];
  recurringRules: RecurringRule[];
  monthlyPlans: MonthlyPlan[];
  settings: Settings;
}
