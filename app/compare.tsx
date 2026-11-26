import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { currencyOptions } from '@/components/analytics/analyticsUi';
import { CompareRow } from '@/components/analytics/CompareRow';
import { changeLine, FLOW_LABELS, noteTexts, POINT_LABELS, qualityLabel, rateText, reasonText } from '@/components/analytics/overviewUi';
import { PeriodPill, PeriodSheet, type PeriodChoice } from '@/components/analytics/PeriodSheet';
import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { PastDateField } from '@/components/ui/DateFields';
import { FormField } from '@/components/ui/FormField';
import { formatDateAr } from '@/components/ui/formatDateAr';
import { formatMoney } from '@/components/ui/formatMoney';
import { LoadingView } from '@/components/ui/LoadingView';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Segment } from '@/components/ui/Segment';
import { space } from '@/constants/theme';
import { comparePeriods, type Alignment, type Change, type FlowMetricId, type MetricValue } from '@/store/comparison';
import { compareDates, type PointMetricId, type ValuationMethod } from '@/store/history';
import { preferredPreset, previousAnalyticsPeriod, resolvePeriodChoice, type AnalyticsPeriod } from '@/store/periods';
import { currencyList } from '@/store/selectors';
import { useDailySnapshots } from '@/store/useDailySnapshots';
import { useFinanceStore } from '@/store/useFinanceStore';
import { shiftDate, toDateKey } from '@/utils/dates';

type Mode = 'periods' | 'dates';
// Period A is either "the one before B" (the default) or its own choice.
type SpecA = { previous: true } | { previous: false; choice: PeriodChoice };

const FLOW_ROWS: FlowMetricId[] = ['income', 'expense', 'net', 'savingsRate', 'savingsRateExFundSpending', 'avgDailySpending', 'expenseFromFunds', 'expenseFromFreeMoney', 'fundContributions'];
const POINT_ROWS: PointMetricId[] = ['netWorth', 'liquid', 'reserved', 'freeMoney', 'nonLiquid', 'liabilities'];

