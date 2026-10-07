import type { ComponentProps } from 'react';
import type MaterialIcons from '@expo/vector-icons/MaterialIcons';

import type { InsightTone } from '@/components/ui/InsightCard';
import type { ActionSeverity } from '@/store/nextActions';
import { upcoming, type Occurrence } from '@/store/recurring';
import { fundDueDate, fundsByPriority, fundStatus } from '@/store/selectors';
import type { FinanceState, Fund } from '@/store/types';
import { toDateKey } from '@/utils/dates';

// Read-only helpers for the Home screen, built only on existing selectors. Pure (no React
// Native), so they are unit-tested in tests/logic.test.ts. What to do next comes from the Next
// Best Action engine (store/nextActions.ts).

// Moved to utils (the action engine uses them too); re-exported for existing callers.
export { daysBetween } from '@/utils/dates';
export { dueCountPhrase, withinDaysPhrase } from '@/utils/formatters';

const UPCOMING_LIST_DAYS = 30;

type IconName = ComponentProps<typeof MaterialIcons>['name'];

// How an action's severity looks on the existing InsightCard / ListRow tones.
export const SEVERITY_LOOK: Record<ActionSeverity, { tone: InsightTone; icon: IconName; listTone: 'neutral' | 'ok' | 'gold' }> = {
  urgent: { tone: 'danger', icon: 'error-outline', listTone: 'neutral' },
  warning: { tone: 'attention', icon: 'info-outline', listTone: 'neutral' },
  opportunity: { tone: 'ok', icon: 'lightbulb-outline', listTone: 'ok' },
  info: { tone: 'ok', icon: 'info-outline', listTone: 'neutral' },
};

// Funds for Home: behind first, then pending (this month's contribution not in yet), then the
// nearest due date, then priority order.
export function homeFunds(state: FinanceState, now: Date = new Date(), max = 3): Fund[] {
  const ordered = fundsByPriority(state);
  const rank = new Map(ordered.map((f, i) => [f.id, i]));
  const urgency = new Map(
    ordered.map((f) => {
      const status = fundStatus(state, f.id, now);
      return [f.id, status === 'behind' ? 2 : status === 'pending' ? 1 : 0];
    })
  );
  return [...ordered]
    .sort((a, b) => {
      const byUrgency = (urgency.get(b.id) ?? 0) - (urgency.get(a.id) ?? 0);
      if (byUrgency !== 0) return byUrgency;
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
