import { fromEGP, rateToEGP, toEGP } from '@/utils/currency';
import { addMonthsToDate, isDateKey, isMonthKey, shiftDate, toDateKey } from '@/utils/dates';
import { planIdFor } from './migrations';
import { NON_DISMISSIBLE_ACTION_IDS, SNOOZE_MS } from './nextActions';
import { dueOccurrences, isOccurrence, nextOccurrence, recordedOccurrences } from './recurring';
import { syncedSnapshots } from './snapshots';
import {
  FinanceValidationError,
  type FinanceEntity,
  type FinanceErrorCode,
  type FinanceErrorDetails,
  type FinanceField,
} from './errors';
import {
  fundAllocated,
  fundAmountsEGP,
  SINKING_CYCLE_MONTHS,
  unassignedEGP,
  unassignedEGPWithFundCash,
  type FundAmount,
} from './selectors';
import type {
  Account,
  ActionDismissal,
  AssetPurchaseTransaction,
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
  LastUsedSelection,
  Liability,
  Location,
  MonthlyPlan,
  MonthlyReview,
  PlanLine,
  RecurringRule,
  Settings,
  SinkingFrequency,
  SyncEntity,
  Tombstone,
  Transaction,
  TransferTransaction,
} from './types';

// Pure, validated state transitions. Each returns a patch to merge into the state, or throws
// FinanceValidationError with a typed code. The Zustand store wraps these; tests call them directly.
// Sync bookkeeping: every created or changed entity gets updatedAt = now, and every removed
// entity (including cascades) is logged as a tombstone.

export { FinanceValidationError };

export interface OpContext {
  newId: () => string;
  now: () => Date;
}

type State = FinanceState;
type Patch = Partial<FinanceState>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
// Update inputs: updatedAt is optional because the operation always sets it.
export type Editable<T> = T extends unknown ? Omit<T, 'updatedAt'> & { updatedAt?: string } : never;

export type NewAccount = Omit<Account, 'id' | 'createdAt' | 'updatedAt'>;
export type NewCategory = Omit<Category, 'id' | 'isDefault' | 'updatedAt'>;
export type NewIncomeExpense = Omit<IncomeExpenseTransaction, 'id' | 'createdAt' | 'updatedAt' | 'rateToEGP'> & {
  rateToEGP?: number;
};
export type NewTransfer = Omit<
  TransferTransaction,
  'id' | 'type' | 'createdAt' | 'updatedAt' | 'rateToEGP' | 'toAmount'
> & {
  // Defaults to `amount` converted at current rates.
  toAmount?: number;
  rateToEGP?: number;
};
export type NewFund = Omit<Fund, 'id' | 'createdAt' | 'updatedAt' | 'linkedHoldingIds'> & {
  linkedHoldingIds?: string[];
};
export type NewHolding = DistributiveOmit<Holding, 'id' | 'updatedAt'>;
export type NewLiability = Omit<Liability, 'id' | 'updatedAt'>;
export type NewRecurringRule = Omit<RecurringRule, 'id' | 'updatedAt' | 'createdAt' | 'nextDate' | 'skippedDates'> & {
  skippedDates?: string[];
};

export interface FundEdit {
  name: string;
  targetAmount: number;
  // Optional fields keep the fund's current value when omitted…
  type?: Fund['type'];
  priority?: number;
  frequency?: SinkingFrequency;
  nextDueDate?: string;
  linkedHoldingIds?: string[];
  // …except the deadline: omitting it clears it.
  deadline?: string;
  // Desired total cash allocated to the fund (fund currency).
  cashAllocation: number;
}

// --- Validation helpers -----------------------------------------------------

function fail(code: FinanceErrorCode, details?: FinanceErrorDetails): never {
  throw new FinanceValidationError(code, details);
}

function assertName(name: string, entity: FinanceEntity) {
  if (!name?.trim()) fail('NAME_REQUIRED', { entity });
}

function assertNumber(value: number, field: FinanceField) {
  if (!Number.isFinite(value)) fail('NOT_A_NUMBER', { field });
}

function assertPositive(value: number, field: FinanceField) {
  assertNumber(value, field);
  if (value <= 0) fail('NOT_POSITIVE', { field });
}

function assertNonNegative(value: number, field: FinanceField) {
  assertNumber(value, field);
  if (value < 0) fail('NEGATIVE', { field });
}

function assertDate(value: string, field: FinanceField) {
  if (!isDateKey(value)) fail('INVALID_DATE', { field });
}

function requireById<T extends { id: string }>(list: T[], id: string, entity: FinanceEntity): T {
  return list.find((item) => item.id === id) ?? fail('NOT_FOUND', { entity, id });
}

function replaceById<T extends { id: string }>(list: T[], item: T, entity: FinanceEntity): T[] {
  requireById(list, item.id, entity);
  return list.map((existing) => (existing.id === item.id ? item : existing));
}

const isIncomeExpense = (tx: Transaction): tx is IncomeExpenseTransaction =>
  tx.type === 'income' || tx.type === 'expense';

// --- Sync bookkeeping -------------------------------------------------------

function stamp<T extends object>(entity: T, ctx: OpContext): T & { updatedAt: string } {
  return { ...entity, updatedAt: ctx.now().toISOString() };
}

function tombstone(entity: SyncEntity, id: string, ctx: OpContext): Tombstone {
  return { entity, id, deletedAt: ctx.now().toISOString() };
}

// state.tombstones plus one entry per removed id.
function logDeletes(state: State, entity: SyncEntity, ids: string[], ctx: OpContext): Tombstone[] {
  return [...state.tombstones, ...ids.map((id) => tombstone(entity, id, ctx))];
}

// --- Accounts ---------------------------------------------------------------

function accountInUse(state: State, accountId: string): boolean {
  return (
    state.transactions.some((tx) =>
      tx.type === 'transfer'
        ? tx.fromAccountId === accountId || tx.toAccountId === accountId
        : tx.accountId === accountId
    ) || state.recurringRules.some((r) => r.accountId === accountId)
  );
}

function validateAccount(account: NewAccount) {
  assertName(account.name, 'account');
  assertNumber(account.openingBalance, 'openingBalance');
}

export function addAccount(state: State, input: NewAccount, ctx: OpContext): Patch {
  validateAccount(input);
  const account: Account = stamp({ ...input, id: ctx.newId(), createdAt: ctx.now().toISOString() }, ctx);
  return { accounts: [...state.accounts, account] };
}

export function updateAccount(state: State, account: Editable<Account>, ctx: OpContext): Patch {
  validateAccount(account);
  const existing = requireById(state.accounts, account.id, 'account');
  if (existing.currency !== account.currency && accountInUse(state, account.id)) {
    fail('ACCOUNT_CURRENCY_LOCKED', { id: account.id });
  }
  return { accounts: replaceById(state.accounts, stamp(account, ctx), 'account') };
}

export function deleteAccount(state: State, id: string, ctx: OpContext): Patch {
  requireById(state.accounts, id, 'account');
  if (accountInUse(state, id)) fail('ACCOUNT_IN_USE', { id });
  return {
    accounts: state.accounts.filter((a) => a.id !== id),
    tombstones: logDeletes(state, 'account', [id], ctx),
  };
}

// --- Categories -------------------------------------------------------------

const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

