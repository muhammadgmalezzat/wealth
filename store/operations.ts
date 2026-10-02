import { fromEGP, rateToEGP, toEGP } from '@/utils/currency';
import { isDateKey, isMonthKey, toDateKey } from '@/utils/dates';
import {
  FinanceValidationError,
  type FinanceEntity,
  type FinanceErrorCode,
  type FinanceErrorDetails,
  type FinanceField,
} from './errors';
import { fundAllocated, unassignedEGPWithFundCash } from './selectors';
import type {
  Account,
  Category,
  ExchangeRates,
  FinanceStateV2,
  Fund,
  FundMovement,
  Holding,
  IncomeExpenseTransaction,
  Liability,
  MonthlyPlan,
  RecurringRule,
  Transaction,
  TransferTransaction,
} from './types';

// Pure, validated state transitions. Each returns a patch to merge into the state, or throws
// FinanceValidationError with a typed code. The Zustand store wraps these; tests call them directly.

export { FinanceValidationError };

export interface OpContext {
  newId: () => string;
  now: () => Date;
}

type State = FinanceStateV2;
type Patch = Partial<FinanceStateV2>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type NewAccount = Omit<Account, 'id' | 'createdAt'>;
export type NewCategory = Omit<Category, 'id' | 'isDefault'>;
export type NewIncomeExpense = Omit<IncomeExpenseTransaction, 'id' | 'createdAt' | 'rateToEGP'> & {
  rateToEGP?: number;
};
export type NewTransfer = Omit<
  TransferTransaction,
  'id' | 'type' | 'createdAt' | 'rateToEGP' | 'toAmount'
> & {
  // Defaults to `amount` converted at current rates.
  toAmount?: number;
  rateToEGP?: number;
};
export type NewFund = Omit<Fund, 'id' | 'createdAt' | 'linkedHoldingIds'> & {
  linkedHoldingIds?: string[];
};
export type NewHolding = DistributiveOmit<Holding, 'id'>;
export type NewLiability = Omit<Liability, 'id'>;
export type NewRecurringRule = Omit<RecurringRule, 'id'>;

export interface FundEdit {
  name: string;
  targetAmount: number;
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

const isIncomeExpense = (tx: Transaction): tx is IncomeExpenseTransaction => tx.type !== 'transfer';

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
  const account: Account = { ...input, id: ctx.newId(), createdAt: ctx.now().toISOString() };
  return { accounts: [...state.accounts, account] };
}

export function updateAccount(state: State, account: Account): Patch {
  validateAccount(account);
  const existing = requireById(state.accounts, account.id, 'account');
  if (existing.currency !== account.currency && accountInUse(state, account.id)) {
    fail('ACCOUNT_CURRENCY_LOCKED', { id: account.id });
  }
  return { accounts: replaceById(state.accounts, account, 'account') };
}

export function deleteAccount(state: State, id: string): Patch {
  requireById(state.accounts, id, 'account');
  if (accountInUse(state, id)) fail('ACCOUNT_IN_USE', { id });
  return { accounts: state.accounts.filter((a) => a.id !== id) };
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
  return { categories: [...state.categories, { ...input, id: ctx.newId(), isDefault: false }] };
}

export function updateCategory(state: State, category: Category): Patch {
  validateCategory(category);
  return { categories: replaceById(state.categories, category, 'category') };
}

