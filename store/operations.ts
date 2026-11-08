import { isKnownCountry } from '@/constants/countries';
import { isKnownCurrency } from '@/constants/currencyRegistry';
import { decimalsFor, roundIn, roundMoney, splitTo, sumIn } from '@/utils/money';
import { convertCurrency, projectAmount, rateToEGP } from '@/utils/currency';
import { withEgpRates } from '@/utils/rates';
import { addMonthsToDate, isDateKey, isMonthKey, shiftDate, toDateKey } from '@/utils/dates';
import { goldPricesEGP, isValidPremiumPct } from '@/utils/prices/calc';
import { priceSourceOf, type PriceFetchResult } from '@/utils/prices/fetchPrices';
import { planIdFor } from './migrations';
import { NON_DISMISSIBLE_ACTION_IDS, SNOOZE_MS } from './nextActions';
import { dueOccurrences, isOccurrence, nextOccurrence, recordedOccurrences } from './recurring';
import { NeedsCoverError, planRelease, planReserve, proportionalSplit, reservationsOn, shortfallsBetween, type OpOptions, type Shortfall } from './cover';
import { feeCategoryId } from './defaultCategories';
import { snapshotForNow } from './rateSnapshots';
import { syncSnapshots } from './snapshots';
import {
  FinanceValidationError,
  type FinanceEntity,
  type FinanceErrorCode,
  type FinanceErrorDetails,
  type FinanceField,
} from './errors';
import {
  accountAvailable,
  accountBalance,
  accountReserved,
  fundAllocated,
  reservation,
  SINKING_CYCLE_MONTHS,
  withdrawalPlan,
  type FundAmount,
} from './selectors';
import type {
  Account,
  ActionDismissal,
  AssetPurchaseTransaction,
  Category,
  ExchangeTransaction,
  Fee,
  CountryCode,
  CurrencyCode,
  FinanceState,
  Fund,
  ReservationKind,
  ReservationMovement,
  GoldHolding,
  GoldKarat,
  Holding,
  Money,
  IncomeExpenseTransaction,
  LastUsedSelection,
  Liability,
  MonthlyPlan,
  MonthlyReview,
  PlanLine,
  PriceSource,
  RateSnapshot,
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
export type NewIncomeExpense = Omit<IncomeExpenseTransaction, 'id' | 'createdAt' | 'updatedAt' | 'rateSnapshotId'>;
export type NewTransfer = Omit<TransferTransaction, 'id' | 'type' | 'createdAt' | 'updatedAt' | 'rateSnapshotId' | 'fees'> & {
  fees?: Fee[];
};
// `receivedAmount` is required: what actually arrived. No operation ever computes it from a rate.
export type NewExchange = Omit<ExchangeTransaction, 'id' | 'type' | 'createdAt' | 'updatedAt' | 'rateSnapshotId' | 'fees'> & {
  fees?: Fee[];
};

// The rate snapshot a patch must also save when the current rates have none yet (see snapshotForNow).
type RateSnapshotUse = ReturnType<typeof snapshotForNow>;
const ratePatch = (use: RateSnapshotUse): { rateSnapshots?: RateSnapshot[] } =>
  use.rateSnapshots ? { rateSnapshots: use.rateSnapshots } : {};
export type NewFund = Omit<Fund, 'id' | 'createdAt' | 'updatedAt' | 'linkedHoldingIds'> & {
  linkedHoldingIds?: string[];
};
export type NewHolding = DistributiveOmit<Holding, 'id' | 'updatedAt' | 'purchaseRateSnapshotId'>;
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

function assertCountry(country: CountryCode) {
  if (!isKnownCountry(country)) fail('UNKNOWN_COUNTRY');
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

// --- Rounding at the write boundary (INV-7) ---------------------------------

// Every amount is rounded to its currency's decimals before it is validated and stored (half away from
// zero). A currency the registry doesn't know is left alone: validation rejects it right after.
const money = (amount: number, currency: CurrencyCode): number =>
  isKnownCurrency(currency) ? roundMoney(amount, currency) : amount;

// Fees are in the currency of the account they are charged to.
function roundFees(state: State, fees: Fee[]): Fee[] {
  return fees.map((fee) => {
    const account = state.accounts.find((a) => a.id === fee.accountId);
    return { ...fee, amount: account ? money(fee.amount, account.currency) : fee.amount };
  });
}

// Amounts of a transaction: in its own currency; a transfer's in its accounts' (the same); an exchange's
// sent amount in the source account's currency and received amount in the target's.
function roundTransaction<T extends Editable<Transaction>>(state: State, tx: T): T {
  if (tx.type === 'transfer' || tx.type === 'exchange') {
    const from = state.accounts.find((a) => a.id === tx.fromAccountId);
    const to = state.accounts.find((a) => a.id === tx.toAccountId);
    const fees = roundFees(state, tx.fees);
    if (tx.type === 'transfer') return { ...tx, amount: from ? money(tx.amount, from.currency) : tx.amount, fees };
    return {
      ...tx,
      sentAmount: from ? money(tx.sentAmount, from.currency) : tx.sentAmount,
      receivedAmount: to ? money(tx.receivedAmount, to.currency) : tx.receivedAmount,
      fees,
    };
  }
  return { ...tx, amount: money(tx.amount, tx.currency) };
}

// A fund amount in `currency` (the fund's own when omitted).
const fundMoney = (state: State, fundId: string, amount: number, currency?: CurrencyCode): number => {
  const fund = state.funds.find((f) => f.id === fundId);
  return fund ? money(amount, currency ?? fund.currency) : amount;
};

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
      tx.type === 'transfer' || tx.type === 'exchange'
        ? tx.fromAccountId === accountId || tx.toAccountId === accountId
        : tx.accountId === accountId
    ) ||
    state.recurringRules.some((r) => r.accountId === accountId) ||
    state.reservationMovements.some((m) => m.accountId === accountId)
  );
}

function validateAccount(account: NewAccount) {
  assertName(account.name, 'account');
  assertCountry(account.country);
  assertCurrency(account.currency);
  assertNumber(account.openingBalance, 'openingBalance');
}

export function addAccount(state: State, raw: NewAccount, ctx: OpContext): Patch {
  const input = { ...raw, openingBalance: money(raw.openingBalance, raw.currency) };
  validateAccount(input);
  const account: Account = stamp({ ...input, id: ctx.newId(), createdAt: ctx.now().toISOString() }, ctx);
  return { accounts: [...state.accounts, account] };
}

