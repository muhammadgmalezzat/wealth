import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { formatDateAr } from '@/components/ui/formatDateAr';
import { formatMoney } from '@/components/ui/formatMoney';
import { Money } from '@/components/ui/Money';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Segment } from '@/components/ui/Segment';
import { StatusChip } from '@/components/ui/StatusChip';
import { formatMonthLabel } from '@/utils/formatters';
import { colors, opacity, radius, space, type ColorToken } from '@/constants/theme';
import type { FootprintSegment } from '@/store/cashflowCharts';
import type { Change, FlowMetricId, MetricValue } from '@/store/comparison';
import type { PointMetricId } from '@/store/history';
import type { Overview } from '@/store/overview';
import type { Bucket } from '@/store/types';

import { monthShort } from './analyticsUi';
import { CashflowBars } from './CashflowBars';
import { EXPENSE_COLOR, INCOME_COLOR, RESERVED_COLOR } from './categoryIcons';
import { NetWorthChart } from './NetWorthChart';
import { Sparkline } from './Sparkline';
import { SpendingFootprintCard } from './SpendingFootprintCard';
import { changeLine, comparedToLabel, FLOW_LABELS, noteTexts, POINT_LABELS, qualityLabel, rateText, reasonText } from './overviewUi';

export type OverviewCardId = 'income' | 'expense' | 'net' | 'savingsRate' | 'freeMoney' | 'reserved';

interface OverviewSectionProps {
  data: Overview;
  currency: string;
  trackingStart: string;
  // "الأسعار: منذ 3 ساعات · تلقائي" when the end date is today; null otherwise.
  pricesLine: string | null;
  onOpenCard: (id: OverviewCardId) => void;
  category: (id: string) => { name: string; bucket: Bucket | undefined };
  onOpenFootprint: (segment: FootprintSegment, topIds: string[]) => void;
}

interface Spark {
  values: (number | null)[];
  color: ColorToken;
  lastInProgress: boolean;
}

