import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AnalyticsControls } from '@/components/analytics/AnalyticsControls';
import { BreakdownSection } from '@/components/analytics/BreakdownSection';
import { ChartCard, EmptyNote } from '@/components/analytics/common';
import { FundsSection, InsightsSection, MoneyMapSection, RunwaySection } from '@/components/analytics/MoneySections';
import { NetWorthSection } from '@/components/analytics/NetWorthSection';
import { SankeyChart } from '@/components/analytics/SankeyChart';
import { TrendSection } from '@/components/analytics/TrendSection';
import { PastDateField } from '@/components/ui/DateFields';
import { EmptyState } from '@/components/ui/EmptyState';
import { FormField } from '@/components/ui/FormField';
import { FormSheet } from '@/components/ui/FormSheet';
import { LoadingView } from '@/components/ui/LoadingView';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { space } from '@/constants/theme';
import * as analytics from '@/store/analytics';
import { useFinanceStore } from '@/store/useFinanceStore';
import { toDateKey } from '@/utils/dates';

// "التحليلات": where the money went and how things are moving. The controls on top (period,
// display currency, one-time toggle) are sticky; every number comes from store/analytics.ts.
export default function AnalyticsScreen() {
  const state = useFinanceStore();
  const scrollRef = useRef<ScrollView>(null);
  const trendY = useRef(0);
  const [kind, setKind] = useState<analytics.PeriodKind>('month');
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [editingCustom, setEditingCustom] = useState<{ from: string; to: string } | null>(null);
  const [currency, setCurrency] = useState<analytics.DisplayCurrency>('EGP');
  const [includeOneTime, setIncludeOneTime] = useState(true);
  const [location, setLocation] = useState<analytics.NetWorthLocation>('all');
  const [hideEstimated, setHideEstimated] = useState(false);

  if (!state.hasHydrated) return <LoadingView />;

  const now = new Date();
  const period = analytics.resolvePeriod(state, kind, now, custom ?? undefined);
  const query: analytics.AnalyticsQuery = { period, currency, includeOneTime };

  const chooseKind = (next: analytics.PeriodKind) => {
    if (next === 'custom') {
      const today = toDateKey(now);
      setEditingCustom(custom ?? { from: `${today.slice(0, 7)}-01`, to: today });
      return;
    }
    setKind(next);
  };

  const openDrill = (filter: analytics.DrillFilter) =>
    router.push({ pathname: '/period-transactions', params: analytics.drillParams(query, filter) });
  const onNodePress = (node: analytics.FlowNode) => {
    if (node.drill) openDrill(node.drill);
    else if (node.id === 'dest:funds') router.push('/goals');
  };
  const onInsightPress = ({ target }: analytics.Insight) => {
    if (target.type === 'drill') openDrill(target.filter);
    else if (target.type === 'fund') router.push({ pathname: '/fund/[id]', params: { id: target.fundId } });
    else if (target.type === 'assets') router.push('/assets');
    else scrollRef.current?.scrollTo({ y: Math.max(0, trendY.current - space.lg), animated: true });
  };

  const header = (
    <AnalyticsControls
      kind={kind}
      period={period}
      onKindChange={chooseKind}
      currency={currency}
      onCurrencyChange={setCurrency}
      includeOneTime={includeOneTime}
      onIncludeOneTimeChange={setIncludeOneTime}
    />
  );

  if (!analytics.hasAnalyticsData(state)) {
    return (
      <Screen header={header}>
        <EmptyState
          icon="insert-chart"
          title="لسه مفيش بيانات للتحليل."
          body="سجّل دخلك ومصروفك وهتشوف هنا فلوسك راحت فين. محتاج شهر بيانات على الأقل."
        />
      </Screen>
    );
  }

  const flow = analytics.spendingFlow(state, query);
  const trend = analytics.monthlyTrend(state, query);
  const breakdown = analytics.spendingBreakdown(state, query);
  const series = analytics.netWorthSeries(state, { location, currency, includeEstimated: !hideEstimated, now });
  const map = analytics.moneyMap(state, currency);
  const runway = analytics.runway(state, currency, now);
  const funds = analytics.fundsProjection(state, now);
  const insights = analytics.insights(state, query, now);

  return (
    <Screen scroll scrollRef={scrollRef} header={header} contentStyle={styles.content}>
      <View>
        <SectionHeader title="فلوسك راحت فين" />
        {flow.empty ? (
          <EmptyNote>مفيش دخل أو مصروف في الفترة دي.</EmptyNote>
        ) : (
          <ChartCard>
            <SankeyChart flow={flow} currency={currency} onNodePress={onNodePress} />
          </ChartCard>
        )}
      </View>

      <View onLayout={(e) => (trendY.current = e.nativeEvent.layout.y)}>
        <SectionHeader title="الاتجاه الشهري" />
        <TrendSection trend={trend} currency={currency} />
      </View>

      <View>
        <SectionHeader title="المصروف على إيه" />
        <BreakdownSection breakdown={breakdown} currency={currency} onDrill={openDrill} />
      </View>

      <View>
        <SectionHeader title="صافي الثروة عبر الوقت" />
        <NetWorthSection
          series={series}
          currency={currency}
          location={location}
          onLocationChange={setLocation}
          hideEstimated={hideEstimated}
          onHideEstimatedChange={setHideEstimated}
        />
      </View>

      <View>
        <SectionHeader title="خريطة فلوسك" />
        <MoneyMapSection map={map} currency={currency} />
      </View>

      <View>
        <SectionHeader title="فلوسك تكفي لحد إمتى" />
        <RunwaySection runway={runway} currency={currency} />
      </View>

      <View>
        <SectionHeader title="الصناديق" />
        <FundsSection funds={funds} />
      </View>

      <View>
        <SectionHeader title="ملاحظات" />
        <InsightsSection insights={insights} onPress={onInsightPress} />
      </View>

      {editingCustom && (
        <FormSheet
          visible
          title="فترة مخصصة"
          onCancel={() => setEditingCustom(null)}
          onSave={() => {
            setCustom(editingCustom);
            setKind('custom');
            setEditingCustom(null);
          }}>
          <FormField label="من">
            <PastDateField value={editingCustom.from} onChange={(from) => setEditingCustom({ ...editingCustom, from })} />
          </FormField>
          <FormField label="إلى">
            <PastDateField value={editingCustom.to} onChange={(to) => setEditingCustom({ ...editingCustom, to })} />
          </FormField>
        </FormSheet>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xxxl, gap: space.sm },
});
