import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { currencyOptions } from '@/components/analytics/analyticsUi';
import { FundsSection, InsightsSection, MoneyMapSection, RunwaySection } from '@/components/analytics/MoneySections';
import { OverviewSection, type OverviewCardId } from '@/components/analytics/OverviewSection';
import { PeriodPill, PeriodSheet, type PeriodChoice } from '@/components/analytics/PeriodSheet';
import { SpendingSection } from '@/components/analytics/SpendingSection';
import { AppText } from '@/components/ui/AppText';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { LoadingView } from '@/components/ui/LoadingView';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Segment } from '@/components/ui/Segment';
import { currencyNameAr } from '@/constants/currencies';
import { colors, space } from '@/constants/theme';
import * as analytics from '@/store/analytics';
import type { FootprintSegment } from '@/store/cashflowCharts';
import { overview } from '@/store/overview';
import { preferredPreset, previousAnalyticsPeriod, resolvePeriodChoice } from '@/store/periods';
import { currencyList } from '@/store/selectors';
import { legacyPeriodOf, spendingView } from '@/store/spending';
import { useDailySnapshots } from '@/store/useDailySnapshots';
import { useFinanceStore } from '@/store/useFinanceStore';
import { toDateKey } from '@/utils/dates';
import { timeAgoPhrase } from '@/utils/formatters';
import { priceSourceOf } from '@/utils/prices/fetchPrices';
import { runAction } from '@/utils/runAction';

type Section = 'overview' | 'spending';

const SECTIONS: { label: string; value: Section }[] = [
  { label: 'نظرة عامة', value: 'overview' },
  { label: 'الإنفاق', value: 'spending' },
];

