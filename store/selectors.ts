import { fromEGP, toEGP } from '@/utils/currency';
import { monthOf, monthsUntil, shiftMonth, toMonthKey } from '@/utils/dates';
import type {
  Account,
  Category,
  CurrencyCode,
  ExpenseBucket,
  FinanceState,
  Fund,
  GoldKarat,
  Holding,
  IncomeExpenseTransaction,
  Liability,
  Location,
  SinkingFrequency,
  Transaction,
} from './types';

// Single source of truth for every derived financial figure. All functions are pure.
// Balances and holdings are valued at CURRENT rates/prices (what they're worth now);
// transaction flows use each transaction's snapshotted rateToEGP (what they were worth then).

type State = FinanceState;

const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

const isIncomeExpense = (tx: Transaction): tx is IncomeExpenseTransaction =>
  tx.type === 'income' || tx.type === 'expense';

// --- Accounts ---------------------------------------------------------------

type LiquidState = Pick<State, 'accounts' | 'transactions' | 'settings'>;

// Net effect of all transactions on the account, in its own currency.
export function accountNetFlow(state: Pick<State, 'transactions'>, accountId: string): number {
  let flow = 0;
  for (const tx of state.transactions) {
    if (tx.type === 'transfer') {
      if (tx.fromAccountId === accountId) flow -= tx.amount;
      if (tx.toAccountId === accountId) flow += tx.toAmount;
    } else if (tx.accountId === accountId) {
      // Expenses and asset purchases both take money out of the account.
      flow += tx.type === 'income' ? tx.amount : -tx.amount;
    }
  }
  return flow;
}

// Balance in the account's own currency.
export function accountBalance(state: Pick<State, 'accounts' | 'transactions'>, accountId: string): number {
  const account = state.accounts.find((a) => a.id === accountId);
  if (!account) return 0;
  return account.openingBalance + accountNetFlow(state, accountId);
}

// The openingBalance that makes the derived balance equal `currentBalance`.
export function openingBalanceForCurrentBalance(
  state: Pick<State, 'transactions'>,
  accountId: string,
  currentBalance: number
): number {
  return currentBalance - accountNetFlow(state, accountId);
}

export function accountBalanceEGP(state: LiquidState, account: Account): number {
  return toEGP(accountBalance(state, account.id), account.currency, state.settings.exchangeRates);
}

// Archived accounts still hold money, so they count.
export function liquidTotalEGP(state: LiquidState): number {
  return sum(state.accounts.map((a) => accountBalanceEGP(state, a)));
}

// --- Holdings ---------------------------------------------------------------

// EGP per gram for a karat: 24k and 21k have their own market prices; 18k derives from 24k.
export function goldPricePerGram(settings: State['settings'], karat: GoldKarat): number {
  if (karat === 24) return settings.goldPrice24kEGP;
  if (karat === 21) return settings.goldPrice21kEGP;
  return settings.goldPrice24kEGP * 0.75;
}

export function holdingValueEGP(state: Pick<State, 'settings'>, holding: Holding): number {
  if (holding.type === 'gold') {
    return holding.weightGrams * goldPricePerGram(state.settings, holding.karat);
  }
  return toEGP(holding.quantity, holding.currency, state.settings.exchangeRates);
}

export function holdingPnlEGP(state: State, holding: Holding): number {
  return holdingValueEGP(state, holding) - holding.purchaseCostEGP;
}

export function holdingsTotalEGP(state: State): number {
  return sum(state.holdings.map((h) => holdingValueEGP(state, h)));
}

export function totalAssetsEGP(state: State): number {
  return liquidTotalEGP(state) + holdingsTotalEGP(state);
}

// --- Liabilities ------------------------------------------------------------

// In the liability's currency. Payments are expense transactions tagged with liabilityId
// (the store enforces they share the liability's currency).
export function liabilityRemaining(state: State, liability: Liability): number {
  const paid = sum(
    state.transactions
      .filter(isIncomeExpense)
      .filter((tx) => tx.type === 'expense' && tx.liabilityId === liability.id)
      .map((tx) => tx.amount)
  );
  return Math.max(0, liability.principal - paid);
}

