import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { ListGroup, ListRow } from '@/components/ui/ListRow';
import { Money } from '@/components/ui/Money';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { opacity, space, weight } from '@/constants/theme';
import { dueOccurrences } from '@/store/recurring';
import type { FinanceState } from '@/store/types';
import { toDateKey } from '@/utils/dates';
import { formatDayLabel } from '@/utils/formatters';

import { daysBetween, dueCountPhrase, upcomingItems } from './homeInsights';

interface RecurringCardProps {
  state: FinanceState;
  // True when the next-best-action card already asks to review due items.
  dueShownElsewhere?: boolean;
  now?: Date;
}

// "جاي قريب": the next 3 recurring items, plus a calm link to the due inbox when confirm items
// are waiting (unless Home's insight already says so). Renders nothing without content.
export function RecurringCard({ state, dueShownElsewhere = false, now = new Date() }: RecurringCardProps) {
  const today = toDateKey(now);
  const items = upcomingItems(state, now);
  const dueCount = dueShownElsewhere ? 0 : dueOccurrences(state, today, 'confirm').length;
  if (items.length === 0 && dueCount === 0) return null;

  return (
    <>
      <SectionHeader title="جاي قريب" actionLabel="الكل" onAction={() => router.push('/recurring')} />
      {dueCount > 0 && (
        <Pressable
          onPress={() => router.push('/due')}
          hitSlop={8}
          accessibilityRole="button"
          style={({ pressed }) => [styles.dueLink, pressed && { opacity: opacity.pressed }]}>
          <AppText variant="secondary" color="warning" style={styles.dueText}>
            عندك {dueCountPhrase(dueCount)} · راجعهم
          </AppText>
        </Pressable>
      )}
      {items.length > 0 && (
        <ListGroup>
          {items.map(({ rule, date }) => {
            const days = daysBetween(today, date);
            return (
              <ListRow
                key={`${rule.id}-${date}`}
                title={rule.name}
                subtitle={days <= 2 ? formatDayLabel(date, now) : `بعد ${days} ${days <= 10 ? 'أيام' : 'يوم'} · ${formatDayLabel(date, now)}`}
                icon={rule.kind === 'income' ? 'south-west' : rule.kind === 'transfer' ? 'swap-horiz' : 'event'}
                iconTone={rule.kind === 'income' ? 'ok' : 'neutral'}
                trailing={
                  <Money amount={rule.amount} currency={rule.currency} tone={rule.kind === 'income' ? 'positive' : 'default'} />
                }
                onPress={() => router.push('/recurring')}
              />
            );
          })}
        </ListGroup>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  dueLink: { marginBottom: space.sm, alignSelf: 'flex-end' },
  dueText: { fontWeight: weight.semibold },
});
