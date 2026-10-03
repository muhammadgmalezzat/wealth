import { fromEGP, toEGP } from '@/utils/currency';
import { fromDateKey, monthOf, shiftMonth, toDateKey, toMonthKey } from '@/utils/dates';
import { FIXED_CATEGORY_IDS } from './defaultCategories';
import type { PlanInput } from './operations';
import { isLive, monthlyEquivalent } from './recurring';
import { fundsByPriority, fundSuggestedMonthly } from './selectors';
import type {
  CurrencyCode,
  ExpenseBucket,
  FinanceState,
  IncomeExpenseTransaction,
  MonthlyPlan,
  PlanLine,
  PlanLineKind,
  PlannedContribution,
} from './types';

// Monthly plan math. Pure functions only.
//
// Plans live in one currency (default SAR). A transaction is converted into it in two steps:
// its amount → EGP with the transaction's own rateToEGP snapshot (what it cost then), then
// EGP → plan currency at the current rates.

type State = FinanceState;

export const DEFAULT_PLAN_CURRENCY: CurrencyCode = 'SAR';
const EXPENSE_BUCKETS: ExpenseBucket[] = ['essentials', 'lifestyle', 'giving'];
// How many completed months the suggestion looks back at (at most).
const SUGGESTION_MONTHS = 3;

const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);

export function planFor(state: Pick<State, 'monthlyPlans'>, month: string): MonthlyPlan | undefined {
  return state.monthlyPlans.find((p) => p.month === month);
}

// Transaction amount in `currency`: snapshot rate to EGP, then current rate out of EGP.
export function amountInCurrency(
  state: Pick<State, 'settings'>,
  tx: Pick<IncomeExpenseTransaction, 'amount' | 'rateToEGP'>,
  currency: CurrencyCode
): number {
  return fromEGP(tx.amount * tx.rateToEGP, currency, state.settings.exchangeRates);
}

function convert(state: Pick<State, 'settings'>, amount: number, from: CurrencyCode, to: CurrencyCode): number {
  const rates = state.settings.exchangeRates;
  return fromEGP(toEGP(amount, from, rates), to, rates);
}

function monthExpenses(state: State, month: string, { excludeOneTime = false } = {}): IncomeExpenseTransaction[] {
  return state.transactions.filter(
    (tx): tx is IncomeExpenseTransaction =>
      tx.type === 'expense' &&
      monthOf(tx.date) === month &&
      tx.date >= state.settings.trackingStartDate &&
      !(excludeOneTime && tx.oneTime)
  );
}

