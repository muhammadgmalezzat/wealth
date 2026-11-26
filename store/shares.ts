import type { Change, PeriodComparison } from './comparison';
import type { ExpenseBucket } from './types';

// Per-category shares of a period's spending (Phase 3), shared by «بصمة الإنفاق» (Overview) and «فلوسك راحت فين»
// («الإنفاق») so a category shows the same percentage everywhere. Pure.

const EPSILON = 0.005;

export interface CategoryShare {
  categoryId: string;
  bucket: ExpenseBucket;
  amount: number;
  // Share in tenths of a percent; over ALL categories these add up to exactly 1000 (largest remainder).
  tenths: number;
  change: Change;
}

export interface CategoryShares {
  // = the spending card; null when the period has no data (before tracking).
  total: number | null;
  // Every category with spending, largest first.
  rows: CategoryShare[];
}

// Tenths of a percent for `amounts`, rounded so they add up to exactly 1000.
export function largestRemainder(amounts: readonly number[]): number[] {
  const sum = amounts.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return amounts.map(() => 0);
  const raw = amounts.map((a) => (a / sum) * 1000);
  const out = raw.map(Math.floor);
  let left = 1000 - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k][1]] += 1;
  return out;
}

export function categoryShares(comparison: PeriodComparison): CategoryShares {
  const total = comparison.current.metrics.expense.value;
  const byCategory = comparison.current.categories;
  if (total === null || !byCategory) return { total: null, rows: [] };
  const changeOf = new Map(comparison.categories.map((x) => [x.categoryId, x.change]));
  const ranked = [...byCategory.entries()].filter(([, e]) => e.amount > EPSILON).sort((a, b) => b[1].amount - a[1].amount || (a[0] < b[0] ? -1 : 1));
  const tenths = largestRemainder(ranked.map(([, e]) => e.amount));
  return {
    total,
    rows: ranked.map(([categoryId, e], i) => ({ categoryId, bucket: e.bucket, amount: e.amount, tenths: tenths[i], change: changeOf.get(categoryId)! })),
  };
}

