import { monthOf, shiftMonth } from '@/utils/dates';
import { addIn, sumIn } from '@/utils/money';
import { isReviewed } from './nextActions';
import { planFor, planProgress, previousPlanMonth, type LineProgress } from './planning';
import {
  fundProgress,
  fundsByPriority,
  monthSummary,
  movementAmountIn,
  reportingCurrency,
  transactionAmountIn,
  unassignedSummary,
} from './selectors';
import { monthNetWorthChange, type NetWorthChange } from './snapshots';
import type { CurrencyCode, ExpenseBucket, FinanceState, Fund, IncomeExpenseTransaction } from './types';

// Numbers for the monthly review (app/review.tsx). Pure functions only. Cash flow is in the reporting
// currency at each transaction's snapshot rate (like monthSummary); plan figures are in the plan currency;
// the unassigned money (a funds figure) stays in EGP for now.

type State = FinanceState;

const TOP_CATEGORIES = 5;
const TOP_LINES = 3;
const EPSILON = 0.005;
const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);

export interface ReviewCategory {
  categoryId: string;
  amount: number;
}

export interface ReviewOneTime {
  id: string;
  categoryId: string;
  amount: number;
  date: string;
  note?: string;
}

export interface ReviewPlan {
  currency: CurrencyCode;
  buckets: Record<ExpenseBucket, { planned: number; spent: number }>;
  totalPlanned: number;
  totalSpent: number;
  unplannedSpent: number;
  // Most overspent lines first / lines with the most left over first (at most 3 each).
  over: LineProgress[];
  under: LineProgress[];
}

export interface ReviewFund {
  fundId: string;
  // Net allocated during the month and the planned contribution (null when none was planned),
  // both in the review's fund currency (the plan currency, or EGP without a plan).
  allocated: number;
  planned: number | null;
}

export interface MonthReview {
  month: string;
  // The currency of the cash-flow amounts below.
  currency: CurrencyCode;
  income: number;
  expense: number;
  net: number;
  // net ÷ income; null without income.
  savingsRate: number | null;
  netWorthChange: NetWorthChange | null;
  plan: ReviewPlan | null;
  // Regular spending (one-time expenses excluded), biggest first.
  topCategories: ReviewCategory[];
  oneTime: ReviewOneTime[];
  oneTimeTotal: number;
  fundCurrency: CurrencyCode;
  funds: ReviewFund[];
  // Active funds that have reached their target.
  completedFunds: Fund[];
  nextMonth: string;
  nextMonthHasPlan: boolean;
  // The plan "انسخ" would copy into next month (the latest one before it).
  copyFromMonth?: string;
  // Money without a job: the total in EGP (display), and the part that is surplus in some
  // currency (what "وزّع الفايض" can distribute).
  unassignedEGP: number;
  surplusEGP: number;
  reviewed: boolean;
}

function monthExpenses(state: State, month: string): IncomeExpenseTransaction[] {
  return state.transactions.filter(
    (tx): tx is IncomeExpenseTransaction =>
      tx.type === 'expense' && monthOf(tx.date) === month && tx.date >= state.settings.trackingStartDate
  );
}

function reviewPlan(state: State, month: string): ReviewPlan | null {
  const progress = planProgress(state, month);
  if (!progress) return null;
  const over = progress.lines
    .filter((l) => l.remaining < -EPSILON)
    .sort((a, b) => a.remaining - b.remaining)
    .slice(0, TOP_LINES);
  const under = progress.lines
    .filter((l) => l.remaining > EPSILON)
    .sort((a, b) => b.remaining - a.remaining)
    .slice(0, TOP_LINES);
  return {
    currency: progress.plan.currency,
    buckets: progress.buckets,
    totalPlanned: progress.totalPlanned,
    totalSpent: progress.totalSpent,
    unplannedSpent: progress.unplannedSpent,
    over,
    under,
  };
}

export function monthReview(
  state: State,
  month: string,
  now: Date = new Date(),
  currency: CurrencyCode = reportingCurrency(state)
): MonthReview {
  const summary = monthSummary(state, month, { to: currency });

  const regular = new Map<string, number>();
  const oneTime: ReviewOneTime[] = [];
  for (const tx of monthExpenses(state, month)) {
    const amount = transactionAmountIn(state, tx, currency);
    if (tx.oneTime) {
      oneTime.push({ id: tx.id, categoryId: tx.categoryId, amount, date: tx.date, ...(tx.note ? { note: tx.note } : {}) });
    } else {
      regular.set(tx.categoryId, addIn(regular.get(tx.categoryId) ?? 0, amount, currency));
    }
  }
  const topCategories = [...regular.entries()]
    .map(([categoryId, amount]) => ({ categoryId, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, TOP_CATEGORIES);
  oneTime.sort((a, b) => b.amount - a.amount);

  // Funds: every fund with a planned contribution or a movement this month, in priority order.
  const plan = planFor(state, month);
  const fundCurrency = plan?.currency ?? 'EGP';
  const planned = new Map(plan?.fundContributions.map((c) => [c.fundId, c.amount]) ?? []);
  // Each movement at its own rates, so a past month reads the same whatever today's rates are.
  const allocatedIn = (fund: Fund) =>
    sumIn(
      state.fundMovements
        .filter((m) => m.fundId === fund.id && monthOf(m.date) === month)
        .map((m) => movementAmountIn(state, m, fundCurrency)),
      fundCurrency
    );
  const funds: ReviewFund[] = state.funds
    .filter((f) => planned.has(f.id) || state.fundMovements.some((m) => m.fundId === f.id && monthOf(m.date) === month))
    .sort((a, b) => a.priority - b.priority)
    .map((f) => ({ fundId: f.id, allocated: allocatedIn(f), planned: planned.get(f.id) ?? null }));

  const nextMonth = shiftMonth(month, 1);
  const unassigned = unassignedSummary(state);
  return {
    month,
    currency,
    income: summary.income,
    expense: summary.expense,
    net: summary.netCashFlow,
    savingsRate: summary.savingsRate,
    netWorthChange: monthNetWorthChange(state, month, now, currency),
    plan: reviewPlan(state, month),
    topCategories,
    oneTime,
    oneTimeTotal: sumIn(oneTime.map((t) => t.amount), currency),
    fundCurrency,
    funds,
    completedFunds: fundsByPriority(state).filter((f) => fundProgress(state, f.id) >= 1),
    nextMonth,
    nextMonthHasPlan: !!planFor(state, nextMonth),
    copyFromMonth: previousPlanMonth(state, nextMonth),
    unassignedEGP: unassigned.totalEGP,
    surplusEGP: unassigned.surplusEGP,
    reviewed: isReviewed(state, month),
  };
}
