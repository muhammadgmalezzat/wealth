import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { FundCard } from '@/components/funds/FundCard';
import { FundSheet } from '@/components/funds/FundSheet';
import { fundsSummary } from '@/components/funds/fundsUi';
import { FUND_SECTION_TITLES } from '@/components/funds/labels';
import { UnassignedPanel } from '@/components/funds/UnassignedPanel';
import { AppText } from '@/components/ui/AppText';
import { EmptyState } from '@/components/ui/EmptyState';
import { Fab, FAB_CLEARANCE } from '@/components/ui/Fab';
import { LoadingView } from '@/components/ui/LoadingView';
import { MetricGroup } from '@/components/ui/MetricGroup';
import { Money } from '@/components/ui/Money';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { space } from '@/constants/theme';
import { fundsByPriority } from '@/store/selectors';
import type { Fund } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';

const SECTION_ORDER: Fund['type'][] = ['emergency', 'goal', 'sinking'];

// "What am I preparing for?": money to plan, totals, then funds by type.
export default function FundsScreen() {
  const state = useFinanceStore();
  // Type preselected in the create sheet (e.g. from the empty state).
  const [creating, setCreating] = useState<Fund['type'] | null>(null);

  if (!state.hasHydrated) return <LoadingView />;

  const funds = fundsByPriority(state);
  const summary = fundsSummary(state);

  return (
    <Screen
      scroll
      contentStyle={styles.content}
      overlay={<Fab placement="tab" onPress={() => setCreating('goal')} accessibilityLabel="صندوق جديد" />}>
      <AppText variant="titleLg">الصناديق</AppText>

      <UnassignedPanel state={state} />

      {funds.length === 0 ? (
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

      {creating && <FundSheet initialType={creating} onClose={() => setCreating(null)} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: FAB_CLEARANCE, gap: space.lg },
  cards: { gap: space.md },
});