export function liabilitiesTotalEGP(state: State): number {
  return sum(
    state.liabilities.map((l) =>
      toEGP(liabilityRemaining(state, l), l.currency, state.settings.exchangeRates)
    )
  );
}

export function netWorthEGP(state: State): number {
  return liquidTotalEGP(state) + holdingsTotalEGP(state) - liabilitiesTotalEGP(state);
}

// Net worth split by where things are. Holdings without a location count as Egypt, and so
// do liabilities (they have no location), so EG + SA always equals netWorthEGP.
export function netWorthByLocation(state: State): Record<Location, number> {
  const result: Record<Location, number> = { EG: 0, SA: 0 };
  for (const account of state.accounts) result[account.location] += accountBalanceEGP(state, account);
  for (const holding of state.holdings) result[holding.location ?? 'EG'] += holdingValueEGP(state, holding);
  result.EG -= liabilitiesTotalEGP(state);
  return result;
}

// Account balances summed per currency, in that currency (no conversion).
export function liquidByCurrency(state: LiquidState): Record<CurrencyCode, number> {
  const result: Record<CurrencyCode, number> = { EGP: 0, SAR: 0, USD: 0 };
  for (const account of state.accounts) result[account.currency] += accountBalance(state, account.id);
  return result;
}

export interface GoldTotals {
  totalGrams: number;
  gramsByKarat: Record<GoldKarat, number>;
  totalCostEGP: number;
}

export function goldTotals(state: Pick<State, 'holdings'>): GoldTotals {
  const totals: GoldTotals = { totalGrams: 0, gramsByKarat: { 18: 0, 21: 0, 24: 0 }, totalCostEGP: 0 };
  for (const h of state.holdings) {
    if (h.type !== 'gold') continue;
    totals.totalGrams += h.weightGrams;
    totals.gramsByKarat[h.karat] += h.weightGrams;
    totals.totalCostEGP += h.purchaseCostEGP;
  }
  return totals;
}

// --- Funds ------------------------------------------------------------------

function findFund(state: State, fundId: string): Fund | undefined {
  return state.funds.find((f) => f.id === fundId);
}

// Cash allocated to the fund (fund currency): sum of its movements.
export function fundAllocated(state: State, fundId: string): number {
  return sum(state.fundMovements.filter((m) => m.fundId === fundId).map((m) => m.amount));
}

// Market value of the fund's linked holdings, in the fund's currency.
export function fundLinkedValue(state: State, fundId: string): number {
  const fund = findFund(state, fundId);
  if (!fund) return 0;
  const linkedEGP = sum(
    state.holdings
      .filter((h) => fund.linkedHoldingIds.includes(h.id))
      .map((h) => holdingValueEGP(state, h))
  );
  return fromEGP(linkedEGP, fund.currency, state.settings.exchangeRates);
}

// Fund currency: cash movements + market value of linked holdings.
export function fundCurrent(state: State, fundId: string): number {
  return fundAllocated(state, fundId) + fundLinkedValue(state, fundId);
}

// 0..∞ (can exceed 1 when over-funded). A non-positive target counts as complete.
export function fundProgress(state: State, fundId: string): number {
  const fund = findFund(state, fundId);
  if (!fund) return 0;
  if (fund.targetAmount <= 0) return 1;
  return Math.max(0, fundCurrent(state, fundId) / fund.targetAmount);
}

// When the target must be reached: the deadline for goals, the next due date for sinking funds.
export function fundDueDate(fund: Fund): string | undefined {
  return fund.type === 'sinking' ? fund.nextDueDate : fund.deadline;
}

export const SINKING_CYCLE_MONTHS: Record<SinkingFrequency, number> = {
  yearly: 12,
  semiannual: 6,
  quarterly: 3,
};

// Fund currency per month to hit the target by the due date; null without one.
export function fundRequiredMonthly(state: State, fundId: string, now: Date = new Date()): number | null {
  const fund = findFund(state, fundId);
  const due = fund && fundDueDate(fund);
  if (!fund || !due) return null;
  const remaining = Math.max(0, fund.targetAmount - fundCurrent(state, fundId));
  return remaining / monthsUntil(due, now);
}

