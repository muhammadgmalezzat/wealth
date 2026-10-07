import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { homeFunds } from '@/components/dashboard/homeInsights';
import { MonthlySnapshot } from '@/components/dashboard/MonthlySnapshot';
import { NetWorthCard } from '@/components/dashboard/NetWorthCard';
import { NextActionsCard } from '@/components/dashboard/NextActionsCard';
import { RecurringCard } from '@/components/dashboard/RecurringCard';
import { SafeToSpendCard } from '@/components/dashboard/SafeToSpendCard';
import { AssignSheet } from '@/components/funds/AssignSheet';
import { CoverSheet } from '@/components/funds/CoverSheet';
import { FundCard } from '@/components/funds/FundCard';
import { FundSheet } from '@/components/funds/FundSheet';
import { UnassignedPanel } from '@/components/funds/UnassignedPanel';
import { TransactionRow } from '@/components/transactions/TransactionRow';
import { TransactionSheet } from '@/components/transactions/TransactionSheet';
import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { InsightCard } from '@/components/ui/InsightCard';
import { ListGroup } from '@/components/ui/ListRow';
import { LoadingView } from '@/components/ui/LoadingView';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { colors, opacity, space } from '@/constants/theme';
import { nextActions, pendingReviewMonth, REVIEW_PROMPT_DAYS, type NextAction } from '@/store/nextActions';
import { planFor } from '@/store/planning';
import { recentTransactions } from '@/store/selectors';
import { useFinanceStore } from '@/store/useFinanceStore';
import { toMonthKey } from '@/utils/dates';
import { formatMonthLabel } from '@/utils/formatters';
import { runAction } from '@/utils/runAction';

// 'add' opens an empty transaction sheet; an id opens it for editing.
type TxSheetTarget = 'add' | { id: string } | null;

// Home answers "what should I know / do now?": daily decisions first (safe to spend, last
// month's review early in the month, the next best actions, this month, what's coming),
// long-term figures after (funds, net worth).
export default function HomeScreen() {
  const state = useFinanceStore();
  const [txSheet, setTxSheet] = useState<TxSheetTarget>(null);
  const [fundSheet, setFundSheet] = useState<'assign' | 'cover' | 'emergency' | null>(null);

  if (!state.hasHydrated) return <LoadingView />;

  const now = new Date();
  // Early in the month the review gets its own card, so the action list doesn't repeat it.
  const reviewMonth = now.getDate() <= REVIEW_PROMPT_DAYS ? pendingReviewMonth(state, now) : null;
  const hasPlan = !!planFor(state, toMonthKey(now));
  const actions = nextActions(state, now).filter(
    (a) =>
      !(reviewMonth && a.id === `review-${reviewMonth}`) &&
      // Without a plan the safe-to-spend card already asks for one.
      !(!hasPlan && a.id.startsWith('plan-'))
  );
  const top = actions[0];
  const funds = homeFunds(state, now);
  const recentTx = recentTransactions(state, 5);
  const editingTx = txSheet && txSheet !== 'add' ? state.transactions.find((t) => t.id === txSheet.id) : undefined;
  // The top action already says what the unassigned panel would say.
  const hideUnassigned = top?.id === 'cover' || top?.id === 'assign';

  const run = ({ cta }: NextAction) => {
    const { route, params = {} } = cta;
    if (route === 'cover' || route === 'assign') setFundSheet(route);
    else if (route === 'new-emergency') setFundSheet('emergency');
    else if (route === '/fund/[id]') router.push({ pathname: '/fund/[id]', params: { id: params.id ?? '', ...params } });
    else if (route === '/review') router.push({ pathname: '/review', params });
    else if (route === '/settings') router.push({ pathname: '/settings', params });
    else router.push(route);
  };
  const dismiss = (action: NextAction) => runAction('تعذّر التأجيل', () => state.dismissAction(action.id));

  return (
    <Screen scroll contentStyle={styles.content}>
      <Header now={now} />

      <SafeToSpendCard state={state} now={now} />

      {reviewMonth && (
        <InsightCard
          tone="ok"
          icon="event-note"
          title="راجع الشهر اللي فات"
          message={`شوف ${formatMonthLabel(reviewMonth)} كان عامل إزاي وجهّز خطة الشهر ده.`}
          actionLabel="ابدأ المراجعة"
          onAction={() => router.push({ pathname: '/review', params: { month: reviewMonth } })}
        />
      )}

      <NextActionsCard actions={actions} onRun={run} onDismiss={dismiss} />

      <MonthlySnapshot state={state} now={now} />

      <RecurringCard state={state} now={now} dueShownElsewhere={actions.some((a) => a.id === 'due')} />

      <View>
        <SectionHeader title="الصناديق" actionLabel="عرض كل الصناديق" onAction={() => router.push('/goals')} />
        {funds.length === 0 ? (
          <Card variant="subtle">
            <AppText variant="secondary" color="textSecondary">
              لسه معملتش صناديق. ابدأ بصندوق طوارئ من شاشة الصناديق.
            </AppText>
          </Card>
        ) : (
          <View style={styles.stack}>
            {funds.map((fund) => (
              <FundCard
                key={fund.id}
                fund={fund}
                state={state}
                onPress={() => router.push({ pathname: '/fund/[id]', params: { id: fund.id } })}
              />
            ))}
          </View>
        )}
      </View>

      {!hideUnassigned && <UnassignedPanel state={state} />}

      <NetWorthCard state={state} now={now} />

      <View>
        <SectionHeader title="آخر المعاملات" actionLabel="+ معاملة" onAction={() => setTxSheet('add')} />
        {recentTx.length === 0 ? (
          <Card variant="subtle">
            <EmptyState
              icon="receipt-long"
              title="لسه مسجلتش معاملات."
              body="سجّل أول مصروف أو دخل عشان تبدأ تشوف صورة شهرك."
              actionLabel="سجّل معاملة"
              actionVariant="secondary"
              onAction={() => setTxSheet('add')}
            />
          </Card>
        ) : (
          <ListGroup>
            {recentTx.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} state={state} showDate onPress={() => setTxSheet({ id: tx.id })} />
            ))}
          </ListGroup>
        )}
      </View>

      {txSheet === 'add' && <TransactionSheet onClose={() => setTxSheet(null)} />}
      {editingTx && <TransactionSheet key={editingTx.id} transaction={editingTx} onClose={() => setTxSheet(null)} />}
      {fundSheet === 'assign' && <AssignSheet onClose={() => setFundSheet(null)} />}
      {fundSheet === 'cover' && <CoverSheet onClose={() => setFundSheet(null)} />}
      {fundSheet === 'emergency' && <FundSheet initialType="emergency" onClose={() => setFundSheet(null)} />}
    </Screen>
  );
}

// Greeting by the hour + today's date, settings on the other side.
function Header({ now }: { now: Date }) {
  const greeting = now.getHours() < 12 ? 'صباح الخير' : 'مساء الخير';
  const date = now.toLocaleDateString('ar-EG', { day: 'numeric', month: 'long' });
  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <AppText variant="titleLg">{greeting}</AppText>
        <AppText variant="secondary" color="textSecondary">
          {date}
        </AppText>
      </View>
      <Pressable
        onPress={() => router.push('/settings')}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="الإعدادات"
        style={({ pressed }) => [styles.settings, pressed && { opacity: opacity.pressed }]}>
        <MaterialIcons name="settings" size={24} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.xxl,
    gap: space.xxl,
  },
  // RTL: greeting on the right, settings on the left.
  header: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  headerText: { flex: 1 },
  settings: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  stack: { gap: space.md },
});