// "التحليلات": section chips on top, ONE period system for both (the pill + sheet of the Phase 1b periods; the preset is
// remembered, D6), one currency switch. «نظرة عامة» = store/overview.ts; «الإنفاق» = store/spending.ts, then the sections
// kept from the old tab (money map, runway, funds, notes) on the old-screen period of the same dates (legacyPeriodOf),
// so their numbers don't change. Every number comes from pure selectors.
export default function AnalyticsScreen() {
  const state = useFinanceStore();
  const dailyStore = useDailySnapshots((s) => s.store);
  const [section, setSection] = useState<Section>('overview');
  const [choice, setChoice] = useState<PeriodChoice>(() => ({ preset: preferredPreset(state), alignment: 'elapsed' }));
  const [sheet, setSheet] = useState<'period' | 'A' | null>(null);
  const [picked, setCurrency] = useState<string | null>(null);
  // «الإنفاق» only: include one-time expenses (on by default, like before), and a chosen period A.
  const [includeOneTime, setIncludeOneTime] = useState(true);
  const [choiceA, setChoiceA] = useState<PeriodChoice | null>(null);

  const currency = picked ?? state.settings.reportingCurrency;
  const today = toDateKey(new Date());
  const computed = useMemo(() => {
    if (!state.hasHydrated) return null;
    const now = new Date();
    const period = resolvePeriodChoice(state, choice, now);
    if (section === 'overview') return { period, overview: overview(state, { period, alignment: choice.alignment, currency, now, dailyStore }) };
    const periodA = choiceA ? resolvePeriodChoice(state, choiceA, now) : previousAnalyticsPeriod(state, period);
    return {
      period,
      periodA,
      spending: spendingView(state, { period, alignment: choice.alignment, currency, includeOneTime, ...(choiceA ? { previous: periodA } : {}) }),
    };
    // Recomputed when the data, the choices, the currency or the day changes (the selectors are memoized below this).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.hasHydrated, state.transactions, state.accounts, state.holdings, state.liabilities, state.reservationMovements, state.unresolvedMovements, state.funds, state.settings, state.rateSnapshots, state.receivables, state.categories, state.netWorthSnapshots, section, choice, choiceA, currency, includeOneTime, dailyStore, today]);

  if (!state.hasHydrated || !computed) return <LoadingView />;
  const { period } = computed;

  const saveChoice = (next: PeriodChoice) => {
    setSheet(null);
    if (next.preset !== 'custom' && next.preset !== choice.preset) {
      runAction('تعذّر الحفظ', () => state.setAnalyticsPreferences({ period: next.preset }));
    }
    if (next.payCycleStart !== undefined) {
      runAction('تعذّر الحفظ', () => state.setAnalyticsPreferences({ payCycleStart: next.payCycleStart ?? null }));
    }
    const { payCycleStart: _saved, ...rest } = next;
    setChoice(rest);
  };
  const categoryOf = (id: string) => {
    const found = state.categories.find((c) => c.id === id);
    return { name: found?.name ?? '—', bucket: found?.bucket };
  };
  const drill = (measured: { from: string; to: string } | null, filter: analytics.DrillFilter, oneTime: boolean) => {
    if (!measured) return;
    const query: analytics.AnalyticsQuery = { period: { kind: 'custom', ...measured }, currency, includeOneTime: oneTime };
    router.push({ pathname: '/period-transactions', params: analytics.drillParams(query, filter) });
  };
  const currencies = currencyList(state);
  const header = (
    <View style={styles.header}>
      <ChipRow>
        {SECTIONS.map((s) => (
          <Chip key={s.value} label={s.label} selected={section === s.value} onPress={() => setSection(s.value)} />
        ))}
      </ChipRow>
      <View style={styles.controls}>
        <View style={styles.flex}>
          <PeriodPill period={period} onPress={() => setSheet('period')} />
        </View>
        {currencies.length > 1 && (
          <View style={styles.currency}>
            <Segment<string> options={currencyOptions(currencies)} value={currency} onChange={setCurrency} />
          </View>
        )}
      </View>
      {section === 'overview' ? (
        <ChipRow>
          <Chip label="قارن وضعك المالي ⇄" onPress={() => router.push('/compare')} />
        </ChipRow>
      ) : (
        <View style={styles.switchRow}>
          <AppText variant="caption" style={styles.flex}>
            اشمل المصاريف اللي لمرة واحدة
          </AppText>
          <Switch
            value={includeOneTime}
            onValueChange={setIncludeOneTime}
            trackColor={{ true: colors.primary600, false: colors.borderStrong }}
            thumbColor={colors.text}
            accessibilityLabel="اشمل المصاريف اللي لمرة واحدة"
          />
        </View>
      )}
    </View>
  );
  const sheets = (
    <>
      {sheet === 'period' && (
        <PeriodSheet
          initial={choice}
          resolve={(c) => resolvePeriodChoice(state, c, new Date())}
          payCycleOverride={state.settings.payCycleStartOverride}
          onCancel={() => setSheet(null)}
          onSave={saveChoice}
        />
      )}
      {sheet === 'A' && (
        <PeriodSheet
          title="الفترة أ"
          initial={choiceA ?? { preset: 'lastMonth', alignment: choice.alignment }}
          resolve={(c) => resolvePeriodChoice(state, c, new Date())}
          showCycleStart={false}
          showAlignment={false}
          onCancel={() => setSheet(null)}
          onSave={(c) => {
            setChoiceA(c);
            setSheet(null);
          }}
        />
      )}
    </>
  );

  if (computed.overview) {
    const data = computed.overview;
    const openCard = (id: OverviewCardId) => {
      if (id === 'income' || id === 'expense') drill(data.comparison.current.measured, { type: id }, true);
      else router.push({ pathname: '/analytics-metric', params: { metric: id } });
    };
    // A tile opens its category's spending in the measured range; «باقي الفئات» = everything but the top ones.
    const openFootprint = (segment: FootprintSegment, topIds: string[]) =>
      drill(data.comparison.current.measured, segment.key === 'rest' ? { type: 'expense', excludeCategoryIds: topIds } : { type: 'expense', categoryIds: [segment.key] }, true);
    const pricesLine =
      data.endDate === today
        ? `الأسعار: ${timeAgoPhrase(state.settings.rates.updatedAt)} · ${priceSourceOf(state.settings) === 'auto' ? 'تلقائي' : 'يدوي'}`
        : null;
    return (
      <Screen scroll header={header} contentStyle={styles.content}>
        <OverviewSection
          data={data}
          currency={currency}
          trackingStart={state.settings.trackingStartDate}
          pricesLine={pricesLine}
          onOpenCard={openCard}
          category={categoryOf}
          onOpenFootprint={openFootprint}
        />
        {sheets}
      </Screen>
    );
  }

  // --- «الإنفاق» -----------------------------------------------------------------------------------------------------
  const view = computed.spending!;
  const measured = view.comparison.current.measured;
  // The sections kept from the old tab, on the old-screen period of the same dates (their numbers are unchanged).
  const now = new Date();
  const legacy: analytics.AnalyticsQuery = { period: legacyPeriodOf(period), currency, includeOneTime };
  const map = analytics.moneyMap(state, currency);
  const runway = analytics.runway(state, currency, now);
  const funds = analytics.fundsProjection(state, now);
  const insights = analytics.insights(state, legacy, now);
  const onInsightPress = ({ target }: analytics.Insight) => {
    if (target.type === 'drill') router.push({ pathname: '/period-transactions', params: analytics.drillParams(legacy, target.filter) });
    else if (target.type === 'fund') router.push({ pathname: '/fund/[id]', params: { id: target.fundId } });
    else if (target.type === 'assets') router.push('/assets');
    // The monthly trend now lives on the Overview («التدفق الشهري»).
    else setSection('overview');
  };

  return (
    <Screen scroll header={header} contentStyle={styles.content}>
      <SpendingSection
        view={view}
        currency={currency}
        context={{ trackingStart: state.settings.trackingStartDate, dailySince: dailyStore?.days[0]?.d ?? null }}
        category={categoryOf}
        accountName={(id) => state.accounts.find((a) => a.id === id)?.name ?? '—'}
        currencyName={currencyNameAr}
        periodA={computed.periodA ?? null}
        aChosen={choiceA !== null}
        onPickA={() => setSheet('A')}
        onResetA={() => setChoiceA(null)}
        onOpenCategories={(f) => drill(measured, { type: 'expense', ...f }, includeOneTime)}
        onOpenOneTime={() => drill(measured, { type: 'expense', oneTimeOnly: true }, includeOneTime)}
      />

      <View>
        <SectionHeader title="ملاحظات" />
        <InsightsSection insights={insights} onPress={onInsightPress} />
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
      {sheets}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xxxl, gap: space.md },
  header: {
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.md,
    backgroundColor: colors.glassStrong,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.glassBorder,
  },
  controls: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: space.md },
  currency: { width: 112 },
  flex: { flex: 1 },
  switchRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.md },
});