// Name (trimmed) required and unique among active categories; income kind ⇔ income bucket.
function validateCategory(state: State, category: NewCategory, selfId?: string) {
  assertName(category.name, 'category');
  if ((category.kind === 'income') !== (category.bucket === 'income')) {
    fail('CATEGORY_BUCKET_MISMATCH');
  }
  if (!category.archived && state.categories.some((c) => c.id !== selfId && !c.archived && sameName(c.name, category.name))) {
    fail('CATEGORY_NAME_TAKEN');
  }
}

// Whether transactions, recurring rules or plan lines reference the category (then it can only
// be archived, not deleted).
export function categoryInUse(state: Pick<State, 'transactions' | 'recurringRules' | 'monthlyPlans'>, id: string): boolean {
  return (
    state.transactions.some((tx) => isIncomeExpense(tx) && tx.categoryId === id) ||
    state.recurringRules.some((r) => r.categoryId === id) ||
    state.monthlyPlans.some((p) => p.lines.some((l) => l.categoryId === id))
  );
}

function newCategory(state: State, input: NewCategory, ctx: OpContext): Category {
  const normalized = { ...input, name: input.name?.trim() ?? '' };
  validateCategory(state, normalized);
  return stamp({ ...normalized, id: ctx.newId(), isDefault: false }, ctx);
}

export function addCategory(state: State, input: NewCategory, ctx: OpContext): Patch {
  return { categories: [...state.categories, newCategory(state, input, ctx)] };
}

// Rename / move to another bucket. The kind (expense vs income) and isDefault never change.
export function updateCategory(state: State, category: Editable<Category>, ctx: OpContext): Patch {
  const existing = requireById(state.categories, category.id, 'category');
  if (category.kind !== existing.kind) fail('CATEGORY_KIND_LOCKED', { id: existing.id });
  const updated = { ...category, name: category.name?.trim() ?? '', isDefault: existing.isDefault };
  validateCategory(state, updated, existing.id);
  return { categories: replaceById(state.categories, stamp(updated, ctx), 'category') };
}

// Archive (hide from pickers, keep history) or bring back. Restoring re-checks name uniqueness.
export function archiveCategory(state: State, id: string, archived: boolean, ctx: OpContext): Patch {
  const existing = requireById(state.categories, id, 'category');
  const updated = { ...existing, archived };
  if (!archived) validateCategory(state, updated, id);
  return { categories: replaceById(state.categories, stamp(updated, ctx), 'category') };
}

// Real delete: only custom categories nothing refers to.
export function deleteCategory(state: State, id: string, ctx: OpContext): Patch {
  const existing = requireById(state.categories, id, 'category');
  if (existing.isDefault) fail('DEFAULT_CATEGORY_DELETE', { id });
  if (categoryInUse(state, id)) fail('CATEGORY_IN_USE', { id });
  return {
    categories: state.categories.filter((c) => c.id !== id),
    tombstones: logDeletes(state, 'category', [id], ctx),
  };
}

// --- Transactions -----------------------------------------------------------

function validateIncomeExpense(state: State, tx: IncomeExpenseTransaction) {
  assertPositive(tx.amount, 'amount');
  assertPositive(tx.rateToEGP, 'rateToEGP');
  assertDate(tx.date, 'date');
  const account = requireById(state.accounts, tx.accountId, 'account');
  if (tx.currency !== account.currency) fail('CURRENCY_MISMATCH', { entity: 'account' });
  const category = requireById(state.categories, tx.categoryId, 'category');
  if (category.kind !== tx.type) fail('CATEGORY_KIND_MISMATCH', { id: category.id });
  if (tx.recurringRuleId) requireById(state.recurringRules, tx.recurringRuleId, 'recurringRule');
  if (tx.liabilityId) {
    if (tx.type !== 'expense') fail('LIABILITY_PAYMENT_NOT_EXPENSE');
    const liability = requireById(state.liabilities, tx.liabilityId, 'liability');
    if (liability.currency !== tx.currency) fail('CURRENCY_MISMATCH', { entity: 'liability' });
  }
}

function validateTransfer(state: State, tx: TransferTransaction) {
  assertPositive(tx.amount, 'amount');
  assertPositive(tx.toAmount, 'toAmount');
  assertPositive(tx.rateToEGP, 'rateToEGP');
  assertDate(tx.date, 'date');
  requireById(state.accounts, tx.fromAccountId, 'account');
  requireById(state.accounts, tx.toAccountId, 'account');
  if (tx.fromAccountId === tx.toAccountId) fail('SAME_ACCOUNT_TRANSFER');
}

// Settings with `selection` merged into the remembered form defaults.
function rememberSelection(state: State, selection: LastUsedSelection): Settings {
  return { ...state.settings, lastUsed: { ...state.settings.lastUsed, ...selection } };
}

export function addTransaction(state: State, input: NewIncomeExpense, ctx: OpContext): Patch {
  const tx: IncomeExpenseTransaction = stamp(
    {
      ...input,
      id: ctx.newId(),
      createdAt: ctx.now().toISOString(),
      rateToEGP: input.rateToEGP ?? rateToEGP(input.currency, state.settings.exchangeRates),
    },
    ctx
  );
  validateIncomeExpense(state, tx);
  return {
    transactions: [tx, ...state.transactions],
    settings: rememberSelection(state, {
      [tx.type]: { accountId: tx.accountId, categoryId: tx.categoryId },
    }),
  };
}

export function addTransfer(state: State, input: NewTransfer, ctx: OpContext): Patch {
  const rates = state.settings.exchangeRates;
  const from = requireById(state.accounts, input.fromAccountId, 'account');
  const to = requireById(state.accounts, input.toAccountId, 'account');
  const tx: TransferTransaction = stamp(
    {
      ...input,
      type: 'transfer' as const,
      id: ctx.newId(),
      createdAt: ctx.now().toISOString(),
      toAmount:
        input.toAmount ?? fromEGP(toEGP(input.amount, from.currency, rates), to.currency, rates),
      rateToEGP: input.rateToEGP ?? rateToEGP(from.currency, rates),
    },
    ctx
  );
  validateTransfer(state, tx);
  return {
    transactions: [tx, ...state.transactions],
    settings: rememberSelection(state, {
      transfer: { fromAccountId: tx.fromAccountId, toAccountId: tx.toAccountId },
    }),
  };
}

// Currency that rateToEGP refers to: the transaction's own, or the source account's for transfers.
function transactionCurrency(state: State, tx: Editable<Transaction>): CurrencyCode | undefined {
  if (tx.type !== 'transfer') return tx.currency;
  return state.accounts.find((a) => a.id === tx.fromAccountId)?.currency;
}

function validateAssetPurchase(state: State, tx: AssetPurchaseTransaction) {
  assertPositive(tx.amount, 'amount');
  assertPositive(tx.rateToEGP, 'rateToEGP');
  assertDate(tx.date, 'date');
  const account = requireById(state.accounts, tx.accountId, 'account');
  if (tx.currency !== account.currency) fail('CURRENCY_MISMATCH', { entity: 'account' });
  requireById(state.holdings, tx.holdingId, 'holding');
}

function validateTransaction(state: State, tx: Transaction) {
  if (tx.type === 'transfer') validateTransfer(state, tx);
  else if (tx.type === 'asset_purchase') validateAssetPurchase(state, tx);
  else validateIncomeExpense(state, tx);
}

// The holding's cost basis always mirrors its purchase: amount × the snapshotted rate.
function syncPurchaseCost(holdings: Holding[], tx: AssetPurchaseTransaction, ctx: OpContext): Holding[] {
  return holdings.map((h) =>
    h.id === tx.holdingId ? stamp({ ...h, purchaseCostEGP: tx.amount * tx.rateToEGP }, ctx) : h
  );
}