// Editing an account may lower its balance (the opening balance is how "set the current balance" works), so it goes
// through the cover gate like any other balance-reducing operation. The currency is locked while the account has
// transactions, rules or reservations, and it cannot be archived while money is reserved on it.
export function updateAccount(state: State, raw: Editable<Account>, ctx: OpContext, options?: OpOptions): Patch {
  const account = { ...raw, openingBalance: money(raw.openingBalance, raw.currency) };
  validateAccount(account);
  const existing = requireById(state.accounts, account.id, 'account');
  if (existing.currency !== account.currency && accountInUse(state, account.id)) {
    fail('ACCOUNT_CURRENCY_LOCKED', { id: account.id });
  }
  if (account.archived && !existing.archived && accountReserved(state, account.id) > 0) {
    fail('ACCOUNT_HAS_RESERVATIONS', { id: account.id });
  }
  return settle(state, { accounts: replaceById(state.accounts, stamp(account, ctx), 'account') }, ctx, options);
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

export { feeCategoryId };

// Each fee is charged to the source or the target of the move, in that account's currency; its category (the
// fees category by default) is an expense one.
function validateFees(state: State, tx: TransferTransaction | ExchangeTransaction) {
  for (const fee of tx.fees) {
    assertPositive(fee.amount, 'fee');
    if (fee.accountId !== tx.fromAccountId && fee.accountId !== tx.toAccountId) fail('FEE_ACCOUNT_INVALID');
    const categoryId = fee.categoryId ?? feeCategoryId(state.categories);
    const category = requireById(state.categories, categoryId ?? '', 'category');
    if (category.kind !== 'expense') fail('CATEGORY_KIND_MISMATCH', { id: category.id });
  }
}

function validateMove(state: State, tx: TransferTransaction | ExchangeTransaction) {
  assertDate(tx.date, 'date');
  const from = requireById(state.accounts, tx.fromAccountId, 'account');
  const to = requireById(state.accounts, tx.toAccountId, 'account');
  if (tx.fromAccountId === tx.toAccountId) fail('SAME_ACCOUNT_TRANSFER');
  validateFees(state, tx);
  return { from, to };
}

function validateTransfer(state: State, tx: TransferTransaction) {
  assertPositive(tx.amount, 'amount');
  const { from, to } = validateMove(state, tx);
  // A transfer moves the same money: a different currency is an exchange.
  if (from.currency !== to.currency) fail('TRANSFER_CURRENCY_MISMATCH');
}

function validateExchange(state: State, tx: ExchangeTransaction) {
  assertPositive(tx.sentAmount, 'sentAmount');
  assertPositive(tx.receivedAmount, 'receivedAmount');
  const { from, to } = validateMove(state, tx);
  if (from.currency === to.currency) fail('EXCHANGE_SAME_CURRENCY');
}

// Settings with `selection` merged into the remembered form defaults.
function rememberSelection(state: State, selection: LastUsedSelection): Settings {
  return { ...state.settings, lastUsed: { ...state.settings.lastUsed, ...selection } };
}

function addTransactionCore(state: State, raw: NewIncomeExpense, ctx: OpContext): Patch {
  const input = { ...raw, amount: money(raw.amount, raw.currency) };
  const rates = snapshotForNow(state, ctx.now());
  const tx: IncomeExpenseTransaction = stamp(
    {
      ...input,
      id: ctx.newId(),
      createdAt: ctx.now().toISOString(),
      rateSnapshotId: rates.id,
    },
    ctx
  );
  validateIncomeExpense(state, tx);
  return {
    ...ratePatch(rates),
    transactions: [tx, ...state.transactions],
    settings: rememberSelection(state, {
      [tx.type]: { accountId: tx.accountId, categoryId: tx.categoryId },
    }),
  };
}

// --- The cover gate (INV-5) -------------------------------------------------
//
// Every operation that can lower an account's balance ends here. If the final state would leave an account with
// more reserved than it holds, the operation is applied together with a COVER the user chose (reserved money
// released in the same patch), or it throws NeedsCoverError and applies nothing. Going below zero on an account that
// does not allow it needs an explicit confirmation too.

function settle(state: State, patch: Patch, ctx: OpContext, options?: OpOptions, sourceTransactionId?: string): Patch {
  const next: State = { ...state, ...patch };
  const shortfalls = shortfallsBetween(state, next);
  if (shortfalls.length === 0) return patch;

  const unmet: Shortfall[] = [];
  const moves: ReservationMovement[] = [];
  const use = snapshotForNow(next, ctx.now());
  for (const s of shortfalls) {
    if (s.kind === 'negative') {
      if (!options?.confirm?.negative) unmet.push(s);
      continue;
    }
    const mine = (options?.cover ?? []).filter((c) => c.accountId === s.accountId);
    const total = sumIn(mine.map((c) => c.amount), s.currency);
    const fits = mine.every((c) => c.amount > 0 && c.amount <= reservation(next, c.fundId, s.accountId) + 0.005);
    if (!fits || Math.abs(total - s.amount) > 0.005) {
      unmet.push(s);
      continue;
    }
    for (const c of mine) {
      moves.push(newReservation(use.id, c.fundId, s.accountId, -c.amount, 'cover', undefined, ctx, sourceTransactionId ? { sourceTransactionId } : {}));
    }
  }
  if (unmet.length > 0) throw new NeedsCoverError(unmet);
  return {
    ...patch,
    ...ratePatch(use),
    reservationMovements: [...next.reservationMovements, ...moves],
  };
}

const isMove = (tx: Transaction): tx is TransferTransaction | ExchangeTransaction => tx.type === 'transfer' || tx.type === 'exchange';

// Movements that belong to a transfer or exchange: its follow group (groupId = the transaction id, or id:…).
const inGroupOf = (txId: string) => (m: ReservationMovement) => m.groupId === txId || !!m.groupId?.startsWith(`${txId}:`);

// Reserved money that has to leave the source account WITH a transfer or exchange: the part of the amount above what
// is available (after the fees charged to the source, which can never be paid from reserved money without a cover).
// A transfer carries it automatically, split in proportion to each fund's reservation (C3, Q3: editable through
// options.follow, the last fund takes the remainder; Q14: a notice, not a confirmation). An exchange converts it at
// its own recorded rate and needs the user's confirmation first (D2 #2, C4). `state` is the state BEFORE the
// transaction.
function followMovements(
  state: State,
  tx: TransferTransaction | ExchangeTransaction,
  ctx: OpContext,
  options: OpOptions | undefined,
  rateSnapshotId: string
): ReservationMovement[] {
  const from = state.accounts.find((a) => a.id === tx.fromAccountId);
  const to = state.accounts.find((a) => a.id === tx.toAccountId);
  if (!from || !to) return [];
  const sent = tx.type === 'transfer' ? tx.amount : tx.sentAmount;
  const feeOnSource = sumIn(tx.fees.filter((f) => f.accountId === from.id).map((f) => f.amount), from.currency);
  const room = Math.max(0, accountAvailable(state, from.id) - feeOnSource);
  // Lowest-priority LAST, so the last fund takes the rounding remainder; the order the sheet lists them in.
  const reserved = reservationsOn(state, from.id).reverse();
  // At most what is reserved there: anything beyond is a negative balance, which the gate decides.
  const need = Math.min(money(sent - room, from.currency), sumIn(reserved.map((r) => r.amount), from.currency));
  if (need <= 0.005) return [];

  const split = options?.follow ?? proportionalSplit(reserved, need, from.currency);
  const total = sumIn(split.map((s) => s.amount), from.currency);
  const ok = Math.abs(total - need) <= 0.005 && split.every((s) => s.amount > 0 && s.amount <= reservation(state, s.fundId, from.id) + 0.005);
  if (!ok) fail('FOLLOW_INVALID', { id: tx.id });
  if (tx.type === 'exchange' && !options?.confirm?.conversion) {
    throw new NeedsCoverError([{ kind: 'conversion', accountId: from.id, currency: from.currency, amount: need, suggested: split }]);
  }

  const kind: ReservationKind = tx.type === 'transfer' ? 'follow_transfer' : 'follow_exchange';
  // Each fund's amount at the exchange's own rate (received ÷ sent); the parts add up to the converted total.
  const converted =
    tx.type === 'transfer'
      ? split.map((s) => s.amount)
      : splitTo(
          money((need * tx.receivedAmount) / tx.sentAmount, to.currency),
          split.map((s) => s.amount),
          decimalsFor(to.currency)
        );
  const groupId = state.reservationMovements.some(inGroupOf(tx.id)) ? `${tx.id}:${ctx.newId()}` : tx.id;
  return split.flatMap((s, i) => [
    newReservation(rateSnapshotId, s.fundId, from.id, -s.amount, kind, undefined, ctx, { groupId }),
    newReservation(rateSnapshotId, s.fundId, to.id, converted[i], kind, undefined, ctx, { groupId }),
  ]);
}

// Gives back the reservations a transfer or exchange carried: for each fund, what is still reserved on the
// destination (up to what travelled there) returns to the source, at the same rate. If a fund already released or
// spent some of it, only what remains goes back and the rest is validated by the gate (it may need a cover).
function reversalMovements(state: State, tx: TransferTransaction | ExchangeTransaction, ctx: OpContext, rateSnapshotId: string): ReservationMovement[] {
  const group = state.reservationMovements.filter(inGroupOf(tx.id));
  if (group.length === 0) return [];
  const kind: ReservationKind = tx.type === 'transfer' ? 'follow_transfer' : 'follow_exchange';
  const groupId = `${tx.id}:undo:${ctx.newId()}`;
  const out: ReservationMovement[] = [];
  for (const fundId of [...new Set(group.map((m) => m.fundId))]) {
    const net = (accountId: string) => roundIn(sumIn(group.filter((m) => m.fundId === fundId && m.accountId === accountId).map((m) => m.amount), state.accounts.find((a) => a.id === accountId)?.currency ?? 'EGP'), state.accounts.find((a) => a.id === accountId)?.currency ?? 'EGP');
    const atTo = net(tx.toAccountId);
    const atFrom = net(tx.fromAccountId);
    if (atTo <= 0.005) continue;
    const cancel = Math.min(atTo, reservation(state, fundId, tx.toAccountId));
    if (cancel <= 0.005) continue;
    const to = state.accounts.find((a) => a.id === tx.toAccountId)!;
    const from = state.accounts.find((a) => a.id === tx.fromAccountId)!;
    // What goes back to the source is the same fraction of what left it.
    const back = atTo > 0 ? money((cancel / atTo) * -atFrom, from.currency) : 0;
    out.push(newReservation(rateSnapshotId, fundId, to.id, -money(cancel, to.currency), kind, undefined, ctx, { groupId }));
    if (back > 0) out.push(newReservation(rateSnapshotId, fundId, from.id, back, kind, undefined, ctx, { groupId }));
  }
  return out;
}

export function addTransaction(state: State, raw: NewIncomeExpense, ctx: OpContext, options?: OpOptions): Patch {
  const patch = addTransactionCore(state, raw, ctx);
  return settle(state, patch, ctx, options, patch.transactions![0].id);
}

// Same-currency only (a transfer between currencies is addExchange). Fees are spending; the move itself is not.
// Reserved money that has to leave the source account travels with it (see followMovements).
export function addTransfer(state: State, raw: NewTransfer, ctx: OpContext, options?: OpOptions): Patch {
  const patch = addTransferCore(state, raw, ctx);
  const tx = patch.transactions![0] as TransferTransaction;
  const follows = followMovements(state, tx, ctx, options, tx.rateSnapshotId);
  return settle(state, { ...patch, reservationMovements: [...state.reservationMovements, ...follows] }, ctx, options, tx.id);
}

function addTransferCore(state: State, raw: NewTransfer, ctx: OpContext): Patch {
  const use = snapshotForNow(state, ctx.now());
  const from = state.accounts.find((a) => a.id === raw.fromAccountId);
  const input = {
    ...raw,
    amount: from ? money(raw.amount, from.currency) : raw.amount,
    fees: roundFees(state, raw.fees ?? []),
  };
  const tx: TransferTransaction = stamp(
    {
      ...input,
      type: 'transfer' as const,
      id: ctx.newId(),
      createdAt: ctx.now().toISOString(),
      rateSnapshotId: use.id,
    },
    ctx
  );
  validateTransfer(state, tx);
  return {
    ...ratePatch(use),
    transactions: [tx, ...state.transactions],
    settings: rememberSelection(state, {
      transfer: { fromAccountId: tx.fromAccountId, toAccountId: tx.toAccountId },
    }),
  };
}

// A currency exchange: money out of one account in its currency, the amount that actually arrived in
// another, and optional fees. Validated as a whole and written as ONE record, so it is all or nothing. When the
// amount sent goes beyond the source account's available money, the reserved part is converted at the exchange's
// own rate: that needs options.confirm.conversion (otherwise NeedsCoverError with the proposed split).
export function addExchange(state: State, raw: NewExchange, ctx: OpContext, options?: OpOptions): Patch {
  const patch = addExchangeCore(state, raw, ctx);
  const tx = patch.transactions![0] as ExchangeTransaction;
  const follows = followMovements(state, tx, ctx, options, tx.rateSnapshotId);
  return settle(state, { ...patch, reservationMovements: [...state.reservationMovements, ...follows] }, ctx, options, tx.id);
}

function addExchangeCore(state: State, raw: NewExchange, ctx: OpContext): Patch {
  const use = snapshotForNow(state, ctx.now());
  const from = state.accounts.find((a) => a.id === raw.fromAccountId);
  const to = state.accounts.find((a) => a.id === raw.toAccountId);
  const input = {
    ...raw,
    sentAmount: from ? money(raw.sentAmount, from.currency) : raw.sentAmount,
    receivedAmount: to ? money(raw.receivedAmount, to.currency) : raw.receivedAmount,
    fees: roundFees(state, raw.fees ?? []),
  };
  const tx: ExchangeTransaction = stamp(
    {
      ...input,
      type: 'exchange' as const,
      id: ctx.newId(),
      createdAt: ctx.now().toISOString(),
      rateSnapshotId: use.id,
    },
    ctx
  );
  validateExchange(state, tx);
  return {
    ...ratePatch(use),
    transactions: [tx, ...state.transactions],
    settings: rememberSelection(state, {
      exchange: { fromAccountId: tx.fromAccountId, toAccountId: tx.toAccountId },
    }),
  };
}

// The currency a transaction's rates are about: its own, or the source account's for a move between accounts.
function transactionCurrency(state: State, tx: Editable<Transaction>): CurrencyCode | undefined {
  if (tx.type !== 'transfer' && tx.type !== 'exchange') return tx.currency;
  return state.accounts.find((a) => a.id === tx.fromAccountId)?.currency;
}

function validateAssetPurchase(state: State, tx: AssetPurchaseTransaction) {
  assertPositive(tx.amount, 'amount');
  assertDate(tx.date, 'date');
  const account = requireById(state.accounts, tx.accountId, 'account');
  if (tx.currency !== account.currency) fail('CURRENCY_MISMATCH', { entity: 'account' });
  requireById(state.holdings, tx.holdingId, 'holding');
}

function validateTransaction(state: State, tx: Transaction) {
  if (tx.type === 'transfer') validateTransfer(state, tx);
  else if (tx.type === 'exchange') validateExchange(state, tx);
  else if (tx.type === 'asset_purchase') validateAssetPurchase(state, tx);
  else validateIncomeExpense(state, tx);
}

// The holding's cost basis always mirrors its purchase: the amount it was paid in, and the purchase's own rates.
function syncPurchaseCost(
  holdings: Holding[],
  snapshots: readonly RateSnapshot[],
  tx: AssetPurchaseTransaction,
  ctx: OpContext
): Holding[] {
  return holdings.map((h) =>
    h.id === tx.holdingId
      ? stamp(
          { ...h, purchaseCost: { amount: tx.amount, currency: tx.currency }, purchaseRateSnapshotId: tx.rateSnapshotId },
          ctx
        )
      : h
  );
}

// Replaces a transaction. Income/expense/transfer may change into each other, but a gold
// purchase stays a gold purchase (it owns a holding). createdAt and the rate snapshot
// (rateSnapshotId) are kept from the original; the snapshot is re-taken only when the currency
// changes, e.g. when the transaction moves to an account in another currency.
export function updateTransaction(state: State, raw: Editable<Transaction>, ctx: OpContext, options?: OpOptions): Patch {
  const existing = requireById(state.transactions, raw.id, 'transaction');
  // Reverse what the old record carried (reservations of a transfer / exchange), then apply the new values with the
  // same rules; the gate compares the final state with the original one. All or nothing.
  const reversal = isMove(existing) ? reversalMovements(state, existing, ctx, existing.rateSnapshotId) : [];
  const reversed: State = { ...state, reservationMovements: [...state.reservationMovements, ...reversal] };
  const patch = updateTransactionCore(reversed, raw, ctx);
  const updated = patch.transactions!.find((x) => x.id === raw.id)!;
  const follows = isMove(updated)
    ? followMovements({ ...reversed, ...patch, transactions: reversed.transactions.filter((x) => x.id !== raw.id) }, updated, ctx, options, updated.rateSnapshotId)
    : [];
  return settle(
    state,
    { ...patch, reservationMovements: [...reversed.reservationMovements, ...follows] },
    ctx,
    options,
    raw.id
  );
}

function updateTransactionCore(state: State, raw: Editable<Transaction>, ctx: OpContext): Patch {
  const tx = roundTransaction(state, raw);
  const existing = requireById(state.transactions, tx.id, 'transaction');
  if ((existing.type === 'asset_purchase') !== (tx.type === 'asset_purchase')) {
    fail('ASSET_PURCHASE_TYPE_LOCKED', { id: tx.id });
  }
  const currency = transactionCurrency(state, tx);
  const keepRates = !currency || currency === transactionCurrency(state, existing);
  const use = keepRates ? undefined : snapshotForNow(state, ctx.now());
  const { rateSnapshotId: _edited, ...edited } = tx;
  const updated = stamp(
    {
      ...edited,
      createdAt: existing.createdAt,
      rateSnapshotId: use ? use.id : existing.rateSnapshotId,
    },
    ctx
  ) as Transaction;
  validateTransaction(state, updated);
  const snapshots = use?.rateSnapshots ?? state.rateSnapshots;
  return {
    ...(use ? ratePatch(use) : {}),
    transactions: replaceById(state.transactions, updated, 'transaction'),
    ...(updated.type === 'asset_purchase'
      ? { holdings: syncPurchaseCost(state.holdings, snapshots, updated, ctx) }
      : {}),
  };
}

// Deleting a gold purchase also deletes its holding (and unlinks it from funds), atomically:
// otherwise the money would be counted twice, as cash and as gold.
export function deleteTransaction(state: State, id: string, ctx: OpContext, options?: OpOptions): Patch {
  const tx = requireById(state.transactions, id, 'transaction');
  const reversal = isMove(tx) ? reversalMovements(state, tx, ctx, tx.rateSnapshotId) : [];
  const patch = deleteTransactionCore(state, id, ctx);
  return settle(
    state,
    reversal.length > 0 ? { ...patch, reservationMovements: [...state.reservationMovements, ...reversal] } : patch,
    ctx,
    options,
    id
  );
}

function deleteTransactionCore(state: State, id: string, ctx: OpContext): Patch {
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
    // Defaults to the paying account's country (a new purchase) or the holding's own (an edit).
    country?: CountryCode;
    // Defaults to `date`.
    purchaseDate?: string;
    note?: string;
  };
}

