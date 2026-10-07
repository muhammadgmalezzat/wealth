// Data model V2. Monetary amounts are stored in the entity's own currency unless the
// field name says EGP. Dates are local calendar dates ('YYYY-MM-DD'); createdAt is an ISO timestamp.
// Deliberately no interest/APR fields anywhere.

export type CurrencyCode = 'EGP' | 'SAR' | 'USD';

// Every synced entity carries the time it was last created or changed (ISO), so a future
// server sync can resolve conflicts. Store operations set it; never edit it by hand.
interface Synced {
  updatedAt: string;
}

// Country the money or asset physically sits in.
export type Location = 'EG' | 'SA';

export type Bucket = 'essentials' | 'lifestyle' | 'giving' | 'income';
export type ExpenseBucket = Exclude<Bucket, 'income'>;

export interface Account extends Synced {
  id: string;
  name: string;
  type: 'cash' | 'bank' | 'wallet';
  currency: CurrencyCode;
  // Balance is derived (see accountBalance selector), never stored.
  openingBalance: number;
  // The date openingBalance refers to.
  openingDate?: string;
  location: Location;
  createdAt: string;
  archived?: boolean;
}

export interface Category extends Synced {
  id: string;
  name: string;
  kind: 'income' | 'expense';
  bucket: Bucket;
  isDefault: boolean;
  // Hidden from pickers but kept for history and reports. Missing = false (no migration needed).
  archived?: boolean;
}

interface TransactionBase extends Synced {
  id: string;
  amount: number;
  date: string;
  note?: string;
  // Exchange rate of the transaction's currency to EGP, snapshotted at creation.
  rateToEGP: number;
  createdAt: string;
  // Set when the transaction records an occurrence of a recurring rule: the rule and the
  // scheduled date it fulfils (the transaction's own `date` may differ).
  recurringRuleId?: string;
  occurrenceDate?: string;
}

export interface IncomeExpenseTransaction extends TransactionBase {
  type: 'income' | 'expense';
  // Always equals the account's currency.
  currency: CurrencyCode;
  accountId: string;
  categoryId: string;
  liabilityId?: string;
  // A one-off expense (e.g. furnishing): excluded from monthly averages.
  oneTime?: boolean;
}

export interface TransferTransaction extends TransactionBase {
  type: 'transfer';
  fromAccountId: string;
  toAccountId: string;
  // `amount` leaves the source account (its currency); `toAmount` arrives in the target
  // account's currency, so SAR→EGP transfers record the real converted amount.
  toAmount: number;
}

// Cash turned into a holding (e.g. buying gold). Lowers the account balance but is not an
// expense: it is excluded from spending, savings rate and averages.
export interface AssetPurchaseTransaction extends TransactionBase {
  type: 'asset_purchase';
  accountId: string;
  // Always equals the account's currency.
  currency: CurrencyCode;
  holdingId: string;
}

export type Transaction = IncomeExpenseTransaction | TransferTransaction | AssetPurchaseTransaction;

export type SinkingFrequency = 'yearly' | 'semiannual' | 'quarterly';

export interface Fund extends Synced {
  id: string;
  name: string;
  type: 'emergency' | 'goal' | 'sinking';
  // For sinking funds: the amount due each cycle.
  targetAmount: number;
  currency: CurrencyCode;
  // Goals only; sinking funds are due on nextDueDate instead.
  deadline?: string;
  // Lower number = higher priority.
  priority: number;
  monthlyContribution?: number;
  linkedHoldingIds: string[];
  createdAt: string;
  archived?: boolean;
  // Sinking funds only. Optional so funds saved before these fields existed stay valid.
  frequency?: SinkingFrequency;
  nextDueDate?: string;
}

export interface FundMovement extends Synced {
  id: string;
  fundId: string;
  // In the fund's currency: positive = allocate, negative = withdraw.
  amount: number;
  date: string;
  note?: string;
}

export type GoldKarat = 18 | 21 | 24;

export interface GoldHolding extends Synced {
  id: string;
  type: 'gold';
  name: string;
  weightGrams: number;
  karat: GoldKarat;
  purchaseCostEGP: number;
  purchaseDate?: string;
  location?: Location; // treated as 'EG' when missing
  note?: string;
}

export interface CurrencyHolding extends Synced {
  id: string;
  type: 'currency';
  name: string;
  currency: CurrencyCode;
  quantity: number;
  purchaseCostEGP: number;
  purchaseDate?: string;
  location?: Location; // treated as 'EG' when missing
  note?: string;
}

export type Holding = GoldHolding | CurrencyHolding;

export interface Liability extends Synced {
  id: string;
  name: string;
  principal: number;
  currency: CurrencyCode;
  monthlyPayment?: number;
  startDate: string;
  notes?: string;
}

export type RecurringKind = 'income' | 'expense' | 'transfer';
export type RecurringFrequency = 'weekly' | 'monthly' | 'yearly';