// Replaces a transaction. Income/expense/transfer may change into each other, but a gold
// purchase stays a gold purchase (it owns a holding). createdAt and the snapshotted rateToEGP
// are kept from the original; the rate is re-snapshotted only when the currency changes,
// e.g. when the transaction moves to an account in another currency.
export function updateTransaction(state: State, tx: Editable<Transaction>, ctx: OpContext): Patch {
  const existing = requireById(state.transactions, tx.id, 'transaction');
  if ((existing.type === 'asset_purchase') !== (tx.type === 'asset_purchase')) {
    fail('ASSET_PURCHASE_TYPE_LOCKED', { id: tx.id });
  }
  const currency = transactionCurrency(state, tx);
  const sameCurrency = currency === transactionCurrency(state, existing);
  const updated = stamp(
    {
      ...tx,
      createdAt: existing.createdAt,
      rateToEGP:
        sameCurrency || !currency
          ? existing.rateToEGP
          : rateToEGP(currency, state.settings.exchangeRates),
    },
    ctx
  ) as Transaction;
  validateTransaction(state, updated);
  return {
    transactions: replaceById(state.transactions, updated, 'transaction'),
    ...(updated.type === 'asset_purchase'
      ? { holdings: syncPurchaseCost(state.holdings, updated, ctx) }
      : {}),
  };
}

// Deleting a gold purchase also deletes its holding (and unlinks it from funds), atomically:
// otherwise the money would be counted twice, as cash and as gold.
export function deleteTransaction(state: State, id: string, ctx: OpContext): Patch {
  const tx = requireById(state.transactions, id, 'transaction');
  const transactions = state.transactions.filter((t) => t.id !== id);
  if (tx.type !== 'asset_purchase') {
    return { transactions, tombstones: logDeletes(state, 'transaction', [id], ctx) };
  }
  const removed = removeHolding(state, tx.holdingId, ctx);
  return { transactions, ...removed, tombstones: [...removed.tombstones, tombstone('transaction', id, ctx)] };
}

export interface GoldPurchase {
  accountId: string;
  // Paid, in the account's currency.
  amount: number;
  date: string;
  note?: string;
  holding: {
    name: string;
    weightGrams: number;
    karat: GoldKarat;
    location?: Location;
    // Defaults to `date`.
    purchaseDate?: string;
    note?: string;
  };
}

function goldHoldingFor(
  input: GoldPurchase,
  id: string,
  purchaseCostEGP: number,
  ctx: OpContext
): GoldHolding {
  const { holding } = input;
  return {
    updatedAt: ctx.now().toISOString(),
    id,
    type: 'gold',
    name: holding.name.trim(),
    weightGrams: holding.weightGrams,
    karat: holding.karat,
    purchaseCostEGP,
    purchaseDate: holding.purchaseDate ?? input.date,
    ...(holding.location ? { location: holding.location } : {}),
    ...(holding.note?.trim() ? { note: holding.note.trim() } : {}),
  };
}

// Buys gold with cash in one atomic step: a gold holding whose cost is what was paid
// (amount × rateToEGP) and an asset_purchase transaction that takes it out of the account.
// At cost, net worth is unchanged: cash goes down by exactly what the gold goes up.
export function buyGold(state: State, input: GoldPurchase, ctx: OpContext): Patch {
  const account = requireById(state.accounts, input.accountId, 'account');
  assertPositive(input.amount, 'amount');
  const rate = rateToEGP(account.currency, state.settings.exchangeRates);
  const holding = goldHoldingFor(input, ctx.newId(), input.amount * rate, ctx);
  validateHolding(holding);

  const tx: AssetPurchaseTransaction = {
    updatedAt: ctx.now().toISOString(),
    id: ctx.newId(),
    type: 'asset_purchase',
    accountId: account.id,
    amount: input.amount,
    currency: account.currency,
    holdingId: holding.id,
    date: input.date,
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    rateToEGP: rate,
    createdAt: ctx.now().toISOString(),
  };
  const holdings = [...state.holdings, holding];
  validateAssetPurchase({ ...state, holdings }, tx);
  return { holdings, transactions: [tx, ...state.transactions] };
}

// Edits a gold purchase and its holding together. The rate snapshot is kept unless the
// paying account's currency changes; the holding's cost follows the (new) amount.
export function updateGoldPurchase(state: State, txId: string, input: GoldPurchase, ctx: OpContext): Patch {
  const existing = requireById(state.transactions, txId, 'transaction');
  if (existing.type !== 'asset_purchase') fail('ASSET_PURCHASE_TYPE_LOCKED', { id: txId });
  const previousHolding = requireById(state.holdings, existing.holdingId, 'holding');
  const account = requireById(state.accounts, input.accountId, 'account');
  assertPositive(input.amount, 'amount');
  const rate =
    account.currency === existing.currency
      ? existing.rateToEGP
      : rateToEGP(account.currency, state.settings.exchangeRates);
  const holding: GoldHolding = {
    ...goldHoldingFor(input, previousHolding.id, input.amount * rate, ctx),
  };
  validateHolding(holding);

  const { note: _previousNote, ...rest } = existing;
  const tx: AssetPurchaseTransaction = {
    ...rest,
    accountId: account.id,
    amount: input.amount,
    currency: account.currency,
    date: input.date,
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    rateToEGP: rate,
    updatedAt: ctx.now().toISOString(),
  };
  const holdings = replaceById(state.holdings, holding, 'holding');
  validateAssetPurchase({ ...state, holdings }, tx);
  return { holdings, transactions: replaceById(state.transactions, tx, 'transaction') };
}

// --- Funds & movements ------------------------------------------------------

const SINKING_FREQUENCIES: SinkingFrequency[] = ['yearly', 'semiannual', 'quarterly'];

// Drops fields that don't apply to the fund's type: the schedule belongs to sinking funds,
// the deadline to the others (a sinking fund is due on nextDueDate).
function normalizeFundShape<T extends NewFund>(fund: T): T {
  const { deadline, frequency, nextDueDate, ...rest } = fund;
  return (
    fund.type === 'sinking'
      ? { ...rest, ...(frequency ? { frequency } : {}), ...(nextDueDate ? { nextDueDate } : {}) }
      : { ...rest, ...(deadline ? { deadline } : {}) }
  ) as T;
}

// `fundId` is the fund being validated (undefined when adding), so it may keep its own links.
function validateFund(state: State, fund: NewFund, fundId?: string) {
  assertName(fund.name, 'fund');
  assertPositive(fund.targetAmount, 'targetAmount');
  assertNumber(fund.priority, 'priority');
  if (fund.monthlyContribution !== undefined) {
    assertNonNegative(fund.monthlyContribution, 'monthlyContribution');
  }
  if (fund.deadline !== undefined) assertDate(fund.deadline, 'deadline');
  if (fund.type === 'sinking') {
    if (!fund.frequency || !SINKING_FREQUENCIES.includes(fund.frequency) || !fund.nextDueDate) {
      fail('SINKING_SCHEDULE_REQUIRED');
    }
    assertDate(fund.nextDueDate, 'deadline');
  }

  // A holding backs at most one fund, otherwise its value would be counted twice.
  const linked = fund.linkedHoldingIds ?? [];
  for (const holdingId of linked) {
    requireById(state.holdings, holdingId, 'holding');
    const linkedElsewhere = state.funds.some(
      (f) => f.id !== fundId && f.linkedHoldingIds.includes(holdingId)
    );
    if (linkedElsewhere) fail('HOLDING_ALREADY_LINKED', { id: holdingId });
  }
  if (new Set(linked).size !== linked.length) fail('HOLDING_ALREADY_LINKED');
}

