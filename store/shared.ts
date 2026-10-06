import { toMonthKey } from '@/utils/dates';

// Low-level helpers shared by selectors.ts and planning.ts. Imports nothing from either, so the
// two never import each other.

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