// «نظرة عامة»: net worth (with the daily chart), the six key figures with their comparison, and where the money is.
// Every number comes from store/overview.ts; this file only lays them out.
export function OverviewSection({ data, currency, trackingStart, pricesLine, onOpenCard, category, onOpenFootprint }: OverviewSectionProps) {
  // The hero chart's view: daily snapshots, or the monthly net worth snapshots (all estimates).
  const [view, setView] = useState<'daily' | 'monthly'>('daily');
  const context = { trackingStart, dailySince: data.dailySince };
  const aligned = data.comparison.alignment === 'elapsed';
  const flow = data.comparison.metrics;
  const notes = noteTexts(data.comparison.notes, data.comparison.earliestReliable);
  const netWorth = data.current.metrics.netWorth;
  const nwChange = changeLine(data.point.netWorth, currency, context);
  const recordedDays = data.series.filter((p) => p.value !== null).length;

  // Sparklines: the flow cards always show the last 6 months (transactions only); the snapshot cards only once the
  // period has enough recorded days.
  const months = data.sparkline.buckets;
  const running = months.length > 0 && months[months.length - 1].inProgress;
  const flowSpark = (pick: (b: (typeof months)[number]) => number, color: ColorToken): Spark | undefined =>
    months.length >= 2 ? { values: months.map(pick), color, lastInProgress: running } : undefined;
  const sparks: Partial<Record<OverviewCardId, Spark>> = {
    income: flowSpark((b) => b.income, INCOME_COLOR),
    expense: flowSpark((b) => b.expense, EXPENSE_COLOR),
    net: flowSpark((b) => b.net, 'textSecondary'),
    ...(data.pointSparks
      ? {
          freeMoney: { values: data.pointSparks.freeMoney, color: 'textSecondary' as ColorToken, lastInProgress: false },
          reserved: { values: data.pointSparks.reserved, color: RESERVED_COLOR, lastInProgress: false },
        }
      : {}),
  };

  const flowCard = (id: Extract<OverviewCardId, FlowMetricId>, second?: string) => (
    <MetricCard
      key={id}
      title={FLOW_LABELS[id]}
      value={flow[id].current}
      change={flow[id]}
      ratio={id === 'savingsRate'}
      currency={currency}
      comparedTo={comparedToLabel(aligned, null, false)}
      context={context}
      second={second}
      spark={sparks[id]}
      onPress={() => onOpenCard(id)}
    />
  );
  const pointCard = (id: Extract<OverviewCardId, PointMetricId>) => (
    <MetricCard
      key={id}
      title={POINT_LABELS[id]}
      value={data.current.metrics[id]}
      change={data.point[id]}
      currency={currency}
      comparedTo={comparedToLabel(aligned, data.previousEndDate, true)}
      context={context}
      spark={sparks[id]}
      onPress={() => onOpenCard(id)}
    />
  );
  // D4: the second savings rate, only when some spending came from funds (otherwise it is the same number).
  const fromFunds = flow.expenseFromFunds.current.value ?? 0;
  const second = fromFunds >= 0.005 ? `من غير مصاريف الصناديق: ${rateText(flow.savingsRateExFundSpending.current.value)}` : undefined;

  return (
    <View style={styles.wrap}>
      {notes.map((note) => (
        <Card key={note} variant="subtle">
          <AppText variant="secondary" color="textSecondary">
            {note}
          </AppText>
        </Card>
      ))}

      <Card variant="hero">
        <View style={styles.heroHead}>
          <AppText variant="secondary" color="textSecondary" style={styles.flex}>
            {data.endDate === data.current.at.date && data.current.at.source === 'live' ? 'صافي الثروة دلوقتي' : `صافي الثروة يوم ${formatDateAr(data.endDate)}`}
          </AppText>
          <Quality value={netWorth} diverged={data.current.at.ledgerDiverged} />
        </View>
        {netWorth.value !== null ? (
          <Money amount={netWorth.value} currency={currency} size="hero" />
        ) : (
          <AppText variant="bodyStrong" color="textMuted">
            {reasonText(netWorth.reason, context)}
          </AppText>
        )}
        <AppText variant="secondary" color={nwChange.color}>
          {nwChange.text}
        </AppText>
        <AppText variant="caption" color="textMuted">
          {comparedToLabel(aligned, data.previousEndDate, true)}
          {data.point.netWorth.quality !== 'recorded' && data.point.netWorth.delta !== null ? ` · ${qualityLabel(data.point.netWorth.quality)}` : ''}
        </AppText>

        <View style={styles.chart}>
          <Segment<'daily' | 'monthly'>
            options={[
              { label: 'يومي', value: 'daily' },
              { label: 'شهري', value: 'monthly' },
            ]}
            value={view}
            onChange={setView}
          />
          {view === 'daily' ? (
            recordedDays >= 2 ? (
              <NetWorthChart points={data.series} currency={currency} />
            ) : (
              <AppText variant="caption" color="textSecondary">
                {data.dailySince
                  ? `الرسم بيتكوّن من السجل اليومي (من ${formatDateAr(data.dailySince)}): كل يوم بتفتح فيه التطبيق بيضيف نقطة.`
                  : 'الرسم هيبدأ من النهارده: كل يوم بتفتح فيه التطبيق بيضيف نقطة.'}
              </AppText>
            )
          ) : (
            <>
              <AppText variant="micro" color="textMuted">
                كل نقطة تقديرية: آخر قيمة شافها التطبيق في الشهر، مش آخر يوم فيه بالظبط.
              </AppText>
              {data.monthly.filter((m) => m.value !== null).length >= 2 ? (
                <NetWorthChart
                  points={data.monthly.map((m) => ({ date: m.month, value: m.value }))}
                  currency={currency}
                  labelOf={(month, short) => (short ? monthShort(month) : formatMonthLabel(month))}
                  tag="تقديري"
                  gapText="مفيش تسجيل الشهر ده"
                  hint="دوس أو اسحب على الرسم عشان تشوف شهر معيّن."
                />
              ) : (
                <AppText variant="caption" color="textSecondary">
                  محتاج شهرين متسجّلين على الأقل عشان يظهر الرسم الشهري.
                </AppText>
              )}
            </>
          )}
        </View>

        {pricesLine && (
          <AppText variant="micro" color="textMuted">
            {pricesLine}
          </AppText>
        )}
        {data.openReceivables !== null && (
          <AppText variant="caption" color="textSecondary">
            {`فلوس ليّا غير محصّلة: ${formatMoney(data.openReceivables, currency)} (مش داخلة في صافي الثروة)`}
          </AppText>
        )}
      </Card>

      <View style={styles.grid}>
        {flowCard('income')}
        {flowCard('expense')}
        {flowCard('net')}
        {flowCard('savingsRate', second)}
        {pointCard('freeMoney')}
        {pointCard('reserved')}
      </View>

      <View>
        <SectionHeader title="التدفق الشهري" />
        {data.cashflow.unit === 'week' && (
          <AppText variant="caption" color="textSecondary">
            أسبوع بأسبوع للفترة دي.
          </AppText>
        )}
        <CashflowBars chart={data.cashflow} currency={currency} />
      </View>

      <View>
        <SectionHeader title="بصمة الإنفاق" />
        <SpendingFootprintCard footprint={data.footprint} currency={currency} category={category} onOpen={onOpenFootprint} context={context} />
      </View>

      <View>
        <SectionHeader title="فلوسك فين" />
        <PositionCard data={data} currency={currency} context={context} />
      </View>
    </View>
  );
}

