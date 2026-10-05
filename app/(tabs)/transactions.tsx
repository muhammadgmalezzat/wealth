import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { MonthlySnapshot } from '@/components/dashboard/MonthlySnapshot';
import { TransactionRow } from '@/components/transactions/TransactionRow';
import { TransactionSheet } from '@/components/transactions/TransactionSheet';
import { emptyFilterMessage, FILTERS, filterTransactions } from '@/components/transactions/transactionUi';
import { AppText } from '@/components/ui/AppText';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Fab, FAB_CLEARANCE } from '@/components/ui/Fab';
import { ListGroup } from '@/components/ui/ListRow';
import { LoadingView } from '@/components/ui/LoadingView';
import { Money } from '@/components/ui/Money';
import { MonthSwitcher } from '@/components/ui/MonthSwitcher';
import { Screen } from '@/components/ui/Screen';
import { space, weight } from '@/constants/theme';
import { groupTransactionsByDay, transactionsForMonth, type DayGroup, type TransactionFilter } from '@/store/selectors';
import { useFinanceStore } from '@/store/useFinanceStore';
import { toMonthKey } from '@/utils/dates';
import { formatDayLabel } from '@/utils/formatters';

// 'add' opens an empty sheet; a transaction id opens it for editing.
type SheetTarget = 'add' | { id: string } | null;

// "What happened?": month switcher · month snapshot · type filter · days, each one header row
// (day label, day net) and one grouped list of its transactions.
export default function TransactionsScreen() {
  const state = useFinanceStore();
  const [month, setMonth] = useState(() => toMonthKey(new Date()));
  const [filter, setFilter] = useState<TransactionFilter>('all');
  const [sheet, setSheet] = useState<SheetTarget>(null);

  if (!state.hasHydrated) return <LoadingView />;

  const monthTransactions = transactionsForMonth(state, month);
  const days = groupTransactionsByDay(filterTransactions(monthTransactions, filter));
  const editing = sheet && sheet !== 'add' ? state.transactions.find((t) => t.id === sheet.id) : undefined;

  const header = (
    <View style={styles.header}>
      <MonthSwitcher month={month} onChange={setMonth} />
      <MonthlySnapshot state={state} month={month} linkToTransactions={false} />
      <ChipRow>
        {FILTERS.map((f) => (
          <Chip key={f.value} label={f.label} selected={filter === f.value} onPress={() => setFilter(f.value)} />
        ))}
      </ChipRow>
    </View>
  );

  const empty =
    monthTransactions.length === 0 ? (
      <EmptyState
        icon="receipt-long"
        title="مفيش معاملات في الشهر ده."
        body="سجّل مصروف أو دخل عشان تشوف شهرك."
        actionLabel="سجّل معاملة"
        onAction={() => setSheet('add')}
      />
    ) : (
      <AppText variant="secondary" color="textSecondary" align="center" style={styles.noMatch}>
        {emptyFilterMessage(filter)}
      </AppText>
    );

  return (
    <Screen overlay={<Fab placement="tab" onPress={() => setSheet('add')} accessibilityLabel="إضافة معاملة" />}>
      <FlatList<DayGroup>
        data={days}
        keyExtractor={(day) => day.date}
        contentContainerStyle={styles.content}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        renderItem={({ item: day }) => (
          <View style={styles.day}>
            {/* RTL: day label on the right (start), day net on the left (end). Never red. */}
            <View style={styles.dayHeader}>
              <AppText variant="caption" color="textSecondary" style={styles.dayLabel}>
                {formatDayLabel(day.date)}
              </AppText>
              <Money amount={day.netEGP} currency="EGP" size="row" tone="muted" showSign align="left" />
            </View>
            <ListGroup>
              {day.transactions.map((tx) => (
                <TransactionRow key={tx.id} tx={tx} state={state} onPress={() => setSheet({ id: tx.id })} />
              ))}
            </ListGroup>
          </View>
        )}
      />

      {sheet === 'add' && <TransactionSheet onClose={() => setSheet(null)} />}
      {editing && <TransactionSheet key={editing.id} transaction={editing} onClose={() => setSheet(null)} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: FAB_CLEARANCE },
  header: { gap: space.lg, marginBottom: space.sm },
  day: { marginTop: space.lg, gap: space.sm },
  dayHeader: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  dayLabel: { flexShrink: 1, fontWeight: weight.semibold },
  noMatch: { marginTop: space.xxl },
});
