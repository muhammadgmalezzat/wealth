import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { periodLabel } from '@/components/analytics/analyticsUi';
import { TransactionRow } from '@/components/transactions/TransactionRow';
import { TransactionSheet } from '@/components/transactions/TransactionSheet';
import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListGroup } from '@/components/ui/ListRow';
import { LoadingView } from '@/components/ui/LoadingView';
import { Money } from '@/components/ui/Money';
import { Screen } from '@/components/ui/Screen';
import { space, weight } from '@/constants/theme';
import { describeFilter, drillTransactions, parseDrillParams } from '@/store/analytics';
import { groupTransactionsByDay, type DayGroup } from '@/store/selectors';
import { useFinanceStore } from '@/store/useFinanceStore';
import { formatDayLabel } from '@/utils/formatters';

// The transactions behind a tapped Sankey node, category or insight: ?from&to&currency&oneTime
// &type[&bucket&cats&notCats&oneTimeOnly] (see drillParams). Tap a row to edit it.
export default function PeriodTransactionsScreen() {
  const params = useLocalSearchParams<Record<string, string>>();
  const state = useFinanceStore();
  const [editingId, setEditingId] = useState<string | null>(null);

  if (!state.hasHydrated) return <LoadingView />;

  const parsed = parseDrillParams(params);
  if (!parsed) {
    return (
      <Screen edges={['bottom']}>
        <EmptyState icon="error-outline" title="مش قادر أفتح القايمة دي." body="ارجع للتحليلات وجرّب تاني." />
      </Screen>
    );
  }

  const { query, filter } = parsed;
  const result = drillTransactions(state, query, filter);
  const days = groupTransactionsByDay(result.transactions);
  const editing = editingId ? state.transactions.find((t) => t.id === editingId) : undefined;
  const title = describeFilter(state, filter);

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title }} />
      <FlatList<DayGroup>
        data={days}
        keyExtractor={(day) => day.date}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <Card variant="subtle" style={styles.summary}>
            <AppText variant="caption" color="textSecondary">
              {periodLabel(query.period)} · {result.transactions.length} معاملة
            </AppText>
            <Money amount={result.total} currency={query.currency} size="md" />
          </Card>
        }
        ListEmptyComponent={
          <AppText variant="secondary" color="textSecondary" align="center" style={styles.empty}>
            مفيش معاملات هنا.
          </AppText>
        }
        renderItem={({ item: day }) => (
          <View style={styles.day}>
            <AppText variant="caption" color="textSecondary" style={styles.dayLabel}>
              {formatDayLabel(day.date)}
            </AppText>
            <ListGroup>
              {day.transactions.map((tx) => (
                <TransactionRow key={tx.id} tx={tx} state={state} onPress={() => setEditingId(tx.id)} />
              ))}
            </ListGroup>
          </View>
        )}
      />
      {editing && <TransactionSheet key={editing.id} transaction={editing} onClose={() => setEditingId(null)} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, paddingBottom: space.xxxl },
  summary: { gap: space.xs, marginBottom: space.sm },
  day: { marginTop: space.lg, gap: space.sm },
  dayLabel: { fontWeight: weight.semibold },
  empty: { marginTop: space.xxl },
});