function Quality({ value, diverged = false }: { value: MetricValue; diverged?: boolean }) {
  const label = qualityLabel(value.quality, diverged);
  if (!label) return null;
  return <StatusChip label={label} tone={value.quality === 'unavailable' ? 'neutral' : 'attention'} />;
}

interface MetricCardProps {
  title: string;
  value: MetricValue;
  change: Change;
  currency: string;
  comparedTo: string;
  context: { trackingStart?: string; dailySince?: string | null };
  ratio?: boolean;
  second?: string;
  spark?: Spark;
  onPress: () => void;
}

function MetricCard({ title, value, change, currency, comparedTo, context, ratio = false, second, spark, onPress }: MetricCardProps) {
  const line = changeLine(change, currency, context);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.cell, pressed && styles.pressed]}>
      <Card style={styles.card}>
        <View style={styles.cardHead}>
          <AppText variant="caption" color="textSecondary" style={styles.flex}>
            {title}
          </AppText>
          <Quality value={value} />
        </View>
        {value.value === null ? (
          <AppText variant="bodyStrong" color="textMuted">
            {reasonText(value.reason, context)}
          </AppText>
        ) : ratio ? (
          <AppText variant="moneyMd">{rateText(value.value)}</AppText>
        ) : (
          <Money amount={value.value} currency={currency} size="md" />
        )}
        {second && (
          <AppText variant="micro" color="textSecondary">
            {second}
          </AppText>
        )}
        {spark && <Sparkline values={spark.values} color={spark.color} lastInProgress={spark.lastInProgress} />}
        {/* Without a value of its own, the reason above already says why there is no comparison. */}
        {value.value !== null && (
          <>
            <AppText variant="caption" color={line.color}>
              {line.text}
            </AppText>
            <AppText variant="micro" color="textMuted">
              {comparedTo}
            </AppText>
          </>
        )}
      </Card>
    </Pressable>
  );
}

// Where the money is at the end date: liquid = reserved + free (reservations are part of the liquid money, never on
// top of it), non-liquid holdings, liabilities, and the net worth they make.
function PositionCard({ data, currency, context }: { data: Overview; currency: string; context: { trackingStart?: string; dailySince?: string | null } }) {
  const m = data.current.metrics;
  const liquid = m.liquid.value;
  const reserved = m.reserved.value;
  const free = m.freeMoney.value;
  const showBar = liquid !== null && reserved !== null && free !== null && liquid > 0 && reserved >= 0 && free >= 0;
  const row = (label: string, value: MetricValue, indent = false) => (
    <View key={label} style={[styles.row, indent && styles.indent]}>
      <AppText variant={indent ? 'secondary' : 'bodyStrong'} color={indent ? 'textSecondary' : 'text'} style={styles.flex}>
        {label}
      </AppText>
      {value.value === null ? (
        <AppText variant="caption" color="textMuted">
          {reasonText(value.reason, context)}
        </AppText>
      ) : (
        <Money amount={value.value} currency={currency} size="row" tone={indent ? 'muted' : 'default'} />
      )}
    </View>
  );
  return (
    <Card style={styles.position}>
      {row(POINT_LABELS.liquid, m.liquid)}
      {showBar && (
        <View style={styles.bar} accessibilityLabel={`المحجوز ${formatMoney(reserved!, currency)} من السيولة ${formatMoney(liquid!, currency)}`}>
          <View style={[styles.barPart, { flex: reserved!, backgroundColor: colors[RESERVED_COLOR] }]} />
          <View style={[styles.barPart, { flex: free!, backgroundColor: colors.primary }]} />
        </View>
      )}
      {row(POINT_LABELS.reserved, m.reserved, true)}
      {row(POINT_LABELS.freeMoney, m.freeMoney, true)}
      {row(POINT_LABELS.nonLiquid, m.nonLiquid)}
      {(m.liabilities.value ?? 0) >= 0.005 && row(POINT_LABELS.liabilities, m.liabilities)}
      {row(POINT_LABELS.netWorth, m.netWorth)}
      <AppText variant="micro" color="textMuted">
        المحجوز جزء من السيولة، مش فلوس زيادة عليها.
      </AppText>
    </Card>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  flex: { flex: 1 },
  heroHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.sm },
  chart: { marginTop: space.md, marginBottom: space.xs, gap: space.sm },
  grid: { flexDirection: 'row-reverse', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: space.sm },
  cell: { width: '49%' },
  pressed: { opacity: opacity.pressed },
  card: { gap: space.xxs, padding: space.md, minHeight: 150 },
  cardHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.xs },
  position: { gap: space.sm },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.sm },
  indent: { paddingRight: space.md },
  bar: { flexDirection: 'row-reverse', height: 8, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: colors.progressTrack },
  barPart: { height: 8 },
});