// Sinking funds: the full cycle amount spread over the months until it is due (ignores what
// is already saved, unlike fundRequiredMonthly). null for other funds or without a schedule.
export function sinkingMonthlySuggestion(
  fund: Pick<Fund, 'type' | 'targetAmount' | 'nextDueDate'>,
  now: Date = new Date()
): number | null {
  if (fund.type !== 'sinking' || !fund.nextDueDate) return null;
  return fund.targetAmount / monthsUntil(fund.nextDueDate, now);
}

export type FundStatus = 'ahead' | 'on_track' | 'behind' | 'no_deadline';

// Compares this month's net allocations with what was required at the START of the month
// (so allocating this month doesn't shrink its own requirement).
// behind: < required · on_track: required…110% · ahead: > 110% or target already reached.
export function fundStatus(state: State, fundId: string, now: Date = new Date()): FundStatus {
  const fund = findFund(state, fundId);
  const due = fund && fundDueDate(fund);
  if (!fund || !due) return 'no_deadline';

  const month = toMonthKey(now);
  const allocatedThisMonth = sum(
    state.fundMovements
      .filter((m) => m.fundId === fundId && monthOf(m.date) === month)
      .map((m) => m.amount)
  );
  const currentAtMonthStart = fundCurrent(state, fundId) - allocatedThisMonth;
  const remainingAtMonthStart = Math.max(0, fund.targetAmount - currentAtMonthStart);
  const required = remainingAtMonthStart / monthsUntil(due, now);

  if (required <= 0) return 'ahead';
  if (allocatedThisMonth < required) return 'behind';
  return allocatedThisMonth > required * 1.1 ? 'ahead' : 'on_track';
}

// Active funds, highest priority (lowest number) first.
export function fundsByPriority(state: Pick<State, 'funds'>): Fund[] {
  return state.funds.filter((f) => !f.archived).sort((a, b) => a.priority - b.priority);
}

// Gold/currency holdings that `fundId` may link: unlinked ones plus its own.
export function linkableHoldings(state: State, fundId?: string): Holding[] {
  return state.holdings.filter(
    (h) => !state.funds.some((f) => f.id !== fundId && f.linkedHoldingIds.includes(h.id))
  );
}

// Liquid money not yet earmarked by any fund (cash movements only; linked holdings
// are not cash). Negative means more is allocated than the accounts hold.
export function unassignedEGP(state: State): number {
  const rates = state.settings.exchangeRates;
  const allocatedEGP = sum(
    state.fundMovements.map((m) => {
      const fund = findFund(state, m.fundId);
      return fund ? toEGP(m.amount, fund.currency, rates) : 0;
    })
  );
  return liquidTotalEGP(state) - allocatedEGP;
}

// unassignedEGP if the fund's cash allocation were set to `cashAllocation` (fund currency).
// Used to preview an edit before saving and to validate it.
export function unassignedEGPWithFundCash(
  state: State,
  fundId: string,
  cashAllocation: number
): number {
  const fund = findFund(state, fundId);
  if (!fund) return unassignedEGP(state);
  const change = cashAllocation - fundAllocated(state, fundId);
  return unassignedEGP(state) - toEGP(change, fund.currency, state.settings.exchangeRates);
}

// --- Distributing and covering ---------------------------------------------

export interface FundAmount {
  fundId: string;
  amount: number; // fund currency
}

// Sum of `amounts` in EGP at current rates (unknown funds count as 0).
export function fundAmountsEGP(state: State, amounts: FundAmount[]): number {
  const rates = state.settings.exchangeRates;
  return sum(
    amounts.map(({ fundId, amount }) => {
      const fund = findFund(state, fundId);
      return fund ? toEGP(amount, fund.currency, rates) : 0;
    })
  );
}