export function addFund(state: State, input: NewFund, ctx: OpContext): Patch {
  const normalized = normalizeFundShape(input);
  validateFund(state, normalized);
  const fund: Fund = stamp(
    {
      ...normalized,
      linkedHoldingIds: normalized.linkedHoldingIds ?? [],
      id: ctx.newId(),
      createdAt: ctx.now().toISOString(),
    },
    ctx
  );
  return { funds: [...state.funds, fund] };
}

export function updateFund(state: State, fund: Editable<Fund>, ctx: OpContext): Patch {
  const normalized = normalizeFundShape(stamp(fund, ctx) as Fund);
  validateFund(state, normalized, fund.id);
  return { funds: replaceById(state.funds, normalized, 'fund') };
}

// Deleting a fund releases its allocations back to unassigned money.
export function deleteFund(state: State, id: string, ctx: OpContext): Patch {
  requireById(state.funds, id, 'fund');
  const movementIds = state.fundMovements.filter((m) => m.fundId === id).map((m) => m.id);
  return {
    funds: state.funds.filter((f) => f.id !== id),
    fundMovements: state.fundMovements.filter((m) => m.fundId !== id),
    monthlyPlans: state.monthlyPlans.map((p) =>
      p.fundContributions.some((c) => c.fundId === id)
        ? stamp({ ...p, fundContributions: p.fundContributions.filter((c) => c.fundId !== id) }, ctx)
        : p
    ),
    tombstones: [
      ...logDeletes(state, 'fund', [id], ctx),
      ...movementIds.map((movementId) => tombstone('fundMovement', movementId, ctx)),
    ],
  };
}

function newMovement(fundId: string, amount: number, note: string | undefined, ctx: OpContext): FundMovement {
  return {
    updatedAt: ctx.now().toISOString(),
    id: ctx.newId(),
    fundId,
    amount,
    date: toDateKey(ctx.now()),
    ...(note ? { note } : {}),
  };
}

export function allocateToFund(
  state: State,
  fundId: string,
  amount: number,
  note: string | undefined,
  ctx: OpContext
): Patch {
  requireById(state.funds, fundId, 'fund');
  assertPositive(amount, 'amount');
  return { fundMovements: [...state.fundMovements, newMovement(fundId, amount, note, ctx)] };
}

export function withdrawFromFund(
  state: State,
  fundId: string,
  amount: number,
  note: string | undefined,
  ctx: OpContext
): Patch {
  requireById(state.funds, fundId, 'fund');
  assertPositive(amount, 'amount');
  if (amount > fundAllocated(state, fundId)) fail('WITHDRAW_EXCEEDS_FUND', { id: fundId });
  return { fundMovements: [...state.fundMovements, newMovement(fundId, -amount, note, ctx)] };
}

// Allocates to several funds at once. All or nothing: the total may not exceed the
// money that is currently unassigned.
export function allocateMany(
  state: State,
  allocations: FundAmount[],
  note: string | undefined,
  ctx: OpContext
): Patch {
  if (allocations.length === 0) fail('NOTHING_SELECTED');
  for (const { fundId, amount } of allocations) {
    requireById(state.funds, fundId, 'fund');
    assertPositive(amount, 'amount');
  }
  if (fundAmountsEGP(state, allocations) > unassignedEGP(state) + 0.005) fail('INSUFFICIENT_UNASSIGNED');
  return {
    fundMovements: [
      ...state.fundMovements,
      ...allocations.map(({ fundId, amount }) => newMovement(fundId, amount, note, ctx)),
    ],
  };
}

// Withdraws from several funds at once. All or nothing: no fund may go below zero cash.
export function withdrawMany(
  state: State,
  withdrawals: FundAmount[],
  note: string | undefined,
  ctx: OpContext
): Patch {
  if (withdrawals.length === 0) fail('NOTHING_SELECTED');
  const perFund = new Map<string, number>();
  for (const { fundId, amount } of withdrawals) {
    requireById(state.funds, fundId, 'fund');
    assertPositive(amount, 'amount');
    perFund.set(fundId, (perFund.get(fundId) ?? 0) + amount);
  }
  for (const [fundId, total] of perFund) {
    if (total > fundAllocated(state, fundId) + 0.005) fail('WITHDRAW_EXCEEDS_FUND', { id: fundId });
  }
  return {
    fundMovements: [
      ...state.fundMovements,
      ...withdrawals.map(({ fundId, amount }) => newMovement(fundId, -amount, note, ctx)),
    ],
  };
}

// Edits a fund's details and sets its cash allocation in one atomic patch. The allocation is
// changed by a single adjustment movement for the difference. Increasing it may not push
// unassigned money below zero; decreasing is always allowed (it only frees money).
// Omitted optional fields keep their current values, except `deadline`, which is cleared.
export function editFund(state: State, fundId: string, edit: FundEdit, ctx: OpContext): Patch {
  const fund = requireById(state.funds, fundId, 'fund');
  const { deadline: _previousDeadline, frequency, nextDueDate, ...rest } = fund;
  const updated = normalizeFundShape<Fund>({
    ...rest,
    updatedAt: ctx.now().toISOString(),
    name: edit.name.trim(),
    targetAmount: edit.targetAmount,
    type: edit.type ?? fund.type,
    priority: edit.priority ?? fund.priority,
    linkedHoldingIds: edit.linkedHoldingIds ?? fund.linkedHoldingIds,
    ...(edit.deadline ? { deadline: edit.deadline } : {}),
    ...((edit.frequency ?? frequency) ? { frequency: edit.frequency ?? frequency } : {}),
    ...((edit.nextDueDate ?? nextDueDate) ? { nextDueDate: edit.nextDueDate ?? nextDueDate } : {}),
  });
  validateFund(state, updated, fundId);
  assertNonNegative(edit.cashAllocation, 'cashAllocation');

  const change = edit.cashAllocation - fundAllocated(state, fundId);
  if (change > 0 && unassignedEGPWithFundCash(state, fundId, edit.cashAllocation) < 0) {
    fail('INSUFFICIENT_UNASSIGNED', { id: fundId });
  }

  const fundMovements =
    Math.abs(change) >= 0.005
      ? [...state.fundMovements, newMovement(fundId, change, 'تعديل الرصيد', ctx)]
      : state.fundMovements;
  return { funds: replaceById(state.funds, updated, 'fund'), fundMovements };
}

export interface SinkingPayment {
  fundId: string;
  accountId: string;
  categoryId: string;
  // In the paying account's currency.
  amount: number;
  date: string;
  note?: string;
}

