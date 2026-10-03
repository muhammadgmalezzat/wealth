import { useState } from 'react';
import { SectionList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { TransactionRow } from '@/components/transactions/TransactionRow';
import { TransactionSheet } from '@/components/transactions/TransactionSheet';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { Fab, FAB_CLEARANCE } from '@/components/ui/Fab';
import { LoadingView } from '@/components/ui/LoadingView';
import { MonthSwitcher } from '@/components/ui/MonthSwitcher';
import { Screen } from '@/components/ui/Screen';
import { StatCard } from '@/components/ui/StatCard';
import { Colors, FinanceColors } from '@/constants/theme';
import {
  groupTransactionsByDay,
  monthSummary,
  transactionsForMonth,
  type TransactionFilter,
} from '@/store/selectors';
import { useFinanceStore } from '@/store/useFinanceStore';
import { toMonthKey } from '@/utils/dates';
import { formatCurrency, formatDayLabel } from '@/utils/formatters';

const FILTERS: { label: string; value: TransactionFilter }[] = [
  { label: 'الكل', value: 'all' },
  { label: 'مصروف', value: 'expense' },
  { label: 'دخل', value: 'income' },
  { label: 'تحويل', value: 'transfer' },
  { label: 'ذهب', value: 'asset_purchase' },
];

// 'add' opens an empty sheet; a transaction id opens it for editing.
type SheetTarget = 'add' | { id: string } | null;

const signedColor = (value: number) =>
  value > 0 ? FinanceColors.income : value < 0 ? FinanceColors.expense : Colors.light.text;

const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatCurrency(Math.abs(value), 'EGP')}`;

export default function TransactionsScreen() {
  const state = useFinanceStore();
  const [month, setMonth] = useState(() => toMonthKey(new Date()));
  const [filter, setFilter] = useState<TransactionFilter>('all');
  const [sheet, setSheet] = useState<SheetTarget>(null);

  if (!state.hasHydrated) return <LoadingView />;

  const summary = monthSummary(state, month);
  const sections = groupTransactionsByDay(transactionsForMonth(state, month, filter)).map((day) => ({
    ...day,
    data: day.transactions,
  }));
  const editing =
    sheet && sheet !== 'add' ? state.transactions.find((t) => t.id === sheet.id) : undefined;

  const header = (
    <View>
      <MonthSwitcher month={month} onChange={setMonth} />

      {/* ── Month summary ── */}
      <View style={styles.summaryRow}>
        <StatCard label="دخل" amountEGP={summary.incomeEGP} accentColor={FinanceColors.income} />
        <StatCard label="مصروف" amountEGP={summary.expenseEGP} accentColor={FinanceColors.expense} />
        <StatCard
          label="الصافي"
          amountEGP={summary.netCashFlow}
          accentColor={summary.netCashFlow < 0 ? FinanceColors.expense : FinanceColors.income}
          amountColor={signedColor(summary.netCashFlow)}
        />
      </View>

      {/* ── Filters ── */}
      <View style={styles.filters}>
        <ChipRow>
          {FILTERS.map((f) => (
            <Chip key={f.value} label={f.label} selected={filter === f.value} onPress={() => setFilter(f.value)} />
          ))}
        </ChipRow>
      </View>
    </View>
  );

  return (
    <Screen overlay={<Fab placement="tab" onPress={() => setSheet('add')} accessibilityLabel="إضافة معاملة" />}>
      <SectionList
        sections={sections}
        keyExtractor={(tx) => tx.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={[styles.content, { paddingTop: 8, paddingBottom: FAB_CLEARANCE }]}
        ListHeaderComponent={header}
        renderSectionHeader={({ section }) => (
          <View style={styles.dayHeader}>
            <Text style={[styles.dayNet, { color: signedColor(section.netEGP) }]}>{signed(section.netEGP)}</Text>
            <Text style={styles.dayLabel}>{formatDayLabel(section.date)}</Text>
          </View>
        )}
        renderItem={({ item, index, section }) => (
          <View
            style={[
              styles.rowWrap,
              index === 0 && styles.rowWrapFirst,
              index === section.data.length - 1 && styles.rowWrapLast,
            ]}>
            <TransactionRow
              tx={item}
              state={state}
              isLast={index === section.data.length - 1}
              onPress={() => setSheet({ id: item.id })}
            />
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>لا توجد معاملات في الشهر ده</Text>
            <TouchableOpacity style={styles.emptyButton} onPress={() => setSheet('add')} activeOpacity={0.85}>
              <Text style={styles.emptyButtonText}>أضف أول معاملة</Text>
            </TouchableOpacity>
          </View>
        }
      />

      {sheet === 'add' && <TransactionSheet onClose={() => setSheet(null)} />}
      {editing && <TransactionSheet key={editing.id} transaction={editing} onClose={() => setSheet(null)} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
  },

  // Summary & filters
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  filters: {
    marginBottom: 8,
  },

  // Day sections
  dayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 8,
  },
  dayLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.light.text,
    textAlign: 'right',
  },
  dayNet: {
    fontSize: 13,
    fontWeight: '600',
  },
  rowWrap: {
    backgroundColor: '#fff',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: FinanceColors.progressTrack,
  },
  rowWrapFirst: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  rowWrapLast: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
  },

  // Empty state
  empty: {
    alignItems: 'center',
    paddingVertical: 48,
    gap: 16,
  },
  emptyText: {
    fontSize: 15,
    color: Colors.light.icon,
  },
  emptyButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: Colors.light.tint,
  },
  emptyButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },

});
