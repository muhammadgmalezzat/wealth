import { formatMoney } from '@/components/ui/formatMoney';
import type { PlanInput } from '@/store/operations';
import type { ContributionProgress, LineProgress } from '@/store/planning';
import type { CurrencyCode, MonthlyPlan, PlanLine } from '@/store/types';

// Pure UI helpers for the Plan screen and sheets (no React Native; unit-tested). They only read
// planning results; saving still goes through the store's savePlan.

export type LineState = 'normal' | 'approaching' | 'over' | 'paid';

const EPSILON = 0.005;
// A fixed bill paid to within half a unit counts as exactly paid, not as over.
const PAID_TOLERANCE = 0.5;
const APPROACHING_PCT = 0.85;

// normal · approaching (flexible, ≥ 85 % and not over) · over (spent > limit) · paid (a fixed
// line spent to its limit, within 0.5).
export function lineState(line: Pick<LineProgress, 'kind' | 'limit' | 'spent' | 'pct'>): LineState {
  if (line.kind === 'fixed' && line.limit > 0 && line.spent >= line.limit - EPSILON && line.spent <= line.limit + PAID_TOLERANCE) {
    return 'paid';
  }
  if (line.spent > line.limit + EPSILON) return 'over';
  if (line.kind === 'flexible' && line.limit > 0 && line.pct >= APPROACHING_PCT) return 'approaching';
  return 'normal';
}

// The one sentence about a line (LineSheet): factual, never shaming.
export function lineSentence(line: LineProgress, name: string, currency: CurrencyCode): string {
  switch (lineState(line)) {
    case 'over':
      // A 0 limit has no budget to exceed: say what was spent instead.
      return line.limit === 0
        ? `مفيش ميزانية للبند ده: اتصرف ${formatMoney(line.spent, currency)}.`
        : `صرف ${name} عدى الخطة بـ ${formatMoney(line.spent - line.limit, currency)}.`;
    case 'paid':
      return 'اتدفع.';
    case 'approaching':
      return `قرب الحد: متبقي ${formatMoney(line.remaining, currency)}.`;
    default:
      return `متبقي ${formatMoney(line.remaining, currency)}.`;
  }
}

export type UnplannedStatus = 'balanced' | 'under' | 'over';

// |unplanned| < 0.5 → balanced; > 0 → income still to plan; < 0 → planned more than income.
export function unplannedStatus(unplanned: number): UnplannedStatus {
  if (Math.abs(unplanned) < 0.5) return 'balanced';
  return unplanned > 0 ? 'under' : 'over';
}

export function contributionDone(c: Pick<ContributionProgress, 'planned' | 'allocated'>): boolean {
  return c.planned > 0 && c.allocated + EPSILON >= c.planned;
}

// The saved plan as savePlan input (same fields the editor sends).
export function planInputOf(plan: MonthlyPlan): PlanInput {
  return {
    month: plan.month,
    currency: plan.currency,
    expectedIncome: plan.expectedIncome,
    lines: plan.lines.map((l) => ({ categoryId: l.categoryId, limit: l.limit, kind: l.kind })),
    fundContributions: plan.fundContributions.map((c) => ({ fundId: c.fundId, amount: c.amount })),
  };
}

// Replaces (or appends) one line.
export function withLine(plan: MonthlyPlan, line: PlanLine): PlanInput {
  const input = planInputOf(plan);
  const exists = input.lines.some((l) => l.categoryId === line.categoryId);
  return {
    ...input,
    lines: exists ? input.lines.map((l) => (l.categoryId === line.categoryId ? line : l)) : [...input.lines, line],
  };
}

export function withoutLine(plan: MonthlyPlan, categoryId: string): PlanInput {
  const input = planInputOf(plan);
  return { ...input, lines: input.lines.filter((l) => l.categoryId !== categoryId) };
}