// Records a sinking fund's bill as one atomic step: the expense transaction, a withdrawal of
// the same value from the fund's cash (as much as it holds; any excess comes out of
// unassigned money), and nextDueDate advanced by one cycle.
export function paySinkingFund(state: State, payment: SinkingPayment, ctx: OpContext): Patch {
  const fund = requireById(state.funds, payment.fundId, 'fund');
  if (fund.type !== 'sinking') fail('NOT_A_SINKING_FUND', { id: fund.id });
  if (!fund.frequency || !fund.nextDueDate) fail('SINKING_SCHEDULE_REQUIRED', { id: fund.id });
  const account = requireById(state.accounts, payment.accountId, 'account');

  // Each step validates against the result of the previous one; any failure throws before
  // a patch is returned, so nothing is applied.
  let draft = state;
  const apply = (patch: Patch) => {
    draft = { ...draft, ...patch };
  };

  apply(
    addTransaction(
      draft,
      {
        type: 'expense',
        amount: payment.amount,
        currency: account.currency,
        accountId: account.id,
        categoryId: payment.categoryId,
        date: payment.date,
        note: payment.note?.trim() || fund.name,
      },
      ctx
    )
  );
  const expense = draft.transactions[0];
  const valueInFund = fromEGP(
    payment.amount * expense.rateToEGP,
    fund.currency,
    state.settings.exchangeRates
  );
  const take = Math.min(valueInFund, fundAllocated(draft, fund.id));
  if (take > 0.005) apply(withdrawFromFund(draft, fund.id, take, `اتدفعت: ${fund.name}`, ctx));

  const nextDue = addMonthsToDate(fund.nextDueDate, SINKING_CYCLE_MONTHS[fund.frequency]);
  apply({
    funds: draft.funds.map((f) => (f.id === fund.id ? stamp({ ...f, nextDueDate: nextDue }, ctx) : f)),
  });

  return {
    transactions: draft.transactions,
    fundMovements: draft.fundMovements,
    funds: draft.funds,
    settings: draft.settings,
  };
}

export function updateFundMovement(state: State, movement: Editable<FundMovement>, ctx: OpContext): Patch {
  requireById(state.funds, movement.fundId, 'fund');
  assertNumber(movement.amount, 'amount');
  if (movement.amount === 0) fail('NOT_POSITIVE', { field: 'amount' });
  assertDate(movement.date, 'date');
  return { fundMovements: replaceById(state.fundMovements, stamp(movement, ctx), 'fundMovement') };
}

export function deleteFundMovement(state: State, id: string, ctx: OpContext): Patch {
  requireById(state.fundMovements, id, 'fundMovement');
  return {
    fundMovements: state.fundMovements.filter((m) => m.id !== id),
    tombstones: logDeletes(state, 'fundMovement', [id], ctx),
  };
}

// --- Holdings ---------------------------------------------------------------

function validateHolding(holding: NewHolding) {
  assertName(holding.name, 'holding');
  assertNonNegative(holding.purchaseCostEGP, 'purchaseCostEGP');
  if (holding.purchaseDate !== undefined) assertDate(holding.purchaseDate, 'purchaseDate');
  if (holding.type === 'gold') {
    assertPositive(holding.weightGrams, 'weightGrams');
    if (![18, 21, 24].includes(holding.karat)) fail('INVALID_KARAT');
  } else {
    assertPositive(holding.quantity, 'quantity');
  }
}

export function addHolding(state: State, input: NewHolding, ctx: OpContext): Patch {
  validateHolding(input);
  const holding = stamp({ ...input, id: ctx.newId() }, ctx) as Holding;
  return { holdings: [...state.holdings, holding] };
}

export function updateHolding(state: State, holding: Editable<Holding>, ctx: OpContext): Patch {
  validateHolding(holding);
  return { holdings: replaceById(state.holdings, stamp(holding, ctx) as Holding, 'holding') };
}

// Removes a holding (logging a tombstone) and unlinks it from any fund.
function removeHolding(
  state: State,
  id: string,
  ctx: OpContext
): Pick<State, 'holdings' | 'funds' | 'tombstones'> {
  return {
    holdings: state.holdings.filter((h) => h.id !== id),
    funds: state.funds.map((f) =>
      f.linkedHoldingIds.includes(id)
        ? stamp({ ...f, linkedHoldingIds: f.linkedHoldingIds.filter((h) => h !== id) }, ctx)
        : f
    ),
    tombstones: logDeletes(state, 'holding', [id], ctx),
  };
}

// Holdings bought through a purchase transaction are removed by deleting that transaction,
// which also restores the cash; deleting only the holding would make the money vanish.
export function deleteHolding(state: State, id: string, ctx: OpContext): Patch {
  requireById(state.holdings, id, 'holding');
  if (state.transactions.some((tx) => tx.type === 'asset_purchase' && tx.holdingId === id)) {
    fail('HOLDING_HAS_PURCHASE', { id });
  }
  return removeHolding(state, id, ctx);
}

// --- Liabilities ------------------------------------------------------------

function validateLiability(liability: NewLiability) {
  assertName(liability.name, 'liability');
  assertPositive(liability.principal, 'principal');
  if (liability.monthlyPayment !== undefined) assertPositive(liability.monthlyPayment, 'monthlyPayment');
  assertDate(liability.startDate, 'startDate');
}

export function addLiability(state: State, input: NewLiability, ctx: OpContext): Patch {
  validateLiability(input);
  return { liabilities: [...state.liabilities, stamp({ ...input, id: ctx.newId() }, ctx)] };
}

export function updateLiability(state: State, liability: Editable<Liability>, ctx: OpContext): Patch {
  validateLiability(liability);
  const existing = requireById(state.liabilities, liability.id, 'liability');
  const hasPayments = state.transactions.some((tx) => isIncomeExpense(tx) && tx.liabilityId === liability.id);
  if (existing.currency !== liability.currency && hasPayments) {
    fail('LIABILITY_CURRENCY_LOCKED', { id: liability.id });
  }
  return { liabilities: replaceById(state.liabilities, stamp(liability, ctx), 'liability') };
}

export function deleteLiability(state: State, id: string, ctx: OpContext): Patch {
  requireById(state.liabilities, id, 'liability');
  if (state.transactions.some((tx) => isIncomeExpense(tx) && tx.liabilityId === id)) {
    fail('LIABILITY_IN_USE', { id });
  }
  return {
    liabilities: state.liabilities.filter((l) => l.id !== id),
    tombstones: logDeletes(state, 'liability', [id], ctx),
  };
}

// --- Recurring rules --------------------------------------------------------

const FREQUENCIES: RecurringRule['frequency'][] = ['weekly', 'monthly', 'yearly'];

function validateRecurringRule(state: State, rule: NewRecurringRule) {
  assertName(rule.name, 'recurringRule');
  assertPositive(rule.amount, 'amount');
  if (!FREQUENCIES.includes(rule.frequency)) fail('INVALID_FREQUENCY');
  if (!Number.isInteger(rule.interval) || rule.interval < 1) fail('NOT_POSITIVE', { field: 'interval' });
  if (rule.dayOfMonth !== undefined && (!Number.isInteger(rule.dayOfMonth) || rule.dayOfMonth < 1 || rule.dayOfMonth > 31)) {
    fail('NOT_A_NUMBER', { field: 'dayOfMonth' });
  }
  assertDate(rule.startDate, 'startDate');
  if (rule.endDate !== undefined) {
    assertDate(rule.endDate, 'endDate');
    if (rule.endDate < rule.startDate) fail('INVALID_DATE', { field: 'endDate' });
  }
  if (rule.mode !== 'auto' && rule.mode !== 'confirm') fail('INVALID_MODE');
  const account = requireById(state.accounts, rule.accountId, 'account');
  if (rule.currency !== account.currency) fail('CURRENCY_MISMATCH', { entity: 'account' });
  if (rule.kind === 'transfer') {
    const to = requireById(state.accounts, rule.toAccountId ?? '', 'account');
    if (to.id === account.id) fail('SAME_ACCOUNT_TRANSFER');
    if (to.currency !== account.currency) assertPositive(rule.toAmount ?? NaN, 'toAmount');
  } else {
    const category = requireById(state.categories, rule.categoryId ?? '', 'category');
    if (category.kind !== rule.kind) fail('CATEGORY_KIND_MISMATCH', { id: category.id });
  }
}

