import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GoalCard } from '@/components/dashboard/GoalCard';
import { NetWorthCard } from '@/components/dashboard/NetWorthCard';
import { Card } from '@/components/ui/Card';
import { LoadingView } from '@/components/ui/LoadingView';
import { StatCard } from '@/components/ui/StatCard';
import { Colors, FinanceColors } from '@/constants/theme';
import { goldMarketValueEGP, liquidTotalEGP, netWorthEGP } from '@/store/selectors';
import type { Transaction } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { formatCurrency, formatDate } from '@/utils/formatters';

// ---------------------------------------------------------------------------
// Local component — only used on this screen
// ---------------------------------------------------------------------------
interface TxRowProps {
  tx: Transaction;
  isLast: boolean;
}

function TxRow({ tx, isLast }: TxRowProps) {
  const isIncome = tx.type === 'income';
  return (
    <View style={[styles.txRow, !isLast && styles.txRowBorder]}>
      <View style={styles.txLeft}>
        <Text style={styles.txCategory}>{tx.category}</Text>
        <Text style={styles.txDate}>{formatDate(tx.date)}</Text>
      </View>
      <Text
        style={[
          styles.txAmount,
          { color: isIncome ? FinanceColors.income : FinanceColors.expense },
        ]}>
        {isIncome ? '+' : '−'}{formatCurrency(tx.amount, tx.currency)}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Dashboard screen
// ---------------------------------------------------------------------------
export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const state = useFinanceStore();

  if (!state.hasHydrated) return <LoadingView />;

  const { goals, transactions } = state;
  const MONTHLY_SAVINGS = 17_000;

  const recentTx = transactions.slice(0, 5);

  const todayArabic = new Date().toLocaleDateString('ar-EG', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
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

      {/* ── Quick Stats ────────────────────────────────────────── */}
      <View style={[styles.section, styles.statsRow]}>
        <StatCard label="سيولة" amountEGP={liquidTotalEGP(state)} accentColor={Colors.light.tint} />
        <StatCard label="ذهب" amountEGP={goldMarketValueEGP(state)} accentColor={FinanceColors.gold} />
        <StatCard label="ادخار شهري" amountEGP={MONTHLY_SAVINGS} accentColor={FinanceColors.income} />
      </View>

      {/* ── Goals ──────────────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>الأهداف</Text>
        {goals.map((goal) => (
          <View key={goal.id} style={styles.goalItem}>
            <GoalCard goal={goal} />
          </View>
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
              <TxRow key={tx.id} tx={tx} isLast={idx === recentTx.length - 1} />
            ))
          )}
        </Card>
      </View>

      <View style={{ height: insets.bottom + 24 }} />
    </ScrollView>
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

  // Goals
  goalItem: {
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
