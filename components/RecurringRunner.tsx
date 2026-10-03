import { useEffect } from 'react';
import { AppState } from 'react-native';

import { reminderSchedule } from '@/store/recurring';
import { useFinanceStore } from '@/store/useFinanceStore';
import { formatCurrency } from '@/utils/formatters';
import { cancelReminders, replaceReminders } from '@/utils/notifications';

// Invisible root helper:
// - records due 'auto' recurring occurrences once data has loaded and whenever the app comes
//   back to the foreground (processDue is idempotent, so extra runs are harmless);
// - keeps the local due reminders in sync with the rules while "تنبيهات المستحقات" is on.
export function RecurringRunner() {
  const hydrated = useFinanceStore((s) => s.hasHydrated);
  const rules = useFinanceStore((s) => s.recurringRules);
  const transactions = useFinanceStore((s) => s.transactions);
  const remindersOn = useFinanceStore((s) => !!s.settings.dueNotificationsEnabled);

  useEffect(() => {
    if (!hydrated) return;
    useFinanceStore.getState().processDue();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') useFinanceStore.getState().processDue();
    });
    return () => subscription.remove();
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const sync = remindersOn
      ? replaceReminders(
          reminderSchedule({ recurringRules: rules, transactions }, new Date()).map(({ id, rule, at }) => ({
            id,
            at,
            title: 'مستحق النهارده',
            body: `${rule.name} ${formatCurrency(rule.amount, rule.currency)}`,
          }))
        )
      : cancelReminders();
    sync.catch(() => {
      // Scheduling is best-effort; the in-app inbox still lists everything due.
    });
  }, [hydrated, remindersOn, rules, transactions]);

  return null;
}