// Drops fields that don't belong to the rule's kind (category vs target account).
function normalizeRuleShape<T extends NewRecurringRule>(rule: T): T {
  const { categoryId, toAccountId, toAmount, ...rest } = rule;
  return (
    rule.kind === 'transfer'
      ? { ...rest, toAccountId, ...(toAmount !== undefined ? { toAmount } : {}) }
      : { ...rest, categoryId }
  ) as T;
}

const todayOf = (ctx: OpContext) => toDateKey(ctx.now());

function withNextDate(state: State, rule: RecurringRule, ctx: OpContext): RecurringRule {
  return { ...rule, nextDate: nextOccurrence(state, rule, todayOf(ctx)) };
}

// Creates a rule. `linkTransactionId` ("خليها متكررة") links that existing transaction as the
// occurrence on its date — when the date is an occurrence of the rule — so it isn't due again.
export function addRecurringRule(
  state: State,
  input: NewRecurringRule,
  ctx: OpContext,
  linkTransactionId?: string
): Patch {
  const normalized = normalizeRuleShape(input);
  validateRecurringRule(state, normalized);
  const now = ctx.now().toISOString();
  const rule: RecurringRule = stamp(
    { ...normalized, skippedDates: normalized.skippedDates ?? [], id: ctx.newId(), createdAt: now, nextDate: '' },
    ctx
  );
  let transactions = state.transactions;
  if (linkTransactionId) {
    const tx = requireById(state.transactions, linkTransactionId, 'transaction');
    if (!tx.recurringRuleId && isOccurrence(rule, tx.date)) {
      transactions = replaceById(
        state.transactions,
        stamp({ ...tx, recurringRuleId: rule.id, occurrenceDate: tx.date }, ctx) as Transaction,
        'transaction'
      );
    }
  }
  const linked = { ...state, transactions };
  return {
    transactions,
    recurringRules: [...state.recurringRules, withNextDate(linked, rule, ctx)],
  };
}

export function updateRecurringRule(state: State, rule: Editable<RecurringRule>, ctx: OpContext): Patch {
  const existing = requireById(state.recurringRules, rule.id, 'recurringRule');
  const normalized = normalizeRuleShape(rule);
  validateRecurringRule(state, normalized);
  const updated = stamp({ ...normalized, createdAt: existing.createdAt }, ctx) as RecurringRule;
  return { recurringRules: replaceById(state.recurringRules, withNextDate(state, updated, ctx), 'recurringRule') };
}

// Pause / resume. Resuming skips the occurrences that fell due while paused, so they don't
// all pop up (or get auto-recorded) at once.
export function setRecurringActive(state: State, id: string, active: boolean, ctx: OpContext): Patch {
  const rule = requireById(state.recurringRules, id, 'recurringRule');
  let skippedDates = rule.skippedDates;
  if (active && !rule.active) {
    const yesterday = shiftDate(todayOf(ctx), -1);
    const missed = dueOccurrences({ ...state, recurringRules: [{ ...rule, active: true }] }, yesterday).map((o) => o.date);
    skippedDates = [...rule.skippedDates, ...missed];
  }
  const updated = stamp({ ...rule, active, skippedDates }, ctx);
  return { recurringRules: replaceById(state.recurringRules, withNextDate(state, updated, ctx), 'recurringRule') };
}

// Past transactions created by the rule are kept but unlinked (and so count as changed).
export function deleteRecurringRule(state: State, id: string, ctx: OpContext): Patch {
  requireById(state.recurringRules, id, 'recurringRule');
  return {
    recurringRules: state.recurringRules.filter((r) => r.id !== id),
    transactions: state.transactions.map((tx) => {
      if (tx.recurringRuleId !== id) return tx;
      const { recurringRuleId: _rule, occurrenceDate: _date, ...rest } = tx;
      return stamp(rest, ctx) as Transaction;
    }),
    tombstones: logDeletes(state, 'recurringRule', [id], ctx),
  };
}

export interface OccurrenceOverrides {
  amount?: number;
  date?: string;
  accountId?: string;
  toAmount?: number;
  note?: string;
}

// The transaction recording `occurrenceDate` of `rule`, snapshotting today's rate.
function occurrenceTransaction(
  state: State,
  rule: RecurringRule,
  occurrenceDate: string,
  overrides: OccurrenceOverrides,
  ctx: OpContext
): Transaction {
  const rates = state.settings.exchangeRates;
  const account = requireById(state.accounts, overrides.accountId ?? rule.accountId, 'account');
  const amount = overrides.amount ?? rule.amount;
  const note = overrides.note?.trim() || rule.note || rule.name;
  const base = {
    id: ctx.newId(),
    amount,
    date: overrides.date ?? occurrenceDate,
    note,
    rateToEGP: rateToEGP(account.currency, rates),
    createdAt: ctx.now().toISOString(),
    recurringRuleId: rule.id,
    occurrenceDate,
  };
  if (rule.kind === 'transfer') {
    const to = requireById(state.accounts, rule.toAccountId ?? '', 'account');
    const converted = fromEGP(toEGP(amount, account.currency, rates), to.currency, rates);
    const toAmount =
      overrides.toAmount ??
      (to.currency === account.currency ? amount : overrides.amount === undefined ? (rule.toAmount ?? converted) : converted);
    const tx: TransferTransaction = stamp(
      { ...base, type: 'transfer' as const, fromAccountId: account.id, toAccountId: to.id, toAmount },
      ctx
    );
    validateTransfer(state, tx);
    return tx;
  }
  const tx: IncomeExpenseTransaction = stamp(
    { ...base, type: rule.kind, currency: account.currency, accountId: account.id, categoryId: rule.categoryId ?? '' },
    ctx
  );
  validateIncomeExpense(state, tx);
  return tx;
}

// Records every due occurrence of 'auto' rules (missed ones included) and advances their
// nextDate. Idempotent: occurrences already recorded or skipped aren't due, so a second run
// changes nothing. A rule that can't be recorded (e.g. its account was deleted) is left
// pending instead of blocking the others; everything else is applied in one patch.
export function processDue(state: State, ctx: OpContext): Patch {
  const due = dueOccurrences(state, todayOf(ctx), 'auto');
  if (due.length === 0) return {};
  const created: Transaction[] = [];
  const touched = new Set<string>();
  for (const { rule, date } of due) {
    try {
      created.push(occurrenceTransaction(state, rule, date, {}, ctx));
      touched.add(rule.id);
    } catch (error) {
      if (!(error instanceof FinanceValidationError)) throw error;
    }
  }
  if (created.length === 0) return {};
  const transactions = [...created.reverse(), ...state.transactions];
  const after = { ...state, transactions };
  return {
    transactions,
    recurringRules: state.recurringRules.map((r) => (touched.has(r.id) ? stamp(withNextDate(after, r, ctx), ctx) : r)),
  };
}

