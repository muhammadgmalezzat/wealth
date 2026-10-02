import { fromEGP, toEGP } from '@/utils/currency';
import { monthOf, monthsUntil, shiftMonth, toMonthKey } from '@/utils/dates';
import type {
  Account,
  ExpenseBucket,
  FinanceStateV2,
  Fund,
  Holding,
  IncomeExpenseTransaction,
  Liability,
} from './types';

// Single source of truth for every derived financial figure. All functions are pure.
// Balances and holdings are valued at CURRENT rates/prices (what they're worth now);
// transaction flows use each transaction's snapshotted rateToEGP (what they were worth then).

type State = FinanceStateV2;

const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);

const isIncomeExpense = (tx: State['transactions'][number]): tx is IncomeExpenseTransaction =>
  tx.type !== 'transfer';

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

export function holdingValueEGP(state: Pick<State, 'settings'>, holding: Holding): number {
  if (holding.type === 'gold') {
    const purity = holding.karat / 24;
    return holding.weightGrams * purity * state.settings.goldPrice24kEGP;
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

// --- Funds ------------------------------------------------------------------

function findFund(state: State, fundId: string): Fund | undefined {
  return state.funds.find((f) => f.id === fundId);
}

// Cash allocated to the fund (fund currency): sum of its movements.
export function fundAllocated(state: State, fundId: string): number {
  return sum(state.fundMovements.filter((m) => m.fundId === fundId).map((m) => m.amount));
}

// Fund currency: cash movements + market value of linked holdings.
export function fundCurrent(state: State, fundId: string): number {
  const fund = findFund(state, fundId);
  if (!fund) return 0;
  const linkedEGP = sum(
    state.holdings
      .filter((h) => fund.linkedHoldingIds.includes(h.id))
      .map((h) => holdingValueEGP(state, h))
  );
  return (
    fundAllocated(state, fundId) + fromEGP(linkedEGP, fund.currency, state.settings.exchangeRates)
  );
}

// 0..∞ (can exceed 1 when over-funded). A non-positive target counts as complete.
export function fundProgress(state: State, fundId: string): number {
  const fund = findFund(state, fundId);
  if (!fund) return 0;
  if (fund.targetAmount <= 0) return 1;
  return Math.max(0, fundCurrent(state, fundId) / fund.targetAmount);
}

// Fund currency per month to hit the target by the deadline; null without a deadline.
export function fundRequiredMonthly(state: State, fundId: string, now: Date = new Date()): number | null {
  const fund = findFund(state, fundId);
  if (!fund?.deadline) return null;
  const remaining = Math.max(0, fund.targetAmount - fundCurrent(state, fundId));
  return remaining / monthsUntil(fund.deadline, now);
}

export type FundStatus = 'ahead' | 'on_track' | 'behind' | 'no_deadline';

// Compares this month's net allocations with what was required at the START of the month
// (so allocating this month doesn't shrink its own requirement).
// behind: < required · on_track: required…110% · ahead: > 110% or target already reached.
export function fundStatus(state: State, fundId: string, now: Date = new Date()): FundStatus {
  const fund = findFund(state, fundId);
  if (!fund?.deadline) return 'no_deadline';

  const month = toMonthKey(now);
  const allocatedThisMonth = sum(
    state.fundMovements
      .filter((m) => m.fundId === fundId && monthOf(m.date) === month)
      .map((m) => m.amount)
  );
  const currentAtMonthStart = fundCurrent(state, fundId) - allocatedThisMonth;
  const remainingAtMonthStart = Math.max(0, fund.targetAmount - currentAtMonthStart);
  const required = remainingAtMonthStart / monthsUntil(fund.deadline, now);

  if (required <= 0) return 'ahead';
  if (allocatedThisMonth < required) return 'behind';
  return allocatedThisMonth > required * 1.1 ? 'ahead' : 'on_track';
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

// --- Monthly cash flow ------------------------------------------------------

export interface MonthSummary {
  incomeEGP: number;
  expenseEGP: number;
  expenseByBucket: Record<ExpenseBucket, number>;
  netCashFlow: number;
  // net / income; null when there is no income.
  savingsRate: number | null;
}

// Transfers move money between own accounts and are excluded.
export function monthSummary(state: State, month: string): MonthSummary {
  const categoryBucket = new Map(state.categories.map((c) => [c.id, c.bucket]));
  const summary: MonthSummary = {
    incomeEGP: 0,
    expenseEGP: 0,
    expenseByBucket: { essentials: 0, lifestyle: 0, giving: 0 },
    netCashFlow: 0,
    savingsRate: null,
  };

  for (const tx of state.transactions.filter(isIncomeExpense)) {
    if (monthOf(tx.date) !== month) continue;
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

// Lifestyle limit left this month; null when the month has no plan or no lifestyle limit.
export function safeToSpend(state: State, month: string): number | null {
  const limit = state.monthlyPlans.find((p) => p.month === month)?.bucketLimitsEGP.lifestyle;
  if (limit === undefined) return null;
  return limit - monthSummary(state, month).expenseByBucket.lifestyle;
}

// Average essentials spend over the 3 full months before `now`, times `months`.
export function suggestedEmergencyTarget(
  state: State,
  months: 3 | 6,
  now: Date = new Date()
): number {
  const current = toMonthKey(now);
  const lastThree = [1, 2, 3].map((n) => shiftMonth(current, -n));
  const essentials = sum(lastThree.map((m) => monthSummary(state, m).expenseByBucket.essentials));
  return (essentials / 3) * months;
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