function goldHoldingFor(
  input: GoldPurchase,
  id: string,
  purchaseCost: Money,
  purchaseRateSnapshotId: string,
  defaultCountry: CountryCode,
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
    purchaseCost,
    purchaseRateSnapshotId,
    purchaseDate: holding.purchaseDate ?? input.date,
    country: holding.country ?? defaultCountry,
    ...(holding.note?.trim() ? { note: holding.note.trim() } : {}),
  };
}

// Buys gold with cash in one atomic step: a gold holding whose cost is what was paid
// (the amount in EGP at the current rates) and an asset_purchase transaction that takes it out of the account.
// At cost, net worth is unchanged: cash goes down by exactly what the gold goes up.
export function buyGold(state: State, purchase: GoldPurchase, ctx: OpContext, options?: OpOptions): Patch {
  const patch = buyGoldCore(state, purchase, ctx);
  return settle(state, patch, ctx, options, patch.transactions![0].id);
}

function buyGoldCore(state: State, purchase: GoldPurchase, ctx: OpContext): Patch {
  const account = requireById(state.accounts, purchase.accountId, 'account');
  const input = { ...purchase, amount: money(purchase.amount, account.currency) };
  assertPositive(input.amount, 'amount');
  const use = snapshotForNow(state, ctx.now());
  // The cost is what was paid, in the currency it was paid in.
  const holding = goldHoldingFor(input, ctx.newId(), { amount: input.amount, currency: account.currency }, use.id, account.country, ctx);
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
    rateSnapshotId: use.id,
    createdAt: ctx.now().toISOString(),
  };
  const holdings = [...state.holdings, holding];
  validateAssetPurchase({ ...state, holdings }, tx);
  return { ...ratePatch(use), holdings, transactions: [tx, ...state.transactions] };
}