// Spending per expense category in `month`, in `currency`. Counts every expense (one-time
// ones included: they were real spending); asset purchases and transfers aren't expenses.
export function spendByCategory(state: State, month: string, currency: CurrencyCode): Map<string, number> {
  const totals = new Map<string, number>();
  for (const tx of monthExpenses(state, month)) {
    totals.set(tx.categoryId, (totals.get(tx.categoryId) ?? 0) + amountInCurrency(state, tx, currency));
  }
  return totals;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

// Days of `month` still ahead, today included: all of a future month, none of a past one.
export function daysLeftInMonth(month: string, now: Date = new Date()): number {
  const current = toMonthKey(now);
  if (month < current) return 0;
  if (month > current) return daysInMonth(month);
  return daysInMonth(month) - now.getDate() + 1;
}

// --- Suggestion ---------------------------------------------------------------

interface WindowMonth {
  month: string;
  // Share of the month that was tracked: < 1 only for the month tracking started in.
  weight: number;
}

// Up to SUGGESTION_MONTHS completed months before `month`, none before tracking started.
function suggestionWindow(state: State, month: string): WindowMonth[] {
  const start = state.settings.trackingStartDate;
  const startMonth = monthOf(start);
  const window: WindowMonth[] = [];
  for (let n = SUGGESTION_MONTHS; n >= 1; n--) {
    const m = shiftMonth(month, -n);
    if (m < startMonth) continue;
    const total = daysInMonth(m);
    const tracked = m === startMonth ? total - fromDateKey(start).getDate() + 1 : total;
    window.push({ month: m, weight: tracked / total });
  }
  return window;
}

export interface RecurringMonthly {
  // Monthly equivalent of live income rules, in the plan currency.
  income: number;
  // Monthly equivalent of live expense rules per category, in the plan currency.
  expenseByCategory: Map<string, number>;
}

// What active (not ended) recurring rules add up to per month, converted at current rates.
export function recurringMonthly(state: State, currency: CurrencyCode, now: Date = new Date()): RecurringMonthly {
  const today = toDateKey(now);
  const result: RecurringMonthly = { income: 0, expenseByCategory: new Map() };
  for (const rule of state.recurringRules) {
    if (!isLive(rule, today)) continue;
    const monthly = convert(state, monthlyEquivalent(rule), rule.currency, currency);
    if (rule.kind === 'income') result.income += monthly;
    if (rule.kind === 'expense' && rule.categoryId) {
      result.expenseByCategory.set(rule.categoryId, (result.expenseByCategory.get(rule.categoryId) ?? 0) + monthly);
    }
  }
  return result;
}

// "اقترح من مصروفي": a plan built from recent spending, one-time expenses and asset purchases
// excluded.
// - Flexible categories: total spend ÷ months tracked, so a partly tracked first month
//   (e.g. from Aug 5) counts as 27/31 of a month instead of dragging the average down.
// - Fixed categories (rent, internet, bills): plain average of the monthly totals, unscaled —
//   a bill costs the same however many days of the month were tracked.
// - Expected income: plain average of monthly income.
// Recurring rules take precedence: a category with active expense rules becomes a fixed line
// at the rules' monthly equivalent, and active income rules set the expected income.
// Fund contributions are prefilled from each fund's suggested monthly amount.
export function planSuggestion(
  state: State,
  month: string,
  currency: CurrencyCode = DEFAULT_PLAN_CURRENCY,
  now: Date = new Date()
): PlanInput {
  const window = suggestionWindow(state, month);
  const trackedMonths = sum(window.map((w) => w.weight));
  const perCategory = new Map<string, number>();
  let income = 0;
  for (const { month: m } of window) {
    for (const tx of monthExpenses(state, m, { excludeOneTime: true })) {
      perCategory.set(tx.categoryId, (perCategory.get(tx.categoryId) ?? 0) + amountInCurrency(state, tx, currency));
    }
    for (const tx of state.transactions) {
      if (tx.type === 'income' && monthOf(tx.date) === m && tx.date >= state.settings.trackingStartDate) {
        income += amountInCurrency(state, tx, currency);
      }
    }
  }

  // Archived categories aren't suggested (their spending still counts as unplanned).
  const bucketOf = new Map(state.categories.filter((c) => !c.archived).map((c) => [c.id, c.bucket]));
  const lines: PlanLine[] = [];
  for (const [categoryId, total] of perCategory) {
    if (!bucketOf.has(categoryId)) continue;
    const kind: PlanLineKind = FIXED_CATEGORY_IDS.includes(categoryId) ? 'fixed' : 'flexible';
    const monthly = kind === 'fixed' ? total / window.length : total / trackedMonths;
    const limit = Math.round(monthly);
    if (limit > 0) lines.push({ categoryId, limit, kind });
  }
  const recurring = recurringMonthly(state, currency, now);
  for (const [categoryId, monthly] of recurring.expenseByCategory) {
    if (!bucketOf.has(categoryId)) continue;
    const limit = Math.round(monthly);
    const existing = lines.findIndex((l) => l.categoryId === categoryId);
    const line: PlanLine = { categoryId, limit, kind: 'fixed' };
    if (existing >= 0) lines[existing] = line;
    else if (limit > 0) lines.push(line);
  }
  lines.sort(
    (a, b) =>
      EXPENSE_BUCKETS.indexOf(bucketOf.get(a.categoryId) as ExpenseBucket) -
        EXPENSE_BUCKETS.indexOf(bucketOf.get(b.categoryId) as ExpenseBucket) || b.limit - a.limit
  );

  return {
    month,
    currency,
    expectedIncome:
      recurring.income > 0 ? Math.round(recurring.income) : window.length ? Math.round(income / window.length) : 0,
    lines,
    fundContributions: suggestedContributions(state, currency, now),
  };
}

// Each active fund's suggested monthly amount, in the plan currency (funds needing nothing
// are left out).
export function suggestedContributions(
  state: State,
  currency: CurrencyCode,
  now: Date = new Date()
): PlannedContribution[] {
  return fundsByPriority(state)
    .map((fund) => ({
      fundId: fund.id,
      amount: Math.round(convert(state, fundSuggestedMonthly(state, fund.id, now), fund.currency, currency)),
    }))
    .filter((c) => c.amount > 0);
}

// "ابدأ من الصفر": no lines or income yet; fund contributions prefilled.
export function emptyPlan(state: State, month: string, currency: CurrencyCode = DEFAULT_PLAN_CURRENCY, now?: Date): PlanInput {
  return {
    month,
    currency,
    // Recurring income, when there is any.
    expectedIncome: Math.round(recurringMonthly(state, currency, now).income),
    lines: [],
    fundContributions: suggestedContributions(state, currency, now),
  };
}

// The most recent month before `month` that has a plan (what "copy last month" copies).
export function previousPlanMonth(state: Pick<State, 'monthlyPlans'>, month: string): string | undefined {
  return state.monthlyPlans
    .map((p) => p.month)
    .filter((m) => m < month)
    .sort()
    .at(-1);
}

// --- Progress -----------------------------------------------------------------

export interface LineProgress {
  categoryId: string;
  bucket: ExpenseBucket;
  kind: PlanLineKind;
  limit: number;
  spent: number;
  // Negative when overspent.
  remaining: number;
  // spent ÷ limit (1 when something was spent against a 0 limit).
  pct: number;
}

export interface ContributionProgress {
  fundId: string;
  planned: number;
  // Net allocated to the fund this month, in the plan currency.
  allocated: number;
}

export interface PlanProgress {
  plan: MonthlyPlan;
  lines: LineProgress[];
  buckets: Record<ExpenseBucket, { planned: number; spent: number }>;
  totalPlanned: number;
  // All expenses of the month, including categories without a line.
  totalSpent: number;
  // Spending in categories that have no line.
  unplannedSpent: number;
  contributions: ContributionProgress[];
  unplanned: number;
}

// expectedIncome − (line limits + planned fund contributions). Zero-based: 0 is the goal;
// positive means income still without a job, negative means more planned than earned.
export function unplannedAmount(plan: Pick<MonthlyPlan, 'expectedIncome' | 'lines' | 'fundContributions'>): number {
  return plan.expectedIncome - sum(plan.lines.map((l) => l.limit)) - sum(plan.fundContributions.map((c) => c.amount));
}

export function planProgress(state: State, month: string): PlanProgress | null {
  const plan = planFor(state, month);
  if (!plan) return null;
  const spent = spendByCategory(state, month, plan.currency);
  const bucketOf = new Map(state.categories.map((c) => [c.id, c.bucket]));

  const lines: LineProgress[] = plan.lines.map((line) => {
    const lineSpent = spent.get(line.categoryId) ?? 0;
    // Lines only ever hold expense categories (savePlan validates), so the bucket is one of
    // the expense buckets.
    const bucket = (bucketOf.get(line.categoryId) ?? 'essentials') as ExpenseBucket;
    return {
      categoryId: line.categoryId,
      bucket,
      kind: line.kind,
      limit: line.limit,
      spent: lineSpent,
      remaining: line.limit - lineSpent,
      pct: line.limit > 0 ? lineSpent / line.limit : lineSpent > 0 ? 1 : 0,
    };
  });

  const buckets = { essentials: { planned: 0, spent: 0 }, lifestyle: { planned: 0, spent: 0 }, giving: { planned: 0, spent: 0 } };
  for (const line of lines) {
    buckets[line.bucket].planned += line.limit;
    buckets[line.bucket].spent += line.spent;
  }

  const planned = new Set(plan.lines.map((l) => l.categoryId));
  const totalSpent = sum([...spent.values()]);
  const unplannedSpent = sum([...spent.entries()].filter(([id]) => !planned.has(id)).map(([, v]) => v));

  const contributions = plan.fundContributions.map((c) => {
    const fund = state.funds.find((f) => f.id === c.fundId);
    const allocatedInFund = sum(
      state.fundMovements.filter((m) => m.fundId === c.fundId && monthOf(m.date) === month).map((m) => m.amount)
    );
    return {
      fundId: c.fundId,
      planned: c.amount,
      allocated: fund ? convert(state, allocatedInFund, fund.currency, plan.currency) : 0,
    };
  });

  return {
    plan,
    lines,
    buckets,
    totalPlanned: sum(lines.map((l) => l.limit)),
    totalSpent,
    unplannedSpent,
    contributions,
    unplanned: unplannedAmount(plan),
  };
}

// What's left to spend freely: remaining on flexible lines, each floored at 0 (overspending
// one line doesn't eat another's budget here). null without a plan.
export function safeToSpend(state: State, month: string): number | null {
  const progress = planProgress(state, month);
  if (!progress) return null;
  return sum(progress.lines.filter((l) => l.kind === 'flexible').map((l) => Math.max(0, l.remaining)));
}

// safeToSpend spread over the days left in the month (today included); 0 once it's over.
export function safeToSpendToday(state: State, month: string, now: Date = new Date()): number | null {
  const safe = safeToSpend(state, month);
  if (safe === null) return null;
  const days = daysLeftInMonth(month, now);
  return days > 0 ? safe / days : 0;
}

export function overspentLines(state: State, month: string): LineProgress[] {
  return planProgress(state, month)?.lines.filter((l) => l.remaining < -0.005) ?? [];
}

export interface SpendImpact {
  line: LineProgress;
  // In the plan currency; negative when the line would be overspent.
  remainingAfter: number;
  overBy: number;
}

// How a new expense would land on its category's line. `amount` is in `amountCurrency`
// (default: the plan currency) and converted at current rates. null when there is no plan
// or no line for the category.
export function spendImpact(
  state: State,
  month: string,
  categoryId: string,
  amount: number,
  amountCurrency?: CurrencyCode
): SpendImpact | null {
  const progress = planProgress(state, month);
  const line = progress?.lines.find((l) => l.categoryId === categoryId);
  if (!progress || !line) return null;
  const inPlan = amountCurrency ? convert(state, amount, amountCurrency, progress.plan.currency) : amount;
  const remainingAfter = line.remaining - inPlan;
  return { line, remainingAfter, overBy: Math.max(0, -remainingAfter) };
}