export function deleteCategory(state: State, id: string): Patch {
  requireById(state.categories, id, 'category');
  const inUse =
    state.transactions.some((tx) => isIncomeExpense(tx) && tx.categoryId === id) ||
    state.recurringRules.some((r) => r.categoryId === id);
  if (inUse) fail('CATEGORY_IN_USE', { id });
  return { categories: state.categories.filter((c) => c.id !== id) };
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

export function addTransaction(state: State, input: NewIncomeExpense, ctx: OpContext): Patch {
  const tx: IncomeExpenseTransaction = {
    ...input,
    id: ctx.newId(),
    createdAt: ctx.now().toISOString(),
    rateToEGP: input.rateToEGP ?? rateToEGP(input.currency, state.settings.exchangeRates),
  };
  validateIncomeExpense(state, tx);
  return { transactions: [tx, ...state.transactions] };
}

export function addTransfer(state: State, input: NewTransfer, ctx: OpContext): Patch {
  const rates = state.settings.exchangeRates;
  const from = requireById(state.accounts, input.fromAccountId, 'account');
  const to = requireById(state.accounts, input.toAccountId, 'account');
  const tx: TransferTransaction = {
    ...input,
    type: 'transfer',
    id: ctx.newId(),
    createdAt: ctx.now().toISOString(),
    toAmount:
      input.toAmount ?? fromEGP(toEGP(input.amount, from.currency, rates), to.currency, rates),
    rateToEGP: input.rateToEGP ?? rateToEGP(from.currency, rates),
  };
  validateTransfer(state, tx);
  return { transactions: [tx, ...state.transactions] };
}

export function updateTransaction(state: State, tx: Transaction): Patch {
  if (tx.type === 'transfer') validateTransfer(state, tx);
  else validateIncomeExpense(state, tx);
  return { transactions: replaceById(state.transactions, tx, 'transaction') };
}

export function deleteTransaction(state: State, id: string): Patch {
  requireById(state.transactions, id, 'transaction');
  return { transactions: state.transactions.filter((t) => t.id !== id) };
}

// --- Funds & movements ------------------------------------------------------

// `fundId` is the fund being validated (undefined when adding), so it may keep its own links.
function validateFund(state: State, fund: NewFund, fundId?: string) {
  assertName(fund.name, 'fund');
  assertPositive(fund.targetAmount, 'targetAmount');
  assertNumber(fund.priority, 'priority');
  if (fund.monthlyContribution !== undefined) {
    assertNonNegative(fund.monthlyContribution, 'monthlyContribution');
  }
  if (fund.deadline !== undefined) assertDate(fund.deadline, 'deadline');

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
  validateFund(state, input);
  const fund: Fund = {
    ...input,
    linkedHoldingIds: input.linkedHoldingIds ?? [],
    id: ctx.newId(),
    createdAt: ctx.now().toISOString(),
  };
  return { funds: [...state.funds, fund] };
}

export function updateFund(state: State, fund: Fund): Patch {
  validateFund(state, fund, fund.id);
  return { funds: replaceById(state.funds, fund, 'fund') };
}

// Deleting a fund releases its allocations back to unassigned money.
export function deleteFund(state: State, id: string): Patch {
  requireById(state.funds, id, 'fund');
  return {
    funds: state.funds.filter((f) => f.id !== id),
    fundMovements: state.fundMovements.filter((m) => m.fundId !== id),
  };
}

function newMovement(fundId: string, amount: number, note: string | undefined, ctx: OpContext): FundMovement {
  return {
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

// Edits a fund's details and sets its cash allocation in one atomic patch. The allocation is
// changed by a single adjustment movement for the difference. Increasing it may not push
// unassigned money below zero; decreasing is always allowed (it only frees money).
export function editFund(state: State, fundId: string, edit: FundEdit, ctx: OpContext): Patch {
  const fund = requireById(state.funds, fundId, 'fund');
  const { deadline: _previousDeadline, ...rest } = fund;
  const updated: Fund = {
    ...rest,
    name: edit.name.trim(),
    targetAmount: edit.targetAmount,
    ...(edit.deadline ? { deadline: edit.deadline } : {}),
  };
  validateFund(state, updated, fundId);
  assertNonNegative(edit.cashAllocation, 'cashAllocation');

  const change = edit.cashAllocation - fundAllocated(state, fundId);
  if (change > 0 && unassignedEGPWithFundCash(state, fundId, edit.cashAllocation) < 0) {
    fail('INSUFFICIENT_UNASSIGNED', { id: fundId });
  }

  const fundMovements =
    Math.abs(change) >= 0.005
      ? [...state.fundMovements, newMovement(fundId, change, 'Adjustment', ctx)]
      : state.fundMovements;
  return { funds: replaceById(state.funds, updated, 'fund'), fundMovements };
}

export function updateFundMovement(state: State, movement: FundMovement): Patch {
  requireById(state.funds, movement.fundId, 'fund');
  assertNumber(movement.amount, 'amount');
  if (movement.amount === 0) fail('NOT_POSITIVE', { field: 'amount' });
  assertDate(movement.date, 'date');
  return { fundMovements: replaceById(state.fundMovements, movement, 'fundMovement') };
}

export function deleteFundMovement(state: State, id: string): Patch {
  requireById(state.fundMovements, id, 'fundMovement');
  return { fundMovements: state.fundMovements.filter((m) => m.id !== id) };
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
  const holding = { ...input, id: ctx.newId() } as Holding;
  return { holdings: [...state.holdings, holding] };
}

export function updateHolding(state: State, holding: Holding): Patch {
  validateHolding(holding);
  return { holdings: replaceById(state.holdings, holding, 'holding') };
}

// Also unlinks the holding from any fund.
export function deleteHolding(state: State, id: string): Patch {
  requireById(state.holdings, id, 'holding');
  return {
    holdings: state.holdings.filter((h) => h.id !== id),
    funds: state.funds.map((f) =>
      f.linkedHoldingIds.includes(id)
        ? { ...f, linkedHoldingIds: f.linkedHoldingIds.filter((h) => h !== id) }
        : f
    ),
  };
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
  return { liabilities: [...state.liabilities, { ...input, id: ctx.newId() }] };
}

export function updateLiability(state: State, liability: Liability): Patch {
  validateLiability(liability);
  const existing = requireById(state.liabilities, liability.id, 'liability');
  const hasPayments = state.transactions.some((tx) => isIncomeExpense(tx) && tx.liabilityId === liability.id);
  if (existing.currency !== liability.currency && hasPayments) {
    fail('LIABILITY_CURRENCY_LOCKED', { id: liability.id });
  }
  return { liabilities: replaceById(state.liabilities, liability, 'liability') };
}

export function deleteLiability(state: State, id: string): Patch {
  requireById(state.liabilities, id, 'liability');
  if (state.transactions.some((tx) => isIncomeExpense(tx) && tx.liabilityId === id)) {
    fail('LIABILITY_IN_USE', { id });
  }
  return { liabilities: state.liabilities.filter((l) => l.id !== id) };
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
  return { recurringRules: [...state.recurringRules, { ...input, id: ctx.newId() }] };
}

export function updateRecurringRule(state: State, rule: RecurringRule): Patch {
  validateRecurringRule(state, rule);
  return { recurringRules: replaceById(state.recurringRules, rule, 'recurringRule') };
}

// Past transactions created by the rule are kept but unlinked.
export function deleteRecurringRule(state: State, id: string): Patch {
  requireById(state.recurringRules, id, 'recurringRule');
  return {
    recurringRules: state.recurringRules.filter((r) => r.id !== id),
    transactions: state.transactions.map((tx) => {
      if (!isIncomeExpense(tx) || tx.recurringRuleId !== id) return tx;
      const { recurringRuleId: _removed, ...rest } = tx;
      return rest;
    }),
  };
}

// --- Monthly plans ----------------------------------------------------------

// Inserts or replaces the plan for `plan.month`.
export function setMonthlyPlan(state: State, plan: MonthlyPlan): Patch {
  if (!isMonthKey(plan.month)) fail('INVALID_MONTH');
  assertNonNegative(plan.expectedIncomeEGP, 'expectedIncomeEGP');
  for (const limit of Object.values(plan.bucketLimitsEGP)) {
    assertNonNegative(limit ?? 0, 'bucketLimit');
  }
  return {
    monthlyPlans: [...state.monthlyPlans.filter((p) => p.month !== plan.month), plan],
  };
}

export function deleteMonthlyPlan(state: State, month: string): Patch {
  return { monthlyPlans: state.monthlyPlans.filter((p) => p.month !== month) };
}

// --- Settings ---------------------------------------------------------------

export function updateRates(state: State, rates: ExchangeRates): Patch {
  assertPositive(rates.SAR_EGP, 'exchangeRate');
  assertPositive(rates.USD_EGP, 'exchangeRate');
  return { settings: { ...state.settings, exchangeRates: rates } };
}

export function updateGoldPrice(state: State, price: number, ctx: OpContext): Patch {
  assertPositive(price, 'goldPrice');
  return {
    settings: { ...state.settings, goldPrice24kEGP: price, goldPriceUpdatedAt: ctx.now().toISOString() },
  };
}
