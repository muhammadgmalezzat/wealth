import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { FundCard } from '@/components/funds/FundCard';
import { FundSheet } from '@/components/funds/FundSheet';
import { fundsSummary } from '@/components/funds/fundsUi';
import { achievedLine } from '@/components/funds/goalsUi';
import { FUND_SECTION_TITLES } from '@/components/funds/labels';
import { UnassignedPanel } from '@/components/funds/UnassignedPanel';
import { AppText } from '@/components/ui/AppText';
import { EmptyState } from '@/components/ui/EmptyState';
import { Fab, FAB_CLEARANCE } from '@/components/ui/Fab';
import { ListGroup, ListRow } from '@/components/ui/ListRow';
import { LoadingView } from '@/components/ui/LoadingView';
import { MetricGroup } from '@/components/ui/MetricGroup';
import { Money } from '@/components/ui/Money';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { colors, opacity, space } from '@/constants/theme';
import { achievedFunds, fundAllocated, fundsByPriority } from '@/store/selectors';
import type { Fund } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';

const SECTION_ORDER: Fund['type'][] = ['emergency', 'goal', 'sinking'];

// "What am I preparing for?": money to plan, totals, then funds by type.
export default function FundsScreen() {
  const state = useFinanceStore();
  // Type preselected in the create sheet (e.g. from the empty state).
  const [creating, setCreating] = useState<Fund['type'] | null>(null);
  // «أهداف اتحققت» starts collapsed.
  const [doneOpen, setDoneOpen] = useState(false);

  if (!state.hasHydrated) return <LoadingView />;

  const funds = fundsByPriority(state);
  const done = achievedFunds(state);
  const summary = fundsSummary(state);

  return (
    <Screen
      scroll
      contentStyle={styles.content}
      overlay={<Fab placement="tab" onPress={() => setCreating('goal')} accessibilityLabel="صندوق جديد" />}>
      <AppText variant="titleLg">الصناديق</AppText>

      <UnassignedPanel state={state} />

      {funds.length === 0 && done.length === 0 ? (
        <EmptyState
          icon="savings"
          title="لسه معندكش صناديق."
          body="الصندوق بيساعدك تحجز جزء من فلوسك لهدف أو للظروف المفاجئة."
          actionLabel="أنشئ صندوق طوارئ"
          onAction={() => setCreating('emergency')}
        />
      ) : (
        <>
          <MetricGroup
            metrics={[
              { label: 'إجمالي المحجوز', value: <Money amount={summary.reservedEGP} currency="EGP" align="center" /> },
              { label: 'مطلوب الشهر ده', value: <Money amount={summary.requiredEGP} currency="EGP" align="center" /> },
              { label: 'صناديق', value: <AppText variant="moneyRow" align="center">{summary.count}</AppText> },
            ]}
          />
          {SECTION_ORDER.map((type) => {
            const sectionFunds = funds.filter((f) => f.type === type);
            if (sectionFunds.length === 0) return null;
            return (
              <View key={type}>
                <SectionHeader title={FUND_SECTION_TITLES[type]} />
                <View style={styles.cards}>
                  {sectionFunds.map((fund) => (
                    <FundCard
                      key={fund.id}
                      fund={fund}
                      state={state}
                      onPress={() => router.push({ pathname: '/fund/[id]', params: { id: fund.id } })}
                    />
                  ))}
                </View>
              </View>
            );
          })}
        </>
      )}

      {/* ── Achieved goals: collapsed, at the end; hidden when there are none ── */}
      {done.length > 0 && (
        <View style={styles.cards}>
          <Pressable
            onPress={() => setDoneOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: doneOpen }}
            style={({ pressed }) => [styles.toggle, pressed && { opacity: opacity.pressed }]}>
            <AppText variant="bodyStrong">أهداف اتحققت ({done.length})</AppText>
            <MaterialIcons name={doneOpen ? 'expand-less' : 'expand-more'} size={22} color={colors.textSecondary} />
          </Pressable>
          {doneOpen && (
            <ListGroup>
              {done.map((fund) => {
                const left = fundAllocated(state, fund.id);
                return (
                  <ListRow
                    key={fund.id}
                    title={fund.name}
                    subtitle={achievedLine(state, fund)}
                    subtitleLines={2}
                    icon="celebration"
                    iconTone="ok"
                    trailing={
                      left > 0.005 ? (
                        <Money amount={left} currency={fund.currency} align="left" />
                      ) : (
                        <AppText variant="bodyStrong">🎉</AppText>
                      )
                    }
                    onPress={() => router.push({ pathname: '/fund/[id]', params: { id: fund.id } })}
                    accessibilityLabel={`${fund.name}، ${achievedLine(state, fund)}`}
                  />
                );
              })}
            </ListGroup>
          )}
        </View>
      )}

      {creating && <FundSheet initialType={creating} onClose={() => setCreating(null)} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: FAB_CLEARANCE, gap: space.lg },
  cards: { gap: space.md },
  toggle: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
});
