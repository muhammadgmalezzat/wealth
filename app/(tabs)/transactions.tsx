import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState } from 'react';
import { SectionList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TransactionRow } from '@/components/transactions/TransactionRow';
import { TransactionSheet } from '@/components/transactions/TransactionSheet';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { LoadingView } from '@/components/ui/LoadingView';
import { MonthSwitcher } from '@/components/ui/MonthSwitcher';
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
  const insets = useSafeAreaInsets();
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
    <View style={styles.root}>
      <SectionList
        sections={sections}
        keyExtractor={(tx) => tx.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 96 }]}
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

      {/* ── FAB ── */}
      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 24 }]}
        onPress={() => setSheet('add')}
        activeOpacity={0.85}
        accessibilityLabel="إضافة معاملة">
        <MaterialIcons name="add" size={30} color="#fff" />
      </TouchableOpacity>

      {sheet === 'add' && <TransactionSheet onClose={() => setSheet(null)} />}
      {editing && <TransactionSheet key={editing.id} transaction={editing} onClose={() => setSheet(null)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
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

  // FAB
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.light.tint,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
});
