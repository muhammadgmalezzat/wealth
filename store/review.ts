import { fromEGP, toEGP } from '@/utils/currency';
import { monthOf, shiftMonth } from '@/utils/dates';
import { isReviewed } from './nextActions';
import { planFor, planProgress, previousPlanMonth, type LineProgress } from './planning';
import { fundProgress, fundsByPriority, monthSummary, unassignedEGP } from './selectors';
import { monthNetWorthChange, type NetWorthChange } from './snapshots';
import type { CurrencyCode, ExpenseBucket, FinanceState, Fund, IncomeExpenseTransaction } from './types';

// Numbers for the monthly review (app/review.tsx). Pure functions only. Cash flow is in EGP at
// each transaction's snapshot rate (like monthSummary); plan figures are in the plan currency.

type State = FinanceState;

const TOP_CATEGORIES = 5;
const TOP_LINES = 3;
const EPSILON = 0.005;
const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);

export interface ReviewCategory {
  categoryId: string;
  amountEGP: number;
}

export interface ReviewOneTime {
  id: string;
  categoryId: string;
  amountEGP: number;
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
  incomeEGP: number;
  expenseEGP: number;
  netEGP: number;
  // net ÷ income; null without income.
  savingsRate: number | null;
  netWorthChange: NetWorthChange | null;
  plan: ReviewPlan | null;
  // Regular spending (one-time expenses excluded), biggest first.
  topCategories: ReviewCategory[];
  oneTime: ReviewOneTime[];
  oneTimeTotalEGP: number;
  fundCurrency: CurrencyCode;
  funds: ReviewFund[];
  // Active funds that have reached their target.
  completedFunds: Fund[];
  nextMonth: string;
  nextMonthHasPlan: boolean;
  // The plan "انسخ" would copy into next month (the latest one before it).
  copyFromMonth?: string;
  unassignedEGP: number;
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

export function monthReview(state: State, month: string, now: Date = new Date()): MonthReview {
  const summary = monthSummary(state, month);
  const rates = state.settings.exchangeRates;

  const regular = new Map<string, number>();
  const oneTime: ReviewOneTime[] = [];
  for (const tx of monthExpenses(state, month)) {
    const amountEGP = tx.amount * tx.rateToEGP;
    if (tx.oneTime) {
      oneTime.push({ id: tx.id, categoryId: tx.categoryId, amountEGP, date: tx.date, ...(tx.note ? { note: tx.note } : {}) });
    } else {
      regular.set(tx.categoryId, (regular.get(tx.categoryId) ?? 0) + amountEGP);
    }
  }
  const topCategories = [...regular.entries()]
    .map(([categoryId, amountEGP]) => ({ categoryId, amountEGP }))
    .sort((a, b) => b.amountEGP - a.amountEGP)
    .slice(0, TOP_CATEGORIES);
  oneTime.sort((a, b) => b.amountEGP - a.amountEGP);

  // Funds: every fund with a planned contribution or a movement this month, in priority order.
  const plan = planFor(state, month);
  const fundCurrency = plan?.currency ?? 'EGP';
  const planned = new Map(plan?.fundContributions.map((c) => [c.fundId, c.amount]) ?? []);
  const allocatedIn = (fund: Fund) =>
    fromEGP(
      toEGP(sum(state.fundMovements.filter((m) => m.fundId === fund.id && monthOf(m.date) === month).map((m) => m.amount)), fund.currency, rates),
      fundCurrency,
      rates
    );
  const funds: ReviewFund[] = state.funds
    .filter((f) => planned.has(f.id) || state.fundMovements.some((m) => m.fundId === f.id && monthOf(m.date) === month))
    .sort((a, b) => a.priority - b.priority)
    .map((f) => ({ fundId: f.id, allocated: allocatedIn(f), planned: planned.get(f.id) ?? null }));

  const nextMonth = shiftMonth(month, 1);
  return {
    month,
    incomeEGP: summary.incomeEGP,
    expenseEGP: summary.expenseEGP,
    netEGP: summary.netCashFlow,
    savingsRate: summary.savingsRate,
    netWorthChange: monthNetWorthChange(state, month, now),
    plan: reviewPlan(state, month),
    topCategories,
    oneTime,
    oneTimeTotalEGP: sum(oneTime.map((t) => t.amountEGP)),
    fundCurrency,
    funds,
    completedFunds: fundsByPriority(state).filter((f) => fundProgress(state, f.id) >= 1),
    nextMonth,
    nextMonthHasPlan: !!planFor(state, nextMonth),
    copyFromMonth: previousPlanMonth(state, nextMonth),
    unassignedEGP: unassignedEGP(state),
    reviewed: isReviewed(state, month),
  };
}