// How much a fund should get this month (fund currency): its required monthly amount if it
// has a due date, else its planned monthly contribution, never more than what's left to
// reach the target.
export function fundSuggestedMonthly(state: State, fundId: string, now: Date = new Date()): number {
  const fund = findFund(state, fundId);
  if (!fund) return 0;
  const remaining = Math.max(0, fund.targetAmount - fundCurrent(state, fundId));
  const monthly = fundRequiredMonthly(state, fundId, now) ?? fund.monthlyContribution ?? 0;
  return Math.min(monthly, remaining);
}

// Splits `amountEGP` across funds in priority order, each capped by its suggested monthly
// amount, until the money runs out. Funds that would get nothing are omitted.
export function suggestAllocation(state: State, amountEGP: number, now: Date = new Date()): FundAmount[] {
  const rates = state.settings.exchangeRates;
  let leftEGP = Math.max(0, amountEGP);
  const result: FundAmount[] = [];
  for (const fund of fundsByPriority(state)) {
    if (leftEGP <= 0.005) break;
    const wantEGP = toEGP(fundSuggestedMonthly(state, fund.id, now), fund.currency, rates);
    const giveEGP = Math.min(wantEGP, leftEGP);
    if (giveEGP <= 0.005) continue;
    result.push({ fundId: fund.id, amount: round2(fromEGP(giveEGP, fund.currency, rates)) });
    leftEGP -= giveEGP;
  }
  return result;
}

export interface CoverPlan {
  withdrawals: FundAmount[];
  // EGP still uncovered after the withdrawals (0 when fully covered).
  remainingEGP: number;
}

// Withdraws cash from the chosen funds, lowest priority first, until unassigned money is
// back to zero. Funds without cash are skipped.
export function planCover(state: State, fundIds: string[]): CoverPlan {
  const rates = state.settings.exchangeRates;
  let deficitEGP = Math.max(0, -unassignedEGP(state));
  const withdrawals: FundAmount[] = [];
  const chosen = state.funds
    .filter((f) => fundIds.includes(f.id))
    .sort((a, b) => b.priority - a.priority);
  for (const fund of chosen) {
    if (deficitEGP <= 0.005) break;
    const cashEGP = toEGP(fundAllocated(state, fund.id), fund.currency, rates);
    const takeEGP = Math.min(cashEGP, deficitEGP);
    if (takeEGP <= 0.005) continue;
    // Round up to the cent so the cover never falls a fraction short.
    const amount = Math.min(fundAllocated(state, fund.id), Math.ceil(fromEGP(takeEGP, fund.currency, rates) * 100) / 100);
    withdrawals.push({ fundId: fund.id, amount });
    deficitEGP -= takeEGP;
  }
  return { withdrawals, remainingEGP: Math.max(0, deficitEGP) };
}

// Default cover choice: the lowest-priority fund that holds cash.
export function defaultCoverFundId(state: State): string | undefined {
  return [...fundsByPriority(state)].reverse().find((f) => fundAllocated(state, f.id) > 0)?.id;
}

// --- Transaction lists ------------------------------------------------------

export type TransactionFilter = 'all' | Transaction['type'];

// Newest first: by date, then by creation time within the same day.
export function compareNewestFirst(a: Transaction, b: Transaction): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
}

export function recentTransactions(state: Pick<State, 'transactions'>, count: number): Transaction[] {
  return [...state.transactions].sort(compareNewestFirst).slice(0, count);
}

export function transactionsForMonth(
  state: Pick<State, 'transactions'>,
  month: string,
  filter: TransactionFilter = 'all'
): Transaction[] {
  return state.transactions
    .filter((tx) => monthOf(tx.date) === month && (filter === 'all' || tx.type === filter))
    .sort(compareNewestFirst);
}

// Signed EGP effect on net cash flow at the snapshotted rate; transfers and asset purchases
// (money changing form, not leaving) are neutral.
export function transactionNetEGP(tx: Transaction): number {
  if (!isIncomeExpense(tx)) return 0;
  const amountEGP = tx.amount * tx.rateToEGP;
  return tx.type === 'income' ? amountEGP : -amountEGP;
}