// «قارن وضعك المالي»: period vs period (Mode A) or date vs date (Mode B). Always from A to B: every row, every
// change and the swap button keep that direction. All numbers come from store/comparison.ts and store/history.ts.
export default function CompareScreen() {
  const state = useFinanceStore();
  const dailyStore = useDailySnapshots((s) => s.store);
  const [mode, setMode] = useState<Mode>('periods');
  const [choiceB, setChoiceB] = useState<PeriodChoice>(() => ({ preset: preferredPreset(state), alignment: 'elapsed' }));
  const [specA, setSpecA] = useState<SpecA>({ previous: true });
  const [alignment, setAlignment] = useState<Alignment>('elapsed');
  const [sheet, setSheet] = useState<'A' | 'B' | null>(null);
  const [picked, setCurrency] = useState<string | null>(null);
  const today = toDateKey(new Date());
  const dailySince = dailyStore?.days[0]?.d ?? null;
  const [dateA, setDateA] = useState<string>(() => (dailySince && dailySince < today ? dailySince : shiftDate(today, -30)));
  const [dateB, setDateB] = useState<string>(today);
  const [method, setMethod] = useState<ValuationMethod>('historical');

  if (!state.hasHydrated) return <LoadingView />;

  const now = new Date();
  const currency = picked ?? state.settings.reportingCurrency;
  const currencies = currencyList(state);
  const context = { trackingStart: state.settings.trackingStartDate, dailySince };

  const top = (
    <View style={styles.top}>
      <Segment<Mode>
        options={[
          { label: 'فترة بفترة', value: 'periods' },
          { label: 'تاريخ بتاريخ', value: 'dates' },
        ]}
        value={mode}
        onChange={setMode}
      />
      {currencies.length > 1 && <Segment<string> options={currencyOptions(currencies)} value={currency} onChange={setCurrency} />}
    </View>
  );

  if (mode === 'dates') {
    const result = compareDates(state, dailyStore, { dateA, dateB, currency, method, now });
    const earliest = dailySince ?? today;
    const beforeHistory = dateA < earliest || dateB < earliest;
    return (
      <Screen scroll edges={['bottom']} contentStyle={styles.content}>
        {top}
        <Card style={styles.block}>
          <FormField label="التاريخ أ">
            <PastDateField value={dateA} onChange={setDateA} />
          </FormField>
          <FormField label="التاريخ ب">
            <PastDateField value={dateB} onChange={setDateB} />
          </FormField>
          <ChipRow>
            <Chip
              label="بدّل أ و ب ⇄"
              onPress={() => {
                setDateA(dateB);
                setDateB(dateA);
              }}
            />
          </ChipRow>
          <Segment<ValuationMethod>
            options={[
              { label: 'بأسعار كل يوم', value: 'historical' },
              { label: 'بأسعار ثابتة', value: 'constant' },
            ]}
            value={method}
            onChange={setMethod}
          />
          <AppText variant="caption" color="textSecondary">
            {method === 'historical'
              ? 'كل تاريخ بأسعار العملات والذهب اللي كانت يومها.'
              : `التاريخين بأسعار ${formatDateAr(dateA > dateB ? dateA : dateB)}، عشان تشوف التغيير الحقيقي من غير أثر الأسعار.`}
          </AppText>
        </Card>
        {beforeHistory && (
          <Card variant="subtle">
            <AppText variant="secondary" color="textSecondary">
              {dailySince
                ? `السجل اليومي بيبدأ من ${formatDateAr(dailySince)}. قبل كده مفيش مقارنة دقيقة بين تاريخين: الأرصدة محسوبة من المعاملات، والمحجوز والفلوس الحرة مش متاحين.`
                : 'السجل اليومي لسه بادئ من النهارده. قبل كده مفيش مقارنة دقيقة بين تاريخين: الأرصدة محسوبة من المعاملات، والمحجوز والفلوس الحرة مش متاحين.'}
            </AppText>
          </Card>
        )}
        {(result.a.at.ledgerDiverged || result.b.at.ledgerDiverged) && (
          <Card variant="subtle">
            <AppText variant="secondary" color="textSecondary">
              فيه معاملات قديمة اتعدّلت بعد ما اليوم اتسجّل، فالأرصدة محسوبة من المعاملات زي ما هي دلوقتي.
            </AppText>
          </Card>
        )}
        <SectionHeader title={`من ${formatDateAr(dateA)} لـ ${formatDateAr(dateB)}`} />
        {POINT_ROWS.filter((id) => id !== 'liabilities' || (result.a.metrics.liabilities.value ?? 0) + (result.b.metrics.liabilities.value ?? 0) >= 0.005).map((id) => (
          <CompareRow
            key={id}
            title={POINT_LABELS[id]}
            a={amountText(result.a.metrics[id], currency, context)}
            b={amountText(result.b.metrics[id], currency, context)}
            change={rowChange(result.metrics[id], currency, context)}
            quality={qualityLabel(result.metrics[id].quality)}
          />
        ))}
      </Screen>
    );
  }

  // --- Mode A ---
  const periodB = resolvePeriodChoice(state, choiceB, now);
  const periodA: AnalyticsPeriod | null = specA.previous ? previousAnalyticsPeriod(state, periodB) : resolvePeriodChoice(state, specA.choice, now);
  const result = comparePeriods(state, { current: periodB, previous: periodA, alignment, currency, includeOneTime: true });
  const notes = noteTexts(result.notes, result.earliestReliable);
  const aMeasured = result.previous?.measured;
  const swap = () => {
    if (!periodA) return;
    setSpecA({ previous: false, choice: choiceB });
    setChoiceB({ preset: 'custom', custom: { from: periodA.nominalFrom, to: periodA.nominalTo }, alignment: 'elapsed' });
  };
  const categoryName = (id: string) => state.categories.find((c) => c.id === id)?.name ?? '—';

  return (
    <Screen scroll edges={['bottom']} contentStyle={styles.content}>
      {top}
      <Card style={styles.block}>
        {periodA ? (
          <PeriodPill label="أ" period={periodA} previous={specA.previous} onPress={() => setSheet('A')} />
        ) : (
          <Chip label="أ: اختار فترة" onPress={() => setSheet('A')} />
        )}
        <PeriodPill label="ب" period={periodB} onPress={() => setSheet('B')} />
        <ChipRow>
          <Chip label="بدّل أ و ب ⇄" disabled={!periodA} onPress={swap} />
          {!specA.previous && <Chip label="أ = الفترة اللي قبل ب" onPress={() => setSpecA({ previous: true })} />}
        </ChipRow>
        {periodB.inProgress && periodA && (
          <ChipRow>
            <Chip label="لحد نفس اليوم" selected={alignment === 'elapsed'} onPress={() => setAlignment('elapsed')} />
            <Chip label="أ كلها" selected={alignment === 'full'} onPress={() => setAlignment('full')} />
          </ChipRow>
        )}
        {aMeasured && (
          <AppText variant="caption" color="textSecondary">
            {`أ متقاسة من ${formatDateAr(aMeasured.from)} لـ ${formatDateAr(aMeasured.to)}`}
          </AppText>
        )}
      </Card>

      {!periodA && (
        <Card variant="subtle">
          <AppText variant="secondary" color="textSecondary">
            مفيش فترة قبلها للمقارنة. اختار الفترة أ بنفسك.
          </AppText>
        </Card>
      )}
      {periodA?.inProgress && !periodB.inProgress && (
        <Card variant="subtle">
          <AppText variant="secondary" color="textSecondary">
            الفترة أ لسه مخلصتش، فالأيام في الفترتين مش متساوية.
          </AppText>
        </Card>
      )}
      {notes.map((note) => (
        <Card key={note} variant="subtle">
          <AppText variant="secondary" color="textSecondary">
            {note}
          </AppText>
        </Card>
      ))}

      <SectionHeader title="من أ لـ ب" />
      {FLOW_ROWS.map((id) => {
        const change = result.metrics[id];
        const ratio = id === 'savingsRate' || id === 'savingsRateExFundSpending';
        const text = (v: MetricValue) => (v.value === null ? reasonText(v.reason, context) : ratio ? rateText(v.value) : formatMoney(v.value, currency));
        // Without a period A the reason is said once above: A is "—" and there is no change line.
        return periodA ? (
          <CompareRow key={id} title={FLOW_LABELS[id]} a={text(change.previous)} b={text(change.current)} change={rowChange(change, currency, context)} quality={qualityLabel(change.quality)} />
        ) : (
          <CompareRow key={id} title={FLOW_LABELS[id]} a="—" b={text(change.current)} change={null} quality={null} />
        );
      })}

      {result.categories.length > 0 && (
        <>
          <SectionHeader title="أكتر بنود اتغيّرت" />
          {result.categories.slice(0, 5).map((c) => (
            <CompareRow
              key={c.categoryId}
              title={categoryName(c.categoryId)}
              a={amountText(c.change.previous, currency, context)}
              b={amountText(c.change.current, currency, context)}
              change={rowChange(c.change, currency, context)}
              quality={null}
            />
          ))}
        </>
      )}

      {sheet && (
        <PeriodSheet
          title={sheet === 'A' ? 'الفترة أ' : 'الفترة ب'}
          initial={sheet === 'B' ? choiceB : specA.previous ? { preset: 'lastMonth', alignment } : specA.choice}
          resolve={(c) => resolvePeriodChoice(state, c, new Date())}
          showCycleStart={false}
          showAlignment={false}
          onCancel={() => setSheet(null)}
          onSave={(c) => {
            if (sheet === 'A') setSpecA({ previous: false, choice: c });
            else setChoiceB(c);
            setSheet(null);
          }}
        />
      )}
    </Screen>
  );
}

const amountText = (v: MetricValue, currency: string, context: { trackingStart?: string; dailySince?: string | null }) =>
  v.value === null ? reasonText(v.reason, context) : formatMoney(v.value, currency);

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xxxl, gap: space.sm },
  top: { gap: space.sm },
  block: { gap: space.md },
});

// A row's change line; none when a side has no value (the side itself already says why).
const rowChange = (change: Change, currency: string, context: { trackingStart?: string; dailySince?: string | null }) =>
  change.delta === null ? null : changeLine(change, currency, context);
