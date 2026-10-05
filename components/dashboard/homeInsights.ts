import { formatMoney } from '@/components/ui/formatMoney';
import { dueOccurrences, upcoming, type Occurrence } from '@/store/recurring';
import { fundDueDate, fundRequiredMonthly, fundsByPriority, fundStatus, unassignedEGP } from '@/store/selectors';
import type { FinanceState, Fund } from '@/store/types';
import { fromDateKey, toDateKey } from '@/utils/dates';

// Read-only helpers for the Home screen, built only on existing selectors. Pure (no React
// Native), so they are unit-tested in tests/logic.test.ts.

export type HomeActionKind = 'cover' | 'due' | 'upcoming' | 'fund' | 'assign';

export interface HomeAction {
  kind: HomeActionKind;
  tone: 'ok' | 'attention' | 'danger';
  message: string;
  actionLabel: string;
  // 'fund' only: the fund to open.
  fundId?: string;
}

// Same tolerance as the unassigned panel (float noise isn't money).
const EPSILON = 0.005;
const UPCOMING_DAYS = 3;
const UPCOMING_LIST_DAYS = 30;

// "مستحق واحد" / "مستحقين" / "3 مستحقات" / "11 مستحق".
export function dueCountPhrase(n: number): string {
  if (n === 1) return 'مستحق واحد محتاج مراجعة';
  if (n === 2) return 'مستحقين محتاجين مراجعة';
  if (n >= 3 && n <= 10) return `${n} مستحقات محتاجة مراجعة`;
  return `${n} مستحق محتاج مراجعة`;
}

// "خلال يوم" / "خلال يومين" / "خلال 3 أيام".
export function withinDaysPhrase(days: number): string {
  if (days <= 1) return 'خلال يوم';
  if (days === 2) return 'خلال يومين';
  if (days <= 10) return `خلال ${days} أيام`;
  return `خلال ${days} يوم`;
}

// Whole days from `from` to `to` (local date keys; rounding absorbs DST hours).
export function daysBetween(from: string, to: string): number {
  return Math.round((fromDateKey(to).getTime() - fromDateKey(from).getTime()) / 86_400_000);
}

// The single most useful thing to do now, or null. Priority:
// 1. fund money was spent (unassigned < 0) → cover
// 2. 'confirm' recurring items are due → review them
// 3. an item is due within 3 days → look at what's coming
// 4. a fund is behind and needs money this month → allocate
// 5. money without a job (unassigned > 0) → assign
export function nextBestAction(state: FinanceState, now: Date = new Date()): HomeAction | null {
  const today = toDateKey(now);
  const unassigned = unassignedEGP(state);

  if (unassigned < -EPSILON) {
    return { kind: 'cover', tone: 'danger', message: 'استخدمت جزء من فلوس الصناديق.', actionLabel: 'غطّي الفرق' };
  }

  const due = dueOccurrences(state, today, 'confirm');
  if (due.length > 0) {
    return { kind: 'due', tone: 'attention', message: `عندك ${dueCountPhrase(due.length)}.`, actionLabel: 'راجعهم' };
  }

  const soon = upcoming(state, UPCOMING_DAYS, today).items[0];
  if (soon) {
    return {
      kind: 'upcoming',
      tone: 'attention',
      message: `${soon.rule.name} مستحق ${withinDaysPhrase(daysBetween(today, soon.date))}.`,
      actionLabel: 'راجع المستحقات',
    };
  }

  for (const fund of fundsByPriority(state)) {
    if (fundStatus(state, fund.id, now) !== 'behind') continue;
    const required = fundRequiredMonthly(state, fund.id, now) ?? 0;
    if (required <= EPSILON) continue;
    return {
      kind: 'fund',
      tone: 'attention',
      message: `${fund.name} محتاج ${formatMoney(required, fund.currency)} هذا الشهر عشان يفضل على المسار.`,
      actionLabel: 'خصص الآن',
      fundId: fund.id,
    };
  }

  if (unassigned > EPSILON) {
    return {
      kind: 'assign',
      tone: 'ok',
      message: `عندك ${formatMoney(unassigned, 'EGP')} لسه محتاجة تتوزع.`,
      actionLabel: 'وزّع أموالك',
    };
  }
  return null;
}

// Funds for Home: behind first, then the nearest due date, then priority order.
export function homeFunds(state: FinanceState, now: Date = new Date(), max = 3): Fund[] {
  const ordered = fundsByPriority(state);
  const rank = new Map(ordered.map((f, i) => [f.id, i]));
  const behind = new Set(ordered.filter((f) => fundStatus(state, f.id, now) === 'behind').map((f) => f.id));
  return [...ordered]
    .sort((a, b) => {
      const byBehind = Number(behind.has(b.id)) - Number(behind.has(a.id));
      if (byBehind !== 0) return byBehind;
      const dueA = fundDueDate(a);
      const dueB = fundDueDate(b);
      if (dueA && dueB && dueA !== dueB) return dueA < dueB ? -1 : 1;
      if (dueA && !dueB) return -1;
      if (!dueA && dueB) return 1;
      return (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0);
    })
    .slice(0, max);
}

// The next recurring items (within 30 days), soonest first.
export function upcomingItems(state: FinanceState, now: Date = new Date(), max = 3): Occurrence[] {
  return upcoming(state, UPCOMING_LIST_DAYS, toDateKey(now)).items.slice(0, max);
}