export interface DayGroup {
  date: string;
  netEGP: number;
  transactions: Transaction[];
}

// Groups by calendar day, newest day first and newest transaction first within a day.
export function groupTransactionsByDay(transactions: Transaction[]): DayGroup[] {
  const groups = new Map<string, DayGroup>();
  for (const tx of [...transactions].sort(compareNewestFirst)) {
    const day = tx.date.slice(0, 10);
    const group = groups.get(day) ?? { date: day, netEGP: 0, transactions: [] };
    group.netEGP += transactionNetEGP(tx);
    group.transactions.push(tx);
    groups.set(day, group);
  }
  return [...groups.values()];
}

// --- Monthly cash flow ------------------------------------------------------

export interface MonthSummary {
  incomeEGP: number;
  expenseEGP: number;
  expenseByBucket: Record<ExpenseBucket, number>;
  netCashFlow: number;
  // net / income; null when there is no income.
  savingsRate: number | null;
}

export interface MonthSummaryOptions {
  // Leave out one-time expenses (used for averages such as the emergency target).
  excludeOneTime?: boolean;
}

// Income and expenses only: transfers move money between own accounts and asset purchases
// turn cash into holdings, so neither counts. Transactions before trackingStartDate are ignored.
export function monthSummary(state: State, month: string, options: MonthSummaryOptions = {}): MonthSummary {
  const categoryBucket = new Map(state.categories.map((c) => [c.id, c.bucket]));
  const summary: MonthSummary = {
    incomeEGP: 0,
    expenseEGP: 0,
    expenseByBucket: { essentials: 0, lifestyle: 0, giving: 0 },
    netCashFlow: 0,
    savingsRate: null,
  };

  for (const tx of state.transactions.filter(isIncomeExpense)) {
    if (monthOf(tx.date) !== month || tx.date < state.settings.trackingStartDate) continue;
    if (options.excludeOneTime && tx.oneTime) continue;
    const amountEGP = tx.amount * tx.rateToEGP;
    if (tx.type === 'income') {
      summary.incomeEGP += amountEGP;
    } else {
      summary.expenseEGP += amountEGP;
      const bucket = categoryBucket.get(tx.categoryId);
      if (bucket && bucket !== 'income') summary.expenseByBucket[bucket] += amountEGP;
    }
  }

  summary.netCashFlow = summary.incomeEGP - summary.expenseEGP;
  summary.savingsRate = summary.incomeEGP > 0 ? summary.netCashFlow / summary.incomeEGP : null;
  return summary;
}

// Average monthly essentials (one-time expenses excluded) over the 3 full months before
// `now`, times `months`. Only
// months with recorded essentials count toward the average; null when none of the three
// has any (not enough history to suggest a number).
export function suggestedEmergencyTarget(
  state: State,
  months: 3 | 6,
  now: Date = new Date()
): number | null {
  const current = toMonthKey(now);
  const lastThree = [1, 2, 3].map((n) => shiftMonth(current, -n));
  const recorded = lastThree
    .map((m) => monthSummary(state, m, { excludeOneTime: true }).expenseByBucket.essentials)
    .filter((essentials) => essentials > 0);
  if (recorded.length === 0) return null;
  return (sum(recorded) / recorded.length) * months;
}

// --- Diagnostics ------------------------------------------------------------

export function stateSummary(state: State) {
  return {
    accounts: state.accounts.length,
    holdings: state.holdings.length,
    funds: state.funds.length,
    netWorthEGP: Math.round(netWorthEGP(state) * 100) / 100,
    unassignedEGP: Math.round(unassignedEGP(state) * 100) / 100,
  };
}

// --- Categories -------------------------------------------------------------

// Categories offered in pickers: active ones of `kind`, plus `keepIds` (e.g. the archived
// category of a transaction being edited, so it stays selectable). Reports never filter.
export function pickerCategories(
  categories: Category[],
  kind: Category['kind'],
  keepIds: (string | undefined)[] = []
): Category[] {
  return categories.filter((c) => c.kind === kind && (!c.archived || keepIds.includes(c.id)));
}
