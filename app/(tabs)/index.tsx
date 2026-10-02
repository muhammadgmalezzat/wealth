import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EditFundSheet } from '@/components/dashboard/EditFundSheet';
import { FundCard } from '@/components/dashboard/FundCard';
import { NetWorthCard } from '@/components/dashboard/NetWorthCard';
import { Card } from '@/components/ui/Card';
import { LoadingView } from '@/components/ui/LoadingView';
import { StatCard } from '@/components/ui/StatCard';
import { Colors, FinanceColors } from '@/constants/theme';
import {
  fundCurrent,
  fundProgress,
  holdingsTotalEGP,
  liquidTotalEGP,
  monthSummary,
  netWorthEGP,
  unassignedEGP,
} from '@/store/selectors';
import type { CurrencyCode, FinanceStateV2, Transaction } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { toMonthKey } from '@/utils/dates';
import { formatCurrency, formatDate } from '@/utils/formatters';

// ---------------------------------------------------------------------------
// Local component — only used on this screen
// ---------------------------------------------------------------------------
interface TxRowProps {
  tx: Transaction;
  label: string;
  currency: CurrencyCode;
  isLast: boolean;
}

function TxRow({ tx, label, currency, isLast }: TxRowProps) {
  const sign = tx.type === 'income' ? '+' : tx.type === 'expense' ? '−' : '';
  const color =
    tx.type === 'income'
      ? FinanceColors.income
      : tx.type === 'expense'
        ? FinanceColors.expense
        : Colors.light.text;
  return (
    <View style={[styles.txRow, !isLast && styles.txRowBorder]}>
      <View style={styles.txLeft}>
        <Text style={styles.txCategory}>{label}</Text>
        <Text style={styles.txDate}>{formatDate(tx.date)}</Text>
      </View>
      <Text style={[styles.txAmount, { color }]}>
        {sign}
        {formatCurrency(tx.amount, currency)}
      </Text>
    </View>
  );
}

// Row label and display currency; transfers show in the source account's currency.
function describeTx(state: FinanceStateV2, tx: Transaction): { label: string; currency: CurrencyCode } {
  if (tx.type === 'transfer') {
    const from = state.accounts.find((a) => a.id === tx.fromAccountId);
    return { label: 'تحويل', currency: from?.currency ?? 'EGP' };
  }
  const category = state.categories.find((c) => c.id === tx.categoryId);
  return { label: category?.name ?? '—', currency: tx.currency };
}

// ---------------------------------------------------------------------------
// Dashboard screen
// ---------------------------------------------------------------------------
export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const state = useFinanceStore();
  const [editingFundId, setEditingFundId] = useState<string | null>(null);

  if (!state.hasHydrated) return <LoadingView />;

  const { transactions } = state;
  const funds = state.funds.filter((f) => !f.archived).sort((a, b) => a.priority - b.priority);
  const editingFund = funds.find((f) => f.id === editingFundId);
  // 0 when the month has no transactions.
  const monthNetEGP = monthSummary(state, toMonthKey(new Date())).netCashFlow;

  const recentTx = transactions.slice(0, 5);

  const todayArabic = new Date().toLocaleDateString('ar-EG', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
        showsVerticalScrollIndicator={false}>
        {/* ── Header ─────────────────────────────────────────────── */}
        <View style={styles.header}>
          <View>
            <Text style={styles.appTitle}>Wealth</Text>
            <Text style={styles.greeting}>مرحباً</Text>
          </View>
          <Text style={styles.dateText}>{todayArabic}</Text>
        </View>

        {/* ── Net Worth ──────────────────────────────────────────── */}
        <View style={styles.section}>
          <NetWorthCard totalEGP={netWorthEGP(state)} />
          <Text style={styles.netWorthLabel}>إجمالي الثروة</Text>
        </View>

        {/* ── Unassigned money ───────────────────────────────────── */}
        <View style={[styles.section, styles.statsRow]}>
          <StatCard label="فلوس بدون وظيفة" amountEGP={unassignedEGP(state)} accentColor={Colors.light.icon} />
        </View>

        {/* ── Quick Stats ────────────────────────────────────────── */}
        <View style={[styles.section, styles.statsRow]}>
          <StatCard label="سيولة" amountEGP={liquidTotalEGP(state)} accentColor={Colors.light.tint} />
          <StatCard label="استثمارات" amountEGP={holdingsTotalEGP(state)} accentColor={FinanceColors.gold} />
          <StatCard label="صافي الشهر" amountEGP={monthNetEGP} accentColor={FinanceColors.income} />
        </View>

        {/* ── Funds ──────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>الصناديق</Text>
          {funds.map((fund) => (
            <TouchableOpacity
              key={fund.id}
              style={styles.fundItem}
              onPress={() => setEditingFundId(fund.id)}
              activeOpacity={0.8}>
              <FundCard
                fund={fund}
                current={fundCurrent(state, fund.id)}
                progress={fundProgress(state, fund.id)}
              />
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Recent Transactions ────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>آخر المعاملات</Text>
          <Card style={styles.txCard}>
            {recentTx.length === 0 ? (
              <Text style={styles.emptyText}>لا توجد معاملات بعد</Text>
            ) : (
              recentTx.map((tx, idx) => (
                <TxRow
                  key={tx.id}
                  tx={tx}
                  {...describeTx(state, tx)}
                  isLast={idx === recentTx.length - 1}
                />
              ))
            )}
          </Card>
        </View>

        <View style={{ height: insets.bottom + 24 }} />
      </ScrollView>

      {editingFund && (
        <EditFundSheet key={editingFund.id} fund={editingFund} onClose={() => setEditingFundId(null)} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 0,
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  appTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: Colors.light.text,
  },
  greeting: {
    fontSize: 13,
    color: Colors.light.icon,
    marginTop: 2,
  },
  dateText: {
    fontSize: 13,
    color: Colors.light.icon,
    textAlign: 'right',
    marginTop: 6,
    maxWidth: 160,
  },

  // Section spacing
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.light.text,
    textAlign: 'right',
    marginBottom: 12,
  },

  // Net Worth label
  netWorthLabel: {
    fontSize: 12,
    color: Colors.light.icon,
    textAlign: 'center',
    marginTop: 6,
  },

  // Quick stats
  statsRow: {
    flexDirection: 'row',
    gap: 10,
  },

  // Funds
  fundItem: {
    marginBottom: 10,
  },

  // Transactions
  txCard: {
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  txRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  txRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: FinanceColors.progressTrack,
  },
  txLeft: {
    flex: 1,
  },
  txCategory: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.light.text,
  },
  txDate: {
    fontSize: 12,
    color: Colors.light.icon,
    marginTop: 2,
  },
  txAmount: {
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 12,
  },
  emptyText: {
    textAlign: 'center',
    color: Colors.light.icon,
    fontSize: 14,
    paddingVertical: 24,
  },
});