// Edits a gold purchase and its holding together. The rate snapshot is kept unless the
// paying account's currency changes; the holding's cost follows the (new) amount.
export function updateGoldPurchase(state: State, txId: string, purchase: GoldPurchase, ctx: OpContext, options?: OpOptions): Patch {
  return settle(state, updateGoldPurchaseCore(state, txId, purchase, ctx), ctx, options, txId);
}

function updateGoldPurchaseCore(state: State, txId: string, purchase: GoldPurchase, ctx: OpContext): Patch {
  const existing = requireById(state.transactions, txId, 'transaction');
  if (existing.type !== 'asset_purchase') fail('ASSET_PURCHASE_TYPE_LOCKED', { id: txId });
  const previousHolding = requireById(state.holdings, existing.holdingId, 'holding');
  const account = requireById(state.accounts, purchase.accountId, 'account');
  const input = { ...purchase, amount: money(purchase.amount, account.currency) };
  assertPositive(input.amount, 'amount');
  const keepRates = account.currency === existing.currency;
  const use = keepRates ? undefined : snapshotForNow(state, ctx.now());
  const holding: GoldHolding = {
    ...goldHoldingFor(
      input,
      previousHolding.id,
      { amount: input.amount, currency: account.currency },
      use ? use.id : existing.rateSnapshotId,
      previousHolding.country,
      ctx
    ),
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
    ...(use ? { rateSnapshotId: use.id } : {}),
    updatedAt: ctx.now().toISOString(),
  };
  const holdings = replaceById(state.holdings, holding, 'holding');
  validateAssetPurchase({ ...state, holdings }, tx);
  return { ...(use ? ratePatch(use) : {}), holdings, transactions: replaceById(state.transactions, tx, 'transaction') };
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
  assertCurrency(fund.currency);
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

// A fund's target and monthly contribution, in its currency.
const roundFundAmounts = <T extends { currency: CurrencyCode; targetAmount: number; monthlyContribution?: number }>(fund: T): T => ({
  ...fund,
  targetAmount: money(fund.targetAmount, fund.currency),
  ...(fund.monthlyContribution !== undefined ? { monthlyContribution: money(fund.monthlyContribution, fund.currency) } : {}),
});

export function addFund(state: State, input: NewFund, ctx: OpContext): Patch {
  const normalized = normalizeFundShape(roundFundAmounts(input));
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
  const normalized = normalizeFundShape(stamp(roundFundAmounts(fund), ctx) as Fund);
  validateFund(state, normalized, fund.id);
  return { funds: replaceById(state.funds, normalized, 'fund') };
}

// Deleting a fund releases its reservations (the money becomes available again).
export function deleteFund(state: State, id: string, ctx: OpContext): Patch {
  requireById(state.funds, id, 'fund');
  const reservationIds = state.reservationMovements.filter((m) => m.fundId === id).map((m) => m.id);
  const unresolvedIds = state.unresolvedMovements.filter((m) => m.fundId === id).map((m) => m.id);
  return {
    funds: state.funds.filter((f) => f.id !== id),
    reservationMovements: state.reservationMovements.filter((m) => m.fundId !== id),
    unresolvedMovements: state.unresolvedMovements.filter((m) => m.fundId !== id),
    monthlyPlans: state.monthlyPlans.map((p) =>
      p.fundContributions.some((c) => c.fundId === id)
        ? stamp({ ...p, fundContributions: p.fundContributions.filter((c) => c.fundId !== id) }, ctx)
        : p
    ),
    tombstones: [
      ...logDeletes(state, 'fund', [id], ctx),
      ...reservationIds.map((movementId) => tombstone('reservationMovement', movementId, ctx)),
      ...unresolvedIds.map((movementId) => tombstone('unresolvedMovement', movementId, ctx)),
    ],
  };
}

function assertCurrency(currency: CurrencyCode | undefined) {
  if (currency !== undefined && !isKnownCurrency(currency)) fail('UNKNOWN_CURRENCY');
}

// --- Reservations -----------------------------------------------------------
//
// A reservation is money of ONE account set aside for a fund, in that account's currency (INV-2). The
// operations below pick the account by default rules (no prompt) and keep every account's reservations within
// what it holds: reserving more than is available is refused (Q13: release or reallocate first).

function newReservation(
  rateSnapshotId: string,
  fundId: string,
  accountId: string,
  amount: number,
  kind: ReservationKind,
  note: string | undefined,
  ctx: OpContext,
  extra: { groupId?: string; sourceTransactionId?: string } = {}
): ReservationMovement {
  return {
    updatedAt: ctx.now().toISOString(),
    id: ctx.newId(),
    fundId,
    accountId,
    amount,
    kind,
    ...extra,
    date: toDateKey(ctx.now()),
    rateSnapshotId,
    ...(note ? { note } : {}),
  };
}

type ReservationState = Pick<State, 'accounts' | 'transactions' | 'reservationMovements'>;

// Reserves `amount` of `currency` for the fund by the default rules (planReserve: the sheet shows the same plan).
function reserveFor(
  state: ReservationState,
  fundId: string,
  amount: number,
  currency: CurrencyCode,
  note: string | undefined,
  ctx: OpContext,
  rateSnapshotId: string,
  accountId?: string
): ReservationMovement[] {
  return planReserve(state, fundId, amount, currency, accountId).map((s) =>
    newReservation(rateSnapshotId, fundId, s.accountId, s.amount, 'reserve', note, ctx)
  );
}

// Gives `amount` of `currency` back from the fund's reservations (planRelease).
function releaseFrom(
  state: ReservationState,
  fundId: string,
  amount: number,
  currency: CurrencyCode,
  note: string | undefined,
  ctx: OpContext,
  rateSnapshotId: string,
  kind: ReservationKind = 'release',
  accountId?: string
): ReservationMovement[] {
  return planRelease(state, fundId, amount, currency, accountId).map((s) =>
    newReservation(rateSnapshotId, fundId, s.accountId, -s.amount, kind, note, ctx)
  );
}

// Sets `amount` of `currency` aside for the fund (the fund's currency when omitted), from the account with the
// most available money, or from `accountId`. Refused when the accounts cannot cover it.
export function allocateToFund(
  state: State,
  fundId: string,
  amount: number,
  note: string | undefined,
  ctx: OpContext,
  currency?: CurrencyCode,
  accountId?: string
): Patch {
  const fund = requireById(state.funds, fundId, 'fund');
  const value = fundMoney(state, fundId, amount, currency);
  assertPositive(value, 'amount');
  assertCurrency(currency);
  const use = snapshotForNow(state, ctx.now());
  const moves = reserveFor(state, fundId, value, currency ?? fund.currency, note, ctx, use.id, accountId);
  return { ...ratePatch(use), reservationMovements: [...state.reservationMovements, ...moves] };
}

// Takes `amount` of `currency` out of the fund's reservations (the fund's currency when omitted).
export function withdrawFromFund(
  state: State,
  fundId: string,
  amount: number,
  note: string | undefined,
  ctx: OpContext,
  currency?: CurrencyCode,
  accountId?: string
): Patch {
  const fund = requireById(state.funds, fundId, 'fund');
  const value = fundMoney(state, fundId, amount, currency);
  assertPositive(value, 'amount');
  assertCurrency(currency);
  const use = snapshotForNow(state, ctx.now());
  const moves = releaseFrom(state, fundId, value, currency ?? fund.currency, note, ctx, use.id, 'release', accountId);
  return { ...ratePatch(use), reservationMovements: [...state.reservationMovements, ...moves] };
}

// Reserves for several funds at once. All or nothing: each reservation sees the ones before it, so the money
// may not exceed what is available in its currency.
export function allocateMany(
  state: State,
  rawAllocations: FundAmount[],
  note: string | undefined,
  ctx: OpContext
): Patch {
  const allocations = rawAllocations.map((a) => ({ ...a, amount: fundMoney(state, a.fundId, a.amount, a.currency) }));
  if (allocations.length === 0) fail('NOTHING_SELECTED');
  for (const { fundId, amount, currency } of allocations) {
    requireById(state.funds, fundId, 'fund');
    assertPositive(amount, 'amount');
    assertCurrency(currency);
  }
  const use = snapshotForNow(state, ctx.now());
  let draft: ReservationState = state;
  const added: ReservationMovement[] = [];
  for (const { fundId, amount, currency, accountId } of allocations) {
    const fund = requireById(state.funds, fundId, 'fund');
    const moves = reserveFor(draft, fundId, amount, currency ?? fund.currency, note, ctx, use.id, accountId);
    added.push(...moves);
    draft = { ...draft, reservationMovements: [...draft.reservationMovements, ...moves] };
  }
  return { ...ratePatch(use), reservationMovements: [...state.reservationMovements, ...added] };
}

// Releases from several funds at once. All or nothing: no fund may go below zero in any currency.
export function withdrawMany(
  state: State,
  rawWithdrawals: FundAmount[],
  note: string | undefined,
  ctx: OpContext
): Patch {
  const withdrawals = rawWithdrawals.map((w) => ({ ...w, amount: fundMoney(state, w.fundId, w.amount, w.currency) }));
  if (withdrawals.length === 0) fail('NOTHING_SELECTED');
  for (const { fundId, amount, currency } of withdrawals) {
    requireById(state.funds, fundId, 'fund');
    assertPositive(amount, 'amount');
    assertCurrency(currency);
  }
  const use = snapshotForNow(state, ctx.now());
  let draft: ReservationState = state;
  const added: ReservationMovement[] = [];
  for (const { fundId, amount, currency, accountId } of withdrawals) {
    const fund = requireById(state.funds, fundId, 'fund');
    const moves = releaseFrom(draft, fundId, amount, currency ?? fund.currency, note, ctx, use.id, 'release', accountId);
    added.push(...moves);
    draft = { ...draft, reservationMovements: [...draft.reservationMovements, ...moves] };
  }
  return { ...ratePatch(use), reservationMovements: [...state.reservationMovements, ...added] };
}

// Edits a fund's details and sets its cash allocation in one atomic patch. The allocation changes by reserving the
// difference (an increase may not exceed what is available) or releasing it (the fund's own currency first, then
// the others at today's rate: see withdrawalPlan). Omitted optional fields keep their current values, except
// `deadline`, which is cleared.
export function editFund(state: State, fundId: string, edit: FundEdit, ctx: OpContext): Patch {
  const fund = requireById(state.funds, fundId, 'fund');
  const { deadline: _previousDeadline, frequency, nextDueDate, ...rest } = fund;
  const updated = normalizeFundShape<Fund>({
    ...rest,
    updatedAt: ctx.now().toISOString(),
    name: edit.name.trim(),
    targetAmount: money(edit.targetAmount, fund.currency),
    type: edit.type ?? fund.type,
    priority: edit.priority ?? fund.priority,
    linkedHoldingIds: edit.linkedHoldingIds ?? fund.linkedHoldingIds,
    ...(edit.deadline ? { deadline: edit.deadline } : {}),
    ...((edit.frequency ?? frequency) ? { frequency: edit.frequency ?? frequency } : {}),
    ...((edit.nextDueDate ?? nextDueDate) ? { nextDueDate: edit.nextDueDate ?? nextDueDate } : {}),
  });
  validateFund(state, updated, fundId);
  const cashAllocation = money(edit.cashAllocation, fund.currency);
  assertNonNegative(cashAllocation, 'cashAllocation');

  const use = snapshotForNow(state, ctx.now());
  const change = money(cashAllocation - fundAllocated(state, fundId), fund.currency);
  let moves: ReservationMovement[] = [];
  if (change >= 0.005) {
    moves = reserveFor(state, fundId, change, fund.currency, 'تعديل الرصيد', ctx, use.id);
  } else if (change <= -0.005) {
    const plan = withdrawalPlan(state, fundId, -change, fund.currency);
    // What the fund's reservations cannot give (e.g. a migrated movement not yet assigned to an account).
    if (plan.shortfall > 0.005) fail('WITHDRAW_EXCEEDS_FUND', { id: fundId });
    let draft: ReservationState = state;
    for (const w of plan.withdrawals) {
      const released = releaseFrom(draft, fundId, fundMoney(state, fundId, w.amount, w.currency), w.currency ?? fund.currency, 'تعديل الرصيد', ctx, use.id);
      moves.push(...released);
      draft = { ...draft, reservationMovements: [...draft.reservationMovements, ...released] };
    }
  }
  return {
    ...(moves.length > 0 ? ratePatch(use) : {}),
    funds: replaceById(state.funds, updated, 'fund'),
    reservationMovements: moves.length > 0 ? [...state.reservationMovements, ...moves] : state.reservationMovements,
  };
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

// Records a sinking fund's bill as one atomic step: the expense transaction, a `spend` movement consuming the
// fund's reservation on the paying account (as much as it holds there; the rest of the bill is paid from the
// account's available money), and nextDueDate advanced by one cycle.
export function paySinkingFund(state: State, payment: SinkingPayment, ctx: OpContext, options?: OpOptions): Patch {
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
    addTransactionCore(
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
  const paid = draft.transactions[0];
  const use = snapshotForNow(draft, ctx.now());
  const spent = Math.min(money(payment.amount, account.currency), reservation(draft, fund.id, account.id));
  if (spent > 0) {
    apply({
      ...ratePatch(use),
      reservationMovements: [
        ...draft.reservationMovements,
        newReservation(use.id, fund.id, account.id, -spent, 'spend', `اتدفعت: ${fund.name}`, ctx, { sourceTransactionId: paid.id }),
      ],
    });
  }

  const nextDue = addMonthsToDate(fund.nextDueDate, SINKING_CYCLE_MONTHS[fund.frequency]);
  apply({
    funds: draft.funds.map((f) => (f.id === fund.id ? stamp({ ...f, nextDueDate: nextDue }, ctx) : f)),
  });

  // D12: the fund's own reservation on the paying account is spent first, then the account's available money; if
  // that is still not enough the gate asks for a cover. A bill is never paid silently from other funds' money.
  return settle(
    state,
    {
      transactions: draft.transactions,
      reservationMovements: draft.reservationMovements,
      funds: draft.funds,
      settings: draft.settings,
      rateSnapshots: draft.rateSnapshots,
    },
    ctx,
    options,
    paid.id
  );
}

// --- Holdings ---------------------------------------------------------------

function validateHolding(holding: NewHolding) {
  assertName(holding.name, 'holding');
  assertCountry(holding.country);
  assertNonNegative(holding.purchaseCost.amount, 'purchaseCost');
  assertCurrency(holding.purchaseCost.currency);
  if (holding.purchaseDate !== undefined) assertDate(holding.purchaseDate, 'purchaseDate');
  if (holding.type === 'gold') {
    assertPositive(holding.weightGrams, 'weightGrams');
    if (![18, 21, 24].includes(holding.karat)) fail('INVALID_KARAT');
  } else {
    assertPositive(holding.quantity, 'quantity');
    assertCurrency(holding.currency);
  }
}

// A holding's cost is in the currency it was paid in; a currency holding's quantity is in that currency.
const roundHolding = <T extends NewHolding | Editable<Holding>>(holding: T): T => ({
  ...holding,
  purchaseCost: { ...holding.purchaseCost, amount: money(holding.purchaseCost.amount, holding.purchaseCost.currency) },
  ...(holding.type === 'currency' ? { quantity: money(holding.quantity, holding.currency) } : {}),
});

export function addHolding(state: State, raw: NewHolding, ctx: OpContext): Patch {
  const input = roundHolding(raw);
  validateHolding(input);
  const use = snapshotForNow(state, ctx.now());
  const holding = stamp({ ...input, id: ctx.newId(), purchaseRateSnapshotId: use.id }, ctx) as Holding;
  return { ...ratePatch(use), holdings: [...state.holdings, holding] };
}

export function updateHolding(state: State, raw: Editable<Holding>, ctx: OpContext): Patch {
  const holding = roundHolding(raw);
  validateHolding(holding);
  const existing = requireById(state.holdings, holding.id, 'holding');
  // The purchase rates are kept unless the cost moved to another currency.
  const use = existing.purchaseCost.currency === holding.purchaseCost.currency ? undefined : snapshotForNow(state, ctx.now());
  const updated = stamp({ ...holding, purchaseRateSnapshotId: use ? use.id : existing.purchaseRateSnapshotId }, ctx) as Holding;
  return { ...(use ? ratePatch(use) : {}), holdings: replaceById(state.holdings, updated, 'holding') };
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
  assertCountry(liability.country);
  assertCurrency(liability.currency);
  assertPositive(liability.principal, 'principal');
  if (liability.monthlyPayment !== undefined) assertPositive(liability.monthlyPayment, 'monthlyPayment');
  assertDate(liability.startDate, 'startDate');
}

const roundLiability = <T extends NewLiability | Editable<Liability>>(l: T): T => ({
  ...l,
  principal: money(l.principal, l.currency),
  ...(l.monthlyPayment !== undefined ? { monthlyPayment: money(l.monthlyPayment, l.currency) } : {}),
});

export function addLiability(state: State, raw: NewLiability, ctx: OpContext): Patch {
  const input = roundLiability(raw);
  validateLiability(input);
  return { liabilities: [...state.liabilities, stamp({ ...input, id: ctx.newId() }, ctx)] };
}

export function updateLiability(state: State, raw: Editable<Liability>, ctx: OpContext): Patch {
  const liability = roundLiability(raw);
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
  if (rule.kind === 'transfer' || rule.kind === 'exchange') {
    const to = requireById(state.accounts, rule.toAccountId ?? '', 'account');
    if (to.id === account.id) fail('SAME_ACCOUNT_TRANSFER');
    if (rule.kind === 'transfer') {
      if (to.currency !== account.currency) fail('TRANSFER_CURRENCY_MISMATCH');
    } else {
      if (to.currency === account.currency) fail('EXCHANGE_SAME_CURRENCY');
      // What arrives each time is part of the rule; an unknown executed rate is never guessed, so it is
      // always confirmed by the user.
      assertPositive(rule.toAmount ?? NaN, 'receivedAmount');
      if (rule.mode !== 'confirm') fail('INVALID_MODE');
    }
  } else {
    const category = requireById(state.categories, rule.categoryId ?? '', 'category');
    if (category.kind !== rule.kind) fail('CATEGORY_KIND_MISMATCH', { id: category.id });
  }
}

// Drops fields that don't belong to the rule's kind (category vs target account).
function normalizeRuleShape<T extends NewRecurringRule>(rule: T): T {
  const { categoryId, toAccountId, toAmount, ...rest } = rule;
  return (
    rule.kind === 'exchange'
      ? { ...rest, toAccountId, ...(toAmount !== undefined ? { toAmount } : {}) }
      : rule.kind === 'transfer'
        ? { ...rest, toAccountId }
        : { ...rest, categoryId }
  ) as T;
}

const todayOf = (ctx: OpContext) => toDateKey(ctx.now());

function withNextDate(state: State, rule: RecurringRule, ctx: OpContext): RecurringRule {
  return { ...rule, nextDate: nextOccurrence(state, rule, todayOf(ctx)) };
}

// Creates a rule. `linkTransactionId` ("خليها متكررة") links that existing transaction as the
// occurrence on its date — when the date is an occurrence of the rule — so it isn't due again.
// A rule's amount is in its currency; an exchange's toAmount in the target account's.
function roundRule<T extends NewRecurringRule | Editable<RecurringRule>>(state: State, rule: T): T {
  const to = rule.toAccountId ? state.accounts.find((a) => a.id === rule.toAccountId) : undefined;
  return {
    ...rule,
    amount: money(rule.amount, rule.currency),
    ...(rule.toAmount !== undefined ? { toAmount: to ? money(rule.toAmount, to.currency) : rule.toAmount } : {}),
  };
}

export function addRecurringRule(
  state: State,
  raw: NewRecurringRule,
  ctx: OpContext,
  linkTransactionId?: string
): Patch {
  const normalized = normalizeRuleShape(roundRule(state, raw));
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
  const normalized = normalizeRuleShape(roundRule(state, rule));
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
  ctx: OpContext,
  rateSnapshotId: string
): Transaction {
  const account = requireById(state.accounts, overrides.accountId ?? rule.accountId, 'account');
  const amount = money(overrides.amount ?? rule.amount, account.currency);
  const note = overrides.note?.trim() || rule.note || rule.name;
  const base = {
    id: ctx.newId(),
    date: overrides.date ?? occurrenceDate,
    note,
    rateSnapshotId,
    createdAt: ctx.now().toISOString(),
    recurringRuleId: rule.id,
    occurrenceDate,
  };
  if (rule.kind === 'transfer') {
    const to = requireById(state.accounts, rule.toAccountId ?? '', 'account');
    const tx: TransferTransaction = stamp(
      { ...base, type: 'transfer' as const, amount, fromAccountId: account.id, toAccountId: to.id, fees: [] },
      ctx
    );
    validateTransfer(state, tx);
    return tx;
  }
  if (rule.kind === 'exchange') {
    const to = requireById(state.accounts, rule.toAccountId ?? '', 'account');
    // What arrives is the rule's received amount, never today's rate. A different amount needs its own
    // received amount (the user confirms it).
    const receivedAmount = money(
      overrides.toAmount ?? (overrides.amount === undefined ? (rule.toAmount ?? NaN) : NaN),
      to.currency
    );
    const tx: ExchangeTransaction = stamp(
      {
        ...base,
        type: 'exchange' as const,
        sentAmount: amount,
        receivedAmount,
        fromAccountId: account.id,
        toAccountId: to.id,
        fees: [],
      },
      ctx
    );
    validateExchange(state, tx);
    return tx;
  }
  const tx: IncomeExpenseTransaction = stamp(
    { ...base, type: rule.kind, amount, currency: account.currency, accountId: account.id, categoryId: rule.categoryId ?? '' },
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
  return processDueCore(state, ctx).patch;
}

// The auto occurrences processDue could NOT record because they would eat into reserved money (or an account that
// does not allow it going below zero): they stay due, flagged "محتاج تغطية", and the user confirms them with a cover.
export interface BlockedOccurrence {
  ruleId: string;
  date: string;
  shortfalls: Shortfall[];
}

export function blockedDue(state: State, ctx: OpContext): BlockedOccurrence[] {
  return processDueCore(state, ctx).blocked;
}

function processDueCore(state: State, ctx: OpContext): { patch: Patch; blocked: BlockedOccurrence[] } {
  const due = dueOccurrences(state, todayOf(ctx), 'auto');
  if (due.length === 0) return { patch: {}, blocked: [] };
  const use = snapshotForNow(state, ctx.now());
  // Each occurrence is checked against what the earlier ones already did (INV-5): there is no user to ask.
  let draft: State = state;
  const created: Transaction[] = [];
  const touched = new Set<string>();
  const blocked: BlockedOccurrence[] = [];
  for (const { rule, date } of due) {
    try {
      const tx = occurrenceTransaction(draft, rule, date, {}, ctx, use.id);
      const follows = isMove(tx) && tx.type === 'transfer' ? followMovements(draft, tx, ctx, undefined, use.id) : [];
      const next: State = { ...draft, transactions: [tx, ...draft.transactions], reservationMovements: [...draft.reservationMovements, ...follows] };
      const shortfalls = shortfallsBetween(draft, next);
      if (shortfalls.length > 0) {
        blocked.push({ ruleId: rule.id, date, shortfalls });
        continue;
      }
      draft = next;
      created.push(tx);
      touched.add(rule.id);
    } catch (error) {
      if (!(error instanceof FinanceValidationError) && !(error instanceof NeedsCoverError)) throw error;
    }
  }
  if (created.length === 0) return { patch: {}, blocked };
  const transactions = [...created].reverse().concat(state.transactions);
  const after = { ...state, transactions };
  return {
    blocked,
    patch: {
      ...ratePatch(use),
      transactions,
      ...(draft.reservationMovements !== state.reservationMovements ? { reservationMovements: draft.reservationMovements } : {}),
      recurringRules: state.recurringRules.map((r) => (touched.has(r.id) ? stamp(withNextDate(after, r, ctx), ctx) : r)),
    },
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
  ctx: OpContext,
  options?: OpOptions
): Patch {
  const rule = requireDue(state, ruleId, occurrenceDate);
  const use = snapshotForNow(state, ctx.now());
  const tx = occurrenceTransaction(state, rule, occurrenceDate, overrides, ctx, use.id);
  const follows = isMove(tx) ? followMovements(state, tx, ctx, options, use.id) : [];
  const transactions = [tx, ...state.transactions];
  return settle(
    state,
    {
      ...ratePatch(use),
      transactions,
      reservationMovements: [...state.reservationMovements, ...follows],
      recurringRules: replaceById(
        state.recurringRules,
        stamp(withNextDate({ ...state, transactions }, rule, ctx), ctx),
        'recurringRule'
      ),
    },
    ctx,
    options,
    tx.id
  );
}

// "تخطّي": marks one occurrence as skipped.
export function skipOccurrence(state: State, ruleId: string, occurrenceDate: string, ctx: OpContext): Patch {
  const rule = requireDue(state, ruleId, occurrenceDate);
  const updated = stamp({ ...rule, skippedDates: [...rule.skippedDates, occurrenceDate] }, ctx);
  return { recurringRules: replaceById(state.recurringRules, withNextDate(state, updated, ctx), 'recurringRule') };
}

// --- Monthly plans ----------------------------------------------------------

export type PlanInput = Omit<MonthlyPlan, 'id' | 'createdAt' | 'updatedAt'>;


function validatePlan(state: State, plan: PlanInput) {
  if (!isMonthKey(plan.month)) fail('INVALID_MONTH');
  assertCurrency(plan.currency);
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
// A plan's income, limits and contributions, in the plan's currency.
const roundPlan = (plan: PlanInput): PlanInput => ({
  ...plan,
  expectedIncome: money(plan.expectedIncome, plan.currency),
  lines: plan.lines.map((l) => ({ ...l, limit: money(l.limit, plan.currency) })),
  fundContributions: plan.fundContributions.map((c) => ({ ...c, amount: money(c.amount, plan.currency) })),
});

export function savePlan(state: State, raw: PlanInput, ctx: OpContext): Patch {
  const input = roundPlan(raw);
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
  return syncSnapshots(state, ctx.now()) ?? {};
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

// The two rates the Settings screen edits: how many EGP one SAR / one USD is worth.
export interface EgpRatesInput {
  SAR_EGP: number;
  USD_EGP: number;
}

export function updateRates(state: State, rates: EgpRatesInput & { lastUpdated: string }): Patch {
  assertPositive(rates.SAR_EGP, 'exchangeRate');
  assertPositive(rates.USD_EGP, 'exchangeRate');
  return {
    settings: {
      ...state.settings,
      rates: { ...withEgpRates(state.settings.rates, rates), updatedAt: rates.lastUpdated, source: 'manual' },
    },
  };
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
    const same = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
    const unchanged =
      same(update.exchangeRates.SAR_EGP, rateToEGP('SAR', settings.rates)) &&
      same(update.exchangeRates.USD_EGP, rateToEGP('USD', settings.rates));
    if (!unchanged) {
      settings.rates = { ...withEgpRates(settings.rates, update.exchangeRates), updatedAt: now, source: 'manual' };
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

export interface CurrencyPreferences {
  reportingCurrency?: CurrencyCode;
  planCurrency?: CurrencyCode;
}

// The currency totals are shown in, and the one a new monthly plan starts in. Either must be one the app
// offers (enabled); neither changes a stored amount.
export function setCurrencyPreferences(state: State, prefs: CurrencyPreferences, _ctx: OpContext): Patch {
  const settings = { ...state.settings };
  for (const key of ['reportingCurrency', 'planCurrency'] as const) {
    const code = prefs[key];
    if (code === undefined) continue;
    assertCurrency(code);
    if (!settings.enabledCurrencies.includes(code)) fail('UNKNOWN_CURRENCY');
    settings[key] = code;
  }
  return { settings };
}

export interface PricePreferences {
  priceSource?: PriceSource;
  localPremiumPct?: number;
}

// "تلقائي / يدوي" and "فرق السوق المحلي %". In auto mode a new premium re-prices gold from the
// last fetched world price right away (no request needed); manual prices are never touched.
export function setPricePreferences(state: State, prefs: PricePreferences, ctx: OpContext): Patch {
  const settings = { ...state.settings };
  if (prefs.priceSource !== undefined) {
    if (prefs.priceSource !== 'auto' && prefs.priceSource !== 'manual') fail('INVALID_MODE');
    settings.priceSource = prefs.priceSource;
  }
  if (prefs.localPremiumPct !== undefined) {
    if (!isValidPremiumPct(prefs.localPremiumPct)) fail('NOT_A_NUMBER', { field: 'localPremiumPct' });
    settings.localPremiumPct = prefs.localPremiumPct;
  }
  const premiumChanged = (settings.localPremiumPct ?? 0) !== (state.settings.localPremiumPct ?? 0);
  if (priceSourceOf(settings) === 'auto' && premiumChanged && settings.lastGoldUsdPerOunce) {
    Object.assign(
      settings,
      goldPricesEGP(settings.lastGoldUsdPerOunce, settings.rates.perUsd.EGP, settings.localPremiumPct),
      { goldPriceUpdatedAt: ctx.now().toISOString() }
    );
  }
  return { settings };
}

// First launch only: a fresh install (nothing was saved on the device yet) starts in auto mode.
// Saved data without the setting — an install from before live prices — stays manual (missing
// = manual), so prices the user typed are never replaced until they choose "تلقائي".
export function ensurePriceSource(state: State, freshInstall: boolean): Patch {
  if (!freshInstall || state.settings.priceSource !== undefined) return {};
  return { settings: { ...state.settings, priceSource: 'auto' } };
}

// Applies a live price fetch. Manual mode is never overwritten ({}). Auto mode: fetched rates
// replace the rate table, a fetched world gold price (with usable rates) replaces the gold
// prices, each with a fresh "updated" date; whatever failed keeps its last saved value and the
// error is recorded. Only settings change, so recorded amounts keep their own rate snapshots.
export function applyLivePrices(state: State, result: PriceFetchResult, ctx: OpContext): Patch {
  if (priceSourceOf(state.settings) !== 'auto') return {};
  const now = ctx.now().toISOString();
  const { lastPriceFetchError: _previousError, ...settings } = state.settings;
  if (result.fx) {
    settings.rates = {
      base: 'USD',
      perUsd: { ...settings.rates.perUsd, ...result.fx.perUsd },
      updatedAt: now,
      source: result.fxSource ?? settings.rates.source,
    };
    settings.lastPriceFetchAt = now;
    if (result.fxSource) settings.fxSource = result.fxSource;
    if (result.xauUsd !== null) {
      Object.assign(settings, goldPricesEGP(result.xauUsd, result.fx.perUsd.EGP, settings.localPremiumPct ?? 0), {
        goldPriceUpdatedAt: now,
        lastGoldUsdPerOunce: result.xauUsd,
      });
    }
  }
  return { settings: { ...settings, ...(result.error ? { lastPriceFetchError: result.error } : {}) } };
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

// How prices are maintained (auto / manual, premium, last fetch): kept with the prices
// themselves when the data set is replaced by the seed.
function pricePreferences(state: State): Partial<Settings> {
  const { priceSource, localPremiumPct, lastPriceFetchAt, lastPriceFetchError, fxSource, lastGoldUsdPerOunce } = state.settings;
  const kept = { priceSource, localPremiumPct, lastPriceFetchAt, lastPriceFetchError, fxSource, lastGoldUsdPerOunce };
  return Object.fromEntries(Object.entries(kept).filter(([, value]) => value !== undefined));
}

const COLLECTIONS: { key: Exclude<keyof State, 'settings' | 'tombstones' | 'rateSnapshots'>; entity: SyncEntity }[] = [
  { key: 'accounts', entity: 'account' },
  { key: 'categories', entity: 'category' },
  { key: 'transactions', entity: 'transaction' },
  { key: 'funds', entity: 'fund' },
  { key: 'reservationMovements', entity: 'reservationMovement' },
  { key: 'unresolvedMovements', entity: 'unresolvedMovement' },
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

  // Rate snapshots are immutable and content-addressed (no tombstones); the records now in the state point at the incoming ones.
  const patch: Patch = { settings, rateSnapshots: next.rateSnapshots };
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
      rates: state.settings.rates,
      goldPrice24kEGP: state.settings.goldPrice24kEGP,
      goldPrice21kEGP: state.settings.goldPrice21kEGP,
      goldPriceUpdatedAt: state.settings.goldPriceUpdatedAt,
      ...pricePreferences(state),
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
