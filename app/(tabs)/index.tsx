import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GoalCard } from '@/components/dashboard/GoalCard';
import { NetWorthCard } from '@/components/dashboard/NetWorthCard';
import { Card } from '@/components/ui/Card';
import { Colors, FinanceColors } from '@/constants/theme';
import { useFinanceStore } from '@/store/useFinanceStore';
import type { Transaction } from '@/store/types';
import { toEGP } from '@/utils/currency';
import { formatCurrency, formatDate } from '@/utils/formatters';

// ---------------------------------------------------------------------------
// Local component — only used on this screen
// ---------------------------------------------------------------------------
interface StatCardProps {
  label: string;
  amount: number;
  accentColor: string;
}

function StatCard({ label, amount, accentColor }: StatCardProps) {
  return (
    <Card style={styles.statCard}>
      <View style={[styles.statAccent, { backgroundColor: accentColor }]} />
      <Text style={styles.statAmount} numberOfLines={1} adjustsFontSizeToFit>
        {formatCurrency(amount, 'EGP')}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Card>
  );
}

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
  const { assets, goals, transactions, exchangeRates } = useFinanceStore();

  // Net worth: liquid assets use amount, gold uses purchase price (no live feed)
  const netWorthEGP = assets.reduce((sum, asset) => {
    if (asset.type === 'gold') {
      return sum + toEGP(asset.purchasePrice ?? 0, asset.currency, exchangeRates);
    }
    return sum + toEGP(asset.amount, asset.currency, exchangeRates);
  }, 0);

  const liquidEGP = assets
    .filter((a) => a.type === 'cash' || a.type === 'bank')
    .reduce((sum, a) => sum + toEGP(a.amount, a.currency, exchangeRates), 0);

  const goldEGP = assets
    .filter((a) => a.type === 'gold')
    .reduce((sum, a) => sum + toEGP(a.purchasePrice ?? 0, a.currency, exchangeRates), 0);

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
        <NetWorthCard totalEGP={netWorthEGP} />
        <Text style={styles.netWorthLabel}>إجمالي الثروة</Text>
      </View>

      {/* ── Quick Stats ────────────────────────────────────────── */}
      <View style={[styles.section, styles.statsRow]}>
        <StatCard label="سيولة" amount={liquidEGP} accentColor={Colors.light.tint} />
        <StatCard label="ذهب" amount={goldEGP} accentColor={FinanceColors.gold} />
        <StatCard label="ادخار شهري" amount={MONTHLY_SAVINGS} accentColor={FinanceColors.income} />
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
  statCard: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 12,
    overflow: 'hidden',
    minWidth: 0,
  },
  statAccent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  statAmount: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.light.text,
    marginTop: 8,
    textAlign: 'right',
  },
  statLabel: {
    fontSize: 11,
    color: Colors.light.icon,
    marginTop: 3,
    textAlign: 'right',
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
