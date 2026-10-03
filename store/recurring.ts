import { fromDateKey, shiftDate, toDateKey } from '@/utils/dates';
import type { CurrencyCode, FinanceState, RecurringRule } from './types';

// Recurring schedule engine. Pure functions only.
//
// A rule's occurrences are generated from its startDate:
//   weekly  → startDate + k × 7 × interval days
//   monthly → month(startDate) + k × interval, on dayOfMonth (default: startDate's day),
//             clamped to the month's last day (31 → 28/29 Feb, 30 Apr…)
//   yearly  → year(startDate) + k × interval, same month, same day rule
// Occurrences before startDate or after endDate (inclusive) don't exist.
// An occurrence is "handled" when a transaction carries its recurringRuleId + occurrenceDate,
// or when it's listed in skippedDates.

type State = Pick<FinanceState, 'recurringRules' | 'transactions'>;

// Safety cap for loops over occurrences (≈ 20 years of weekly items).
const MAX_STEPS = 1100;

const pad = (n: number) => String(n).padStart(2, '0');
const lastDayOfMonth = (year: number, monthIndex: number) => new Date(year, monthIndex + 1, 0).getDate();

// The k-th scheduled date (k ≥ 0), ignoring start/end bounds.
export function occurrenceAt(rule: Pick<RecurringRule, 'frequency' | 'interval' | 'startDate' | 'dayOfMonth'>, k: number): string {
  const interval = Math.max(1, Math.floor(rule.interval || 1));
  if (rule.frequency === 'weekly') return shiftDate(rule.startDate, k * 7 * interval);
  const start = fromDateKey(rule.startDate);
  const months = rule.frequency === 'monthly' ? k * interval : k * interval * 12;
  const index = start.getFullYear() * 12 + start.getMonth() + months;
  const year = Math.floor(index / 12);
  const monthIndex = index % 12;
  const day = Math.min(rule.dayOfMonth ?? start.getDate(), lastDayOfMonth(year, monthIndex));
  return `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
}

// Every occurrence in [from, to] (inclusive date keys), oldest first.
export function occurrencesBetween(
  rule: Pick<RecurringRule, 'frequency' | 'interval' | 'startDate' | 'dayOfMonth' | 'endDate'>,
  from: string,
  to: string
): string[] {
  const end = rule.endDate && rule.endDate < to ? rule.endDate : to;
  const dates: string[] = [];
  for (let k = 0; k < MAX_STEPS; k++) {
    const date = occurrenceAt(rule, k);
    if (date > end) break;
    if (date >= from && date >= rule.startDate) dates.push(date);
  }
  return dates;
}

export function isOccurrence(rule: RecurringRule, date: string): boolean {
  return occurrencesBetween(rule, date, date).length === 1;
}

// Occurrence dates of `ruleId` that already have a transaction.
export function recordedOccurrences(state: Pick<FinanceState, 'transactions'>, ruleId: string): Set<string> {
  const dates = new Set<string>();
  for (const tx of state.transactions) {
    if (tx.recurringRuleId === ruleId && tx.occurrenceDate) dates.add(tx.occurrenceDate);
  }
  return dates;
}

function isHandled(rule: RecurringRule, recorded: Set<string>, date: string) {
  return recorded.has(date) || rule.skippedDates.includes(date);
}

export interface Occurrence {
  rule: RecurringRule;
  date: string;
}

const byDateThenName = (a: Occurrence, b: Occurrence) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : a.rule.name.localeCompare(b.rule.name);

// Every unhandled occurrence on or before `today` of active rules (missed ones included),
// oldest first. Filter by mode for the auto-processor or the inbox.
export function dueOccurrences(state: State, today: string, mode?: RecurringRule['mode']): Occurrence[] {
  const due: Occurrence[] = [];
  for (const rule of state.recurringRules) {
    if (!rule.active || (mode && rule.mode !== mode)) continue;
    const recorded = recordedOccurrences(state, rule.id);
    for (const date of occurrencesBetween(rule, rule.startDate, today)) {
      if (!isHandled(rule, recorded, date)) due.push({ rule, date });
    }
  }
  return due.sort(byDateThenName);
}

// First unhandled occurrence on or after `today` ('' when the rule has none left).
export function nextOccurrence(state: Pick<FinanceState, 'transactions'>, rule: RecurringRule, today: string): string {
  const recorded = recordedOccurrences(state, rule.id);
  for (let k = 0; k < MAX_STEPS; k++) {
    const date = occurrenceAt(rule, k);
    if (rule.endDate && date > rule.endDate) return '';
    if (date >= today && date >= rule.startDate && !isHandled(rule, recorded, date)) return date;
  }
  return '';
}

export type CurrencyTotals = Record<CurrencyCode, number>;

export interface Upcoming {
  items: Occurrence[];
  // Income and expense amounts per currency (transfers move money, so they're excluded).
  income: CurrencyTotals;
  expense: CurrencyTotals;
}

// Unhandled occurrences of active rules in the next `days` days (after today, up to today +
// days), soonest first, with totals per currency.
export function upcoming(state: State, days: number, today: string): Upcoming {
  const until = shiftDate(today, days);
  const from = shiftDate(today, 1);
  const items: Occurrence[] = [];
  for (const rule of state.recurringRules) {
    if (!rule.active) continue;
    const recorded = recordedOccurrences(state, rule.id);
    for (const date of occurrencesBetween(rule, from, until)) {
      if (!isHandled(rule, recorded, date)) items.push({ rule, date });
    }
  }
  items.sort(byDateThenName);
  const income: CurrencyTotals = { EGP: 0, SAR: 0, USD: 0 };
  const expense: CurrencyTotals = { EGP: 0, SAR: 0, USD: 0 };
  for (const { rule } of items) {
    if (rule.kind === 'income') income[rule.currency] += rule.amount;
    if (rule.kind === 'expense') expense[rule.currency] += rule.amount;
  }
  return { items, income, expense };
}

// Average amount per month (in the rule's currency): weekly × 52/12, monthly × 1, yearly ÷ 12,
// all divided by the interval.
export function monthlyEquivalent(rule: Pick<RecurringRule, 'amount' | 'frequency' | 'interval'>): number {
  const perPeriod = rule.amount / Math.max(1, rule.interval || 1);
  if (rule.frequency === 'weekly') return (perPeriod * 52) / 12;
  if (rule.frequency === 'yearly') return perPeriod / 12;
  return perPeriod;
}

// Rules that can still produce occurrences (active and not past their end date).
export function isLive(rule: RecurringRule, today: string): boolean {
  return rule.active && !(rule.endDate && rule.endDate < today);
}

export interface ScheduledReminder {
  id: string;
  rule: RecurringRule;
  date: string;
  // Local 10:00 on the occurrence date.
  at: Date;
}

// Reminders for 'confirm' rules: one per unhandled occurrence in the next `horizonDays`,
// at 10:00 local time, skipping ones whose time has passed. Capped (iOS allows 64 pending).
export function reminderSchedule(state: State, now: Date, horizonDays = 60, max = 40): ScheduledReminder[] {
  const today = toDateKey(now);
  const until = shiftDate(today, horizonDays);
  const reminders: ScheduledReminder[] = [];
  for (const rule of state.recurringRules) {
    if (!rule.active || rule.mode !== 'confirm') continue;
    const recorded = recordedOccurrences(state, rule.id);
    for (const date of occurrencesBetween(rule, today, until)) {
      if (isHandled(rule, recorded, date)) continue;
      const at = fromDateKey(date);
      at.setHours(10, 0, 0, 0);
      if (at.getTime() <= now.getTime()) continue;
      reminders.push({ id: `due-${rule.id}-${date}`, rule, date, at });
    }
  }
  return reminders.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, max);
}
