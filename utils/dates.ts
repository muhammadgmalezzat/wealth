// Calendar helpers. Transaction/movement dates are local 'YYYY-MM-DD' strings and
// months are 'YYYY-MM' keys, so month grouping never shifts across time zones.

const pad = (n: number) => String(n).padStart(2, '0');

export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toMonthKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

// 'YYYY-MM-DD' (or a full ISO string) → 'YYYY-MM'.
export function monthOf(dateKey: string): string {
  return dateKey.slice(0, 7);
}

export function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

export function isMonthKey(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

// Month key `offset` months away from `month` (negative = earlier).
export function shiftMonth(month: string, offset: number): string {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + offset;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

// Number of monthly contributions left before `deadline`, counting the current month.
// e.g. now = Oct, deadline = Dec → 3. A deadline in the past still yields 1.
export function monthsUntil(deadline: string, now: Date): number {
  const [dy, dm] = deadline.split('-').map(Number);
  const months = (dy - now.getFullYear()) * 12 + (dm - (now.getMonth() + 1)) + 1;
  return Math.max(1, months);
}