function requireDue(state: State, ruleId: string, occurrenceDate: string): RecurringRule {
  const rule = requireById(state.recurringRules, ruleId, 'recurringRule');
  const pending =
    isOccurrence(rule, occurrenceDate) &&
    !rule.skippedDates.includes(occurrenceDate) &&
    !recordedOccurrences(state, ruleId).has(occurrenceDate);
  if (!pending) fail('OCCURRENCE_NOT_DUE', { id: ruleId });
  return rule;
}

// "تم": records one occurrence (amount, date, account and note may differ from the rule).
export function confirmOccurrence(
  state: State,
  ruleId: string,
  occurrenceDate: string,
  overrides: OccurrenceOverrides,
  ctx: OpContext
): Patch {
  const rule = requireDue(state, ruleId, occurrenceDate);
  const tx = occurrenceTransaction(state, rule, occurrenceDate, overrides, ctx);
  const transactions = [tx, ...state.transactions];
  return {
    transactions,
    recurringRules: replaceById(
      state.recurringRules,
      stamp(withNextDate({ ...state, transactions }, rule, ctx), ctx),
      'recurringRule'
    ),
  };
}

// "تخطّي": marks one occurrence as skipped.
export function skipOccurrence(state: State, ruleId: string, occurrenceDate: string, ctx: OpContext): Patch {
  const rule = requireDue(state, ruleId, occurrenceDate);
  const updated = stamp({ ...rule, skippedDates: [...rule.skippedDates, occurrenceDate] }, ctx);
  return { recurringRules: replaceById(state.recurringRules, withNextDate(state, updated, ctx), 'recurringRule') };
}

// --- Monthly plans ----------------------------------------------------------

export type PlanInput = Omit<MonthlyPlan, 'id' | 'createdAt' | 'updatedAt'>;

const CURRENCY_CODES: CurrencyCode[] = ['EGP', 'SAR', 'USD'];

function validatePlan(state: State, plan: PlanInput) {
  if (!isMonthKey(plan.month)) fail('INVALID_MONTH');
  if (!CURRENCY_CODES.includes(plan.currency)) fail('CURRENCY_MISMATCH', { entity: 'monthlyPlan' });
  assertNonNegative(plan.expectedIncome, 'expectedIncome');
  const seenCategories = new Set<string>();
  for (const line of plan.lines) {
    const category = requireById(state.categories, line.categoryId, 'category');
    if (category.kind !== 'expense') fail('CATEGORY_KIND_MISMATCH', { id: category.id });
    if (seenCategories.has(line.categoryId)) fail('DUPLICATE_ENTRY', { entity: 'category', id: line.categoryId });
    seenCategories.add(line.categoryId);
    assertNonNegative(line.limit, 'planLimit');
    if (line.kind !== 'fixed' && line.kind !== 'flexible') fail('NOT_A_NUMBER', { field: 'planLimit' });
  }
  const seenFunds = new Set<string>();
  for (const contribution of plan.fundContributions) {
    requireById(state.funds, contribution.fundId, 'fund');
    if (seenFunds.has(contribution.fundId)) fail('DUPLICATE_ENTRY', { entity: 'fund', id: contribution.fundId });
    seenFunds.add(contribution.fundId);
    assertNonNegative(contribution.amount, 'amount');
  }
}

// Creates or replaces the plan for `input.month` (one plan per month; its id derives from
// the month). Replacing keeps the original id and createdAt.
export function savePlan(state: State, input: PlanInput, ctx: OpContext): Patch {
  validatePlan(state, input);
  const existing = state.monthlyPlans.find((p) => p.month === input.month);
  const plan: MonthlyPlan = stamp(
    {
      ...input,
      id: existing?.id ?? planIdFor(input.month),
      createdAt: existing?.createdAt ?? ctx.now().toISOString(),
    },
    ctx
  );
  return { monthlyPlans: [...state.monthlyPlans.filter((p) => p.month !== input.month), plan] };
}

export interface NewPlanLine {
  month: string;
  // In the saved plan's currency.
  limit: number;
  kind: PlanLine['kind'];
}

// "بند جديد" in the plan editor: creates an expense category and adds it as a line of the
// month's existing plan, in one patch (nothing is saved if either step fails).
export function addCategoryWithPlanLine(
  state: State,
  input: Pick<NewCategory, 'name' | 'bucket'>,
  line: NewPlanLine,
  ctx: OpContext
): Patch {
  const plan = state.monthlyPlans.find((p) => p.month === line.month);
  if (!plan) fail('PLAN_NOT_FOUND', { id: line.month });
  const category = newCategory(state, { name: input.name, kind: 'expense', bucket: input.bucket }, ctx);
  const withCategory = { ...state, categories: [...state.categories, category] };
  const { id: _id, createdAt: _c, updatedAt: _u, ...planInput } = plan;
  const planPatch = savePlan(
    withCategory,
    { ...planInput, lines: [...plan.lines, { categoryId: category.id, limit: line.limit, kind: line.kind }] },
    ctx
  );
  return { categories: withCategory.categories, ...planPatch };
}

// "انسخ خطة الشهر اللي فات": copies another month's plan (income, currency, lines and fund
// contributions) into an unplanned month. Categories or funds deleted since are skipped.
export function copyPlan(state: State, fromMonth: string, toMonth: string, ctx: OpContext): Patch {
  const source = state.monthlyPlans.find((p) => p.month === fromMonth);
  if (!source) fail('NOT_FOUND', { entity: 'monthlyPlan', id: fromMonth });
  if (state.monthlyPlans.some((p) => p.month === toMonth)) fail('PLAN_EXISTS', { id: toMonth });
  return savePlan(
    state,
    {
      month: toMonth,
      currency: source.currency,
      expectedIncome: source.expectedIncome,
      lines: source.lines.filter((l) => state.categories.some((c) => c.id === l.categoryId)),
      fundContributions: source.fundContributions.filter((c) => state.funds.some((f) => f.id === c.fundId)),
    },
    ctx
  );
}

export function deletePlan(state: State, month: string, ctx: OpContext): Patch {
  const plan = state.monthlyPlans.find((p) => p.month === month);
  if (!plan) return {};
  return {
    monthlyPlans: state.monthlyPlans.filter((p) => p.month !== month),
    tombstones: logDeletes(state, 'monthlyPlan', [plan.id], ctx),
  };
}

// --- Net worth snapshots, action snoozes, monthly reviews -------------------

// Fills in missing past months and upserts the current month's snapshot. {} when nothing
// changed, so calling it after every change never loops.
export function recordNetWorthSnapshots(state: State, ctx: OpContext): Patch {
  const netWorthSnapshots = syncedSnapshots(state, ctx.now());
  return netWorthSnapshots ? { netWorthSnapshots } : {};
}

// "مش دلوقتي": hides a Next Best Action for 24 hours. Urgent ones (due items, spent fund money)
// can't be snoozed. Snoozes that have run out are dropped on the way.
export function dismissAction(state: State, actionId: string, ctx: OpContext): Patch {
  if (!actionId || NON_DISMISSIBLE_ACTION_IDS.includes(actionId)) fail('ACTION_NOT_DISMISSIBLE', { id: actionId });
  const now = ctx.now();
  const expired = state.actionDismissals.filter((d) => d.actionId !== actionId && Date.parse(d.until) <= now.getTime());
  const dismissal: ActionDismissal = stamp(
    { id: actionId, actionId, until: new Date(now.getTime() + SNOOZE_MS).toISOString() },
    ctx
  );
  return {
    actionDismissals: [
      ...state.actionDismissals.filter((d) => d.actionId !== actionId && !expired.includes(d)),
      dismissal,
    ],
    ...(expired.length > 0 ? { tombstones: logDeletes(state, 'actionDismissal', expired.map((d) => d.id), ctx) } : {}),
  };
}