// A scheduled income, expense or transfer. Occurrences are computed from startDate,
// frequency × interval and dayOfMonth (store/recurring.ts); the ones on or before today that
// have no transaction (matched by recurringRuleId + occurrenceDate) and aren't skipped are
// "due". 'auto' rules record them automatically; 'confirm' rules wait in the due inbox.
export interface RecurringRule extends Synced {
  id: string;
  name: string;
  kind: RecurringKind;
  // In `currency`, which is the (source) account's currency.
  amount: number;
  currency: CurrencyCode;
  accountId: string;
  categoryId?: string; // income/expense
  toAccountId?: string; // transfer
  toAmount?: number; // transfer, in the target account's currency
  frequency: RecurringFrequency;
  // Every N weeks/months/years (≥ 1).
  interval: number;
  // Monthly/yearly: day of month (1–31), clamped to the month's last day. Defaults to
  // startDate's day.
  dayOfMonth?: number;
  startDate: string;
  endDate?: string; // inclusive
  // Cached next upcoming occurrence on or after today that isn't handled yet ('' once the
  // rule has ended). Recomputed by operations; for display and notifications.
  nextDate: string;
  mode: 'auto' | 'confirm';
  // The amount varies (e.g. electricity): it's a suggestion when confirming.
  variableAmount: boolean;
  active: boolean;
  skippedDates: string[];
  note?: string;
  createdAt: string;
}

// A budget line for one expense category. Bucket totals are derived from the lines'
// categories, never stored. 'fixed' lines (rent, internet…) don't count as safe to spend.
export type PlanLineKind = 'fixed' | 'flexible';

export interface PlanLine {
  categoryId: string;
  limit: number; // plan currency
  kind: PlanLineKind;
}

export interface PlannedContribution {
  fundId: string;
  amount: number; // plan currency
}

// Zero-based monthly plan: every unit of expected income gets a job (a line or a fund).
// One plan per month; its id is derived from the month (plan-YYYY-MM) so two devices
// planning the same month can never create duplicates.
export interface MonthlyPlan extends Synced {
  id: string;
  month: string; // 'YYYY-MM'
  currency: CurrencyCode;
  expectedIncome: number;
  lines: PlanLine[];
  fundContributions: PlannedContribution[];
  createdAt: string;
}

// Net worth at the end of a month (EGP, at the rates/prices of `takenAt`). The current month's
// snapshot is upserted while the app runs, so after the month ends it holds the month's last
// value. Months filled in afterwards (migration, months the app wasn't opened) are `estimated`:
// recomputed from what existed at the month's end, valued at the rates/prices of `takenAt`
// (there is no price history).
// One per month; the id derives from the month (nw-YYYY-MM).
export interface NetWorthSnapshot extends Synced {
  id: string;
  month: string; // 'YYYY-MM'
  netWorthEGP: number;
  liquidEGP: number;
  holdingsEGP: number;
  takenAt: string;
  estimated?: boolean;
}

// A Next Best Action snoozed until `until` (ISO). One per action id (the record's id is the
// action id).
export interface ActionDismissal extends Synced {
  id: string;
  actionId: string;
  until: string;
}

// A month whose review was finished. One per month; the id derives from the month (review-YYYY-MM).
export interface MonthlyReview extends Synced {
  id: string;
  month: string; // 'YYYY-MM'
  completedAt: string;
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
  // Market price of 21k, stored separately (it isn't exactly 24k × 21/24). 18k derives from 24k.
  goldPrice21kEGP: number;
  goldPriceUpdatedAt: string;
  // Cash-flow reporting (monthSummary) ignores transactions before this date.
  trackingStartDate: string;
  // Identifies this installation in backups and (later) sync. Created once.
  deviceId: string;
  lastBackupAt?: string;
  // Require biometrics / device PIN to open the app.
  appLockEnabled?: boolean;
  // Local reminder at 10:00 on due dates of 'confirm' recurring rules. Off by default.
  dueNotificationsEnabled?: boolean;
  // Optional, so v2 data without it stays valid (no migration needed).
  lastUsed?: LastUsedSelection;
}

export type SyncEntity =
  | 'account'
  | 'category'
  | 'transaction'
  | 'fund'
  | 'fundMovement'
  | 'holding'
  | 'liability'
  | 'recurringRule'
  | 'monthlyPlan'
  | 'netWorthSnapshot'
  | 'actionDismissal'
  | 'monthlyReview';

// Log of deletions for a future server sync. Deleted data is really removed from its
// collection; selectors never look at tombstones.
export interface Tombstone {
  entity: SyncEntity;
  id: string;
  deletedAt: string;
}

export interface FinanceState {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  funds: Fund[];
  fundMovements: FundMovement[];
  holdings: Holding[];
  liabilities: Liability[];
  recurringRules: RecurringRule[];
  monthlyPlans: MonthlyPlan[];
  netWorthSnapshots: NetWorthSnapshot[];
  actionDismissals: ActionDismissal[];
  monthlyReviews: MonthlyReview[];
  settings: Settings;
  tombstones: Tombstone[];
}
