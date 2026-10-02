import { fromEGP, rateToEGP, toEGP } from '@/utils/currency';
import { addMonthsToDate, isDateKey, isMonthKey, toDateKey } from '@/utils/dates';
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
export type NewRecurringRule = Omit<RecurringRule, 'id' | 'updatedAt'>;

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

function validateCategory(category: NewCategory) {
  assertName(category.name, 'category');
  if ((category.kind === 'income') !== (category.bucket === 'income')) {
    fail('CATEGORY_BUCKET_MISMATCH');
  }
}

export function addCategory(state: State, input: NewCategory, ctx: OpContext): Patch {
  validateCategory(input);
  return { categories: [...state.categories, stamp({ ...input, id: ctx.newId(), isDefault: false }, ctx)] };
}

export function updateCategory(state: State, category: Editable<Category>, ctx: OpContext): Patch {
  validateCategory(category);
  return { categories: replaceById(state.categories, stamp(category, ctx), 'category') };
}

export function deleteCategory(state: State, id: string, ctx: OpContext): Patch {
  requireById(state.categories, id, 'category');
  const inUse =
    state.transactions.some((tx) => isIncomeExpense(tx) && tx.categoryId === id) ||
    state.recurringRules.some((r) => r.categoryId === id);
  if (inUse) fail('CATEGORY_IN_USE', { id });
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

function validateRecurringRule(state: State, rule: NewRecurringRule) {
  assertName(rule.name, 'recurringRule');
  assertPositive(rule.amount, 'amount');
  assertDate(rule.nextDate, 'nextDate');
  if (!['weekly', 'monthly', 'yearly'].includes(rule.frequency)) fail('INVALID_FREQUENCY');
  const account = requireById(state.accounts, rule.accountId, 'account');
  if (rule.currency !== account.currency) fail('CURRENCY_MISMATCH', { entity: 'account' });
  const category = requireById(state.categories, rule.categoryId, 'category');
  if (category.kind !== rule.type) fail('CATEGORY_KIND_MISMATCH', { id: category.id });
}

export function addRecurringRule(state: State, input: NewRecurringRule, ctx: OpContext): Patch {
  validateRecurringRule(state, input);
  return { recurringRules: [...state.recurringRules, stamp({ ...input, id: ctx.newId() }, ctx)] };
}

export function updateRecurringRule(state: State, rule: Editable<RecurringRule>, ctx: OpContext): Patch {
  validateRecurringRule(state, rule);
  return { recurringRules: replaceById(state.recurringRules, stamp(rule, ctx), 'recurringRule') };
}

// Past transactions created by the rule are kept but unlinked (and so count as changed).
export function deleteRecurringRule(state: State, id: string, ctx: OpContext): Patch {
  requireById(state.recurringRules, id, 'recurringRule');
  return {
    recurringRules: state.recurringRules.filter((r) => r.id !== id),
    transactions: state.transactions.map((tx) => {
      if (!isIncomeExpense(tx) || tx.recurringRuleId !== id) return tx;
      const { recurringRuleId: _removed, ...rest } = tx;
      return stamp(rest, ctx);
    }),
    tombstones: logDeletes(state, 'recurringRule', [id], ctx),
  };
}

// --- Monthly plans ----------------------------------------------------------

// Inserts or replaces the plan for `plan.month`.
export function setMonthlyPlan(state: State, plan: Editable<MonthlyPlan>, ctx: OpContext): Patch {
  if (!isMonthKey(plan.month)) fail('INVALID_MONTH');
  assertNonNegative(plan.expectedIncomeEGP, 'expectedIncomeEGP');
  for (const limit of Object.values(plan.bucketLimitsEGP)) {
    assertNonNegative(limit ?? 0, 'bucketLimit');
  }
  return {
    monthlyPlans: [...state.monthlyPlans.filter((p) => p.month !== plan.month), stamp(plan, ctx)],
  };
}

export function deleteMonthlyPlan(state: State, month: string, ctx: OpContext): Patch {
  const existed = state.monthlyPlans.some((p) => p.month === month);
  return {
    monthlyPlans: state.monthlyPlans.filter((p) => p.month !== month),
    ...(existed ? { tombstones: logDeletes(state, 'monthlyPlan', [month], ctx) } : {}),
  };
}

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

// Gives the installation its id the first time it runs.
export function ensureDeviceId(state: State, ctx: OpContext): Patch {
  return state.settings.deviceId ? {} : { settings: { ...state.settings, deviceId: ctx.newId() } };
}
