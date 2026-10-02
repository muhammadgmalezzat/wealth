import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { BackupReminder } from '@/components/dashboard/BackupReminder';
import { NetWorthCard } from '@/components/dashboard/NetWorthCard';
import { FundCard } from '@/components/funds/FundCard';
import { UnassignedPanel } from '@/components/funds/UnassignedPanel';
import { TransactionRow } from '@/components/transactions/TransactionRow';
import { TransactionSheet } from '@/components/transactions/TransactionSheet';
import { Card } from '@/components/ui/Card';
import { LoadingView } from '@/components/ui/LoadingView';
import { StatCard } from '@/components/ui/StatCard';
import { Colors, FinanceColors } from '@/constants/theme';
import {
  fundsByPriority,
  holdingsTotalEGP,
  liquidTotalEGP,
  monthSummary,
  netWorthByLocation,
  netWorthEGP,
  recentTransactions,
} from '@/store/selectors';
import { useFinanceStore } from '@/store/useFinanceStore';
import { toMonthKey } from '@/utils/dates';
import { formatCurrency } from '@/utils/formatters';

// 'add' opens an empty transaction sheet; an id opens it for editing.
type TxSheetTarget = 'add' | { id: string } | null;

// ---------------------------------------------------------------------------
// Dashboard screen
// ---------------------------------------------------------------------------
export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const state = useFinanceStore();
  const [txSheet, setTxSheet] = useState<TxSheetTarget>(null);

  if (!state.hasHydrated) return <LoadingView />;

  const funds = fundsByPriority(state);
  // 0 when the month has no transactions.
  const monthNetEGP = monthSummary(state, toMonthKey(new Date())).netCashFlow;

  const recentTx = recentTransactions(state, 5);
  const byLocation = netWorthByLocation(state);
  const editingTx =
    txSheet && txSheet !== 'add' ? state.transactions.find((t) => t.id === txSheet.id) : undefined;

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
          <View style={styles.headerRight}>
            <TouchableOpacity
              onPress={() => router.push('/settings')}
              hitSlop={10}
              accessibilityLabel="الإعدادات">
              <MaterialIcons name="settings" size={24} color={Colors.light.icon} />
            </TouchableOpacity>
            <Text style={styles.dateText}>{todayArabic}</Text>
          </View>
        </View>

        <BackupReminder lastBackupAt={state.settings.lastBackupAt} />

        {/* ── Net Worth ──────────────────────────────────────────── */}
        <View style={styles.section}>
          <NetWorthCard totalEGP={netWorthEGP(state)} />
          <Text style={styles.locationSplit}>
            مصر {formatCurrency(byLocation.EG, 'EGP')} · السعودية {formatCurrency(byLocation.SA, 'EGP')}
          </Text>
          <Text style={styles.netWorthLabel}>إجمالي الثروة</Text>
        </View>

        {/* ── Unassigned money ───────────────────────────────────── */}
        <View style={styles.section}>
          <UnassignedPanel state={state} />
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
            <View key={fund.id} style={styles.fundItem}>
              <FundCard
                fund={fund}
                state={state}
                onPress={() => router.push({ pathname: '/fund/[id]', params: { id: fund.id } })}
              />
            </View>
          ))}
        </View>

        {/* ── Recent Transactions ────────────────────────────────── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <TouchableOpacity onPress={() => setTxSheet('add')} hitSlop={8}>
              <Text style={styles.addTxText}>+ معاملة</Text>
            </TouchableOpacity>
            <Text style={[styles.sectionTitle, styles.sectionTitleInline]}>آخر المعاملات</Text>
          </View>
          <Card style={styles.txCard}>
            {recentTx.length === 0 ? (
              <Text style={styles.emptyText}>لا توجد معاملات بعد</Text>
            ) : (
              recentTx.map((tx, idx) => (
                <TransactionRow
                  key={tx.id}
                  tx={tx}
                  state={state}
                  showDate
                  isLast={idx === recentTx.length - 1}
                  onPress={() => setTxSheet({ id: tx.id })}
                />
              ))
            )}
          </Card>
        </View>

        <View style={{ height: insets.bottom + 24 }} />
      </ScrollView>

      {txSheet === 'add' && <TransactionSheet onClose={() => setTxSheet(null)} />}
      {editingTx && (
        <TransactionSheet key={editingTx.id} transaction={editingTx} onClose={() => setTxSheet(null)} />
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
  headerRight: {
    alignItems: 'flex-end',
    gap: 6,
  },
  locationSplit: {
    fontSize: 12,
    color: Colors.light.icon,
    textAlign: 'center',
    marginTop: 8,
  },
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
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitleInline: {
    marginBottom: 0,
  },
  addTxText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.light.tint,
  },
  txCard: {
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  emptyText: {
    textAlign: 'center',
    color: Colors.light.icon,
    fontSize: 14,
    paddingVertical: 24,
  },
});