// "خلّصت المراجعة": marks a month (not a future one) as reviewed. Finishing again keeps the
// first completion.
export function completeMonthlyReview(state: State, month: string, ctx: OpContext): Patch {
  if (!isMonthKey(month) || month > toDateKey(ctx.now()).slice(0, 7)) fail('INVALID_MONTH');
  if (state.monthlyReviews.some((r) => r.month === month)) return {};
  const review: MonthlyReview = stamp({ id: reviewIdFor(month), month, completedAt: ctx.now().toISOString() }, ctx);
  return { monthlyReviews: [...state.monthlyReviews, review] };
}

export const reviewIdFor = (month: string) => `review-${month}`;

// --- Settings ---------------------------------------------------------------

export function updateRates(state: State, rates: ExchangeRates): Patch {
  assertPositive(rates.SAR_EGP, 'exchangeRate');
  assertPositive(rates.USD_EGP, 'exchangeRate');
  return { settings: { ...state.settings, exchangeRates: rates } };
}

export interface SettingsUpdate {
  exchangeRates?: { SAR_EGP: number; USD_EGP: number };
  goldPrice24kEGP?: number;
  goldPrice21kEGP?: number;
  trackingStartDate?: string;
}

// Updates any of the market inputs and the tracking start date in one step. Changed rates or
// gold prices get a fresh "last updated" timestamp.
export function updateSettings(state: State, update: SettingsUpdate, ctx: OpContext): Patch {
  const now = ctx.now().toISOString();
  const settings = { ...state.settings };
  if (update.exchangeRates) {
    assertPositive(update.exchangeRates.SAR_EGP, 'exchangeRate');
    assertPositive(update.exchangeRates.USD_EGP, 'exchangeRate');
    const { SAR_EGP, USD_EGP } = settings.exchangeRates;
    if (update.exchangeRates.SAR_EGP !== SAR_EGP || update.exchangeRates.USD_EGP !== USD_EGP) {
      settings.exchangeRates = { ...update.exchangeRates, lastUpdated: now };
    }
  }
  const p24 = update.goldPrice24kEGP ?? settings.goldPrice24kEGP;
  const p21 = update.goldPrice21kEGP ?? settings.goldPrice21kEGP;
  assertPositive(p24, 'goldPrice');
  assertPositive(p21, 'goldPrice');
  if (p24 !== settings.goldPrice24kEGP || p21 !== settings.goldPrice21kEGP) {
    Object.assign(settings, { goldPrice24kEGP: p24, goldPrice21kEGP: p21, goldPriceUpdatedAt: now });
  }
  if (update.trackingStartDate !== undefined) {
    assertDate(update.trackingStartDate, 'date');
    settings.trackingStartDate = update.trackingStartDate;
  }
  return { settings };
}

// Settings that belong to this installation rather than to the data set.
function deviceSettings(state: State): Pick<Settings, 'deviceId' | 'lastBackupAt' | 'appLockEnabled'> {
  const { deviceId, lastBackupAt, appLockEnabled } = state.settings;
  return {
    deviceId,
    ...(lastBackupAt ? { lastBackupAt } : {}),
    ...(appLockEnabled !== undefined ? { appLockEnabled } : {}),
  };
}

const COLLECTIONS: { key: Exclude<keyof State, 'settings' | 'tombstones'>; entity: SyncEntity }[] = [
  { key: 'accounts', entity: 'account' },
  { key: 'categories', entity: 'category' },
  { key: 'transactions', entity: 'transaction' },
  { key: 'funds', entity: 'fund' },
  { key: 'fundMovements', entity: 'fundMovement' },
  { key: 'holdings', entity: 'holding' },
  { key: 'liabilities', entity: 'liability' },
  { key: 'recurringRules', entity: 'recurringRule' },
  { key: 'monthlyPlans', entity: 'monthlyPlan' },
  { key: 'netWorthSnapshots', entity: 'netWorthSnapshot' },
  { key: 'actionDismissals', entity: 'actionDismissal' },
  { key: 'monthlyReviews', entity: 'monthlyReview' },
];

const syncKey = (item: object) =>
  'id' in item ? String(item.id) : String((item as { month: string }).month);

// Replaces every collection with `next`'s. Entities that disappear get tombstones; entities
// that exist (again) lose theirs. Both sides' tombstone logs are kept, newest per entity.
function replaceAllData(state: State, next: State, settings: Settings, ctx: OpContext): Patch {
  const deletedAt = ctx.now().toISOString();
  const present = new Set<string>();
  const log = new Map<string, Tombstone>();
  const record = (t: Tombstone) => {
    const key = `${t.entity}:${t.id}`;
    const existing = log.get(key);
    if (!existing || existing.deletedAt < t.deletedAt) log.set(key, t);
  };
  [...state.tombstones, ...next.tombstones].forEach(record);

  const patch: Patch = { settings };
  for (const { key, entity } of COLLECTIONS) {
    const incoming = next[key] as object[];
    const incomingIds = new Set(incoming.map(syncKey));
    incomingIds.forEach((id) => present.add(`${entity}:${id}`));
    for (const item of state[key] as object[]) {
      const id = syncKey(item);
      if (!incomingIds.has(id)) record({ entity, id, deletedAt });
    }
    Object.assign(patch, { [key]: incoming });
  }
  patch.tombstones = [...log.entries()].filter(([key]) => !present.has(key)).map(([, t]) => t);
  return patch;
}

// "استيراد البيانات الافتتاحية": replaces all data with `seed`, keeping the current exchange
// rates and gold prices (market inputs the user maintains) but the seed's tracking start date.
export function replaceWithSeed(state: State, seed: State, ctx: OpContext): Patch {
  const { lastUsed: _seedLastUsed, ...seedSettings } = seed.settings;
  return replaceAllData(
    state,
    seed,
    {
      ...seedSettings,
      exchangeRates: state.settings.exchangeRates,
      goldPrice24kEGP: state.settings.goldPrice24kEGP,
      goldPrice21kEGP: state.settings.goldPrice21kEGP,
      goldPriceUpdatedAt: state.settings.goldPriceUpdatedAt,
      ...deviceSettings(state),
    },
    ctx
  );
}

// "استعادة من نسخة احتياطية": replaces all data with a restored backup. This device keeps its
// own id, lock setting and last-backup date.
export function restoreFromBackup(state: State, restored: State, ctx: OpContext): Patch {
  return replaceAllData(state, restored, { ...restored.settings, ...deviceSettings(state) }, ctx);
}

export function markBackedUp(state: State, at: string): Patch {
  return { settings: { ...state.settings, lastBackupAt: at } };
}

export function setAppLock(state: State, enabled: boolean): Patch {
  return { settings: { ...state.settings, appLockEnabled: enabled } };
}

export function setDueNotifications(state: State, enabled: boolean): Patch {
  return { settings: { ...state.settings, dueNotificationsEnabled: enabled } };
}

// Gives the installation its id the first time it runs.
export function ensureDeviceId(state: State, ctx: OpContext): Patch {
  return state.settings.deviceId ? {} : { settings: { ...state.settings, deviceId: ctx.newId() } };
}
