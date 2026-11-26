import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { formatDateAr } from '@/components/ui/formatDateAr';
import { formatMoney } from '@/components/ui/formatMoney';
import { Money } from '@/components/ui/Money';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Segment } from '@/components/ui/Segment';
import { colors, opacity, radius, space, type as typeScale, type ColorToken } from '@/constants/theme';
import type { NativeSpend } from '@/store/analytics';
import type { AnalyticsPeriod } from '@/store/periods';
import { compareCategory, type CategoryShare, type SpendingView } from '@/store/spending';
import type { Bucket } from '@/store/types';

import { compactNumber } from './analyticsUi';
import { categoryIcon, EXPENSE_COLOR, FOOTPRINT_COLORS, FOOTPRINT_REST_COLOR, RESERVED_COLOR } from './categoryIcons';
import { useMeasuredWidth } from './common';
import { changeLine, comparedToLabel, noteTexts, periodLine, pillLabel, restLabel, shareText } from './overviewUi';
import { PeriodPill } from './PeriodSheet';
import { donutSlices, singleBars, sliceAt } from './seriesLayout';
import { averageLabel, barTitle, oneTimeLine, sourcesLine, trendTitle } from './spendingUi';

type Context = { trackingStart?: string; dailySince?: string | null };

interface SpendingSectionProps {
  view: SpendingView;
  currency: string;
  context: Context;
  category: (id: string) => { name: string; bucket: Bucket | undefined };
  accountName: (id: string) => string;
  currencyName: (code: string) => string;
  // Period A of the comparison (the previous period unless chosen) and whether it was chosen.
  periodA: AnalyticsPeriod | null;
  aChosen: boolean;
  onPickA: () => void;
  onResetA: () => void;
  onOpenCategories: (filter: { categoryIds?: string[]; excludeCategoryIds?: string[] }) => void;
  onOpenOneTime: () => void;
}

// «الإنفاق» (Phase 3): where the money went (donut + ranked categories), the daily trend, one category across A and B,
// by account / currency, and where it was paid from. Every number comes from store/spending.ts.
export function SpendingSection(props: SpendingSectionProps) {
  const { view, currency, context } = props;
  const notes = noteTexts(view.comparison.notes, view.comparison.earliestReliable);
  return (
    <View style={styles.wrap}>
      {notes.map((note) => (
        <Card key={note} variant="subtle">
          <AppText variant="secondary" color="textSecondary">
            {note}
          </AppText>
        </Card>
      ))}
      <View>
        <SectionHeader title="فلوسك راحت فين" />
        <WhereItWent {...props} />
      </View>
      <View>
        <SectionHeader title={trendTitle(view.trend.unit)} />
        <DailyTrend view={view} currency={currency} />
      </View>
      <View>
        <SectionHeader title="قارن بند" />
        <CategoryCompare {...props} />
      </View>
      <View>
        <SectionHeader title="اتصرف من فين" />
        <ByAccountOrCurrency view={view} currency={currency} accountName={props.accountName} currencyName={props.currencyName} />
      </View>
      <View>
        <SectionHeader title="اتدفع منين" />
        <Sources view={view} currency={currency} onOpenOneTime={props.onOpenOneTime} context={context} />
      </View>
    </View>
  );
}

// --- Donut + ranked list ----------------------------------------------------------------------------------------------

const DONUT = 200;
const OUTER = 92;
const INNER = 60;

function WhereItWent({ view, currency, context, category, onOpenCategories }: SpendingSectionProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const footprint = view.footprint;
  const rows = view.shares.rows;
  if (footprint.segments.length === 0) {
    return (
      <Card variant="subtle">
        <AppText variant="secondary" color="textSecondary" align="center">
          {view.shares.total === null ? 'مفيش بيانات متسجّلة في الفترة دي.' : 'مفيش مصروف في الفترة دي.'}
        </AppText>
      </Card>
    );
  }
  const colorOf = (i: number): ColorToken => (footprint.segments[i].key === 'rest' ? FOOTPRINT_REST_COLOR : FOOTPRINT_COLORS[i]);
  const rowColor = (id: string): ColorToken => {
    const i = footprint.segments.findIndex((s) => s.key === id);
    return i >= 0 ? FOOTPRINT_COLORS[i] : FOOTPRINT_REST_COLOR;
  };
  const label = (key: string, count: number) => (key === 'rest' ? restLabel(count) : category(key).name);
  const slices = donutSlices(footprint.segments.map((s) => s.amount), DONUT / 2, DONUT / 2, OUTER, INNER);
  const shown = selected !== null ? footprint.segments[selected] : null;
  const shownLine = shown && shown.change.delta !== null ? changeLine(shown.change, currency, context) : null;
  const aligned = view.comparison.alignment === 'elapsed';
  const pick = (x: number, y: number) => setSelected(sliceAt(x, y, DONUT / 2, DONUT / 2, OUTER, INNER, slices));
  const maxAmount = rows[0]?.amount ?? 0;

  return (
    <View style={styles.block}>
      <Card style={styles.card}>
        <View
          style={styles.donut}
          accessibilityLabel={`المصروف ${formatMoney(footprint.total ?? 0, currency)}: ${footprint.segments.map((s) => `${label(s.key, s.categoryIds.length)} ${shareText(s.tenths)}`).join('، ')}`}
          onStartShouldSetResponder={() => true}
          onResponderGrant={(e) => pick(e.nativeEvent.locationX, e.nativeEvent.locationY)}>
          <Svg width={DONUT} height={DONUT} pointerEvents="none">
            {slices.map((s, i) =>
              s.d ? <Path key={i} d={s.d} fill={colors[colorOf(i)]} opacity={selected === null || selected === i ? 1 : 0.35} /> : null
            )}
          </Svg>
          <View style={styles.center} pointerEvents="none">
            <AppText variant="caption" color="textSecondary" align="center">
              {shown ? label(shown.key, shown.categoryIds.length) : 'المصروف'}
            </AppText>
            <AppText variant="moneyRow" align="center">
              {formatMoney(shown ? shown.amount : footprint.total ?? 0, currency)}
            </AppText>
            {shown && (
              <AppText variant="caption" color="textSecondary" align="center">
                {shareText(shown.tenths)}
              </AppText>
            )}
          </View>
        </View>
        <AppText variant="caption" color={shownLine ? shownLine.color : 'textMuted'} align="center">
          {shown ? (shownLine ? `${shownLine.text} · ${comparedToLabel(aligned, null, false)}` : 'مفيش مقارنة للجزء ده') : 'دوس على جزء من الدايرة عشان تشوف تفاصيله.'}
        </AppText>
      </Card>

      <Card style={styles.list}>
        {rows.map((r: CategoryShare) => {
          const line = r.change.delta === null ? null : changeLine(r.change, currency, context);
          const color = rowColor(r.categoryId);
          return (
            <Pressable
              key={r.categoryId}
              onPress={() => onOpenCategories({ categoryIds: [r.categoryId] })}
              accessibilityRole="button"
              accessibilityLabel={`${category(r.categoryId).name}: ${formatMoney(r.amount, currency)}، ${shareText(r.tenths)}`}
              style={({ pressed }) => [styles.rankRow, pressed && styles.pressed]}>
              <View style={[styles.icon, { backgroundColor: colors[color] }]}>
                <MaterialIcons name={categoryIcon(r.categoryId, category(r.categoryId).bucket)} size={16} color={colors.onPrimary} />
              </View>
              <View style={styles.flex}>
                <View style={styles.rankHead}>
                  <AppText variant="secondary" numberOfLines={1} style={styles.flex}>
                    {category(r.categoryId).name}
                  </AppText>
                  <AppText variant="caption" color="textSecondary">
                    {shareText(r.tenths)}
                  </AppText>
                  <Money amount={r.amount} currency={currency} size="row" />
                </View>
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${maxAmount > 0 ? (r.amount / maxAmount) * 100 : 0}%`, backgroundColor: colors[color] }]} />
                </View>
                {line && (
                  <AppText variant="micro" color={line.color}>
                    {line.text}
                  </AppText>
                )}
              </View>
            </Pressable>
          );
        })}
      </Card>
    </View>
  );
}

// --- Daily trend -------------------------------------------------------------------------------------------------------

const TREND_HEIGHT = 140;

function DailyTrend({ view, currency }: { view: SpendingView; currency: string }) {
  const [width, onLayout] = useMeasuredWidth();
  const [selected, setSelected] = useState<number | null>(null);
  const { bars, average, unit } = view.trend;
  if (bars.length === 0) {
    return (
      <Card variant="subtle">
        <AppText variant="secondary" color="textSecondary" align="center">
          مفيش أيام متسجّلة في الفترة دي.
        </AppText>
      </Card>
    );
  }
  const layout = singleBars(bars.map((b) => b.amount), width, TREND_HEIGHT, average);
  const pick = (x: number) => setSelected(Math.min(bars.length - 1, Math.max(0, Math.floor((x - layout.plotLeft) / layout.slotWidth))));
  const shown = selected !== null ? bars[selected] : null;
  const avg = averageLabel(unit, average, currency);
  return (
    <Card style={styles.card}>
      <AppText variant="caption" color="textSecondary">
        {shown ? barTitle(shown, currency) : 'دوس على عمود عشان تشوف مبلغه.'}
      </AppText>
      <View
        onLayout={onLayout}
        style={{ height: TREND_HEIGHT + 20 }}
        accessibilityLabel={`${trendTitle(unit)}${avg ? `، ${avg}` : ''}`}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => pick(e.nativeEvent.locationX)}
        onResponderMove={(e) => pick(e.nativeEvent.locationX)}>
        {width > 0 && (
          <Svg width={width} height={TREND_HEIGHT + 20} pointerEvents="none">
            {layout.ticks.map((t) => (
              <Line key={`g${t.value}`} x1={layout.plotLeft} x2={width} y1={t.y} y2={t.y} stroke={colors.divider} strokeWidth={1} />
            ))}
            {layout.ticks.map((t) => (
              <SvgText key={`t${t.value}`} x={layout.plotLeft - 6} y={t.y + 4} fontSize={typeScale.micro.fontSize} fill={colors.textMuted} textAnchor="end">
                {compactNumber(t.value)}
              </SvgText>
            ))}
            {layout.bars.map((b, i) => (
              <Rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} fill={colors[EXPENSE_COLOR]} opacity={selected === null || selected === i ? 1 : 0.5} />
            ))}
            {layout.refY !== null && <Line x1={layout.plotLeft} x2={width} y1={layout.refY} y2={layout.refY} stroke={colors.textSecondary} strokeWidth={1.5} strokeDasharray="5 4" />}
            <SvgText x={layout.plotLeft} y={TREND_HEIGHT + 16} fontSize={typeScale.micro.fontSize} fill={colors.textMuted} textAnchor="start">
              {formatDateAr(bars[0].from, { year: false })}
            </SvgText>
            <SvgText x={width} y={TREND_HEIGHT + 16} fontSize={typeScale.micro.fontSize} fill={colors.textMuted} textAnchor="end">
              {formatDateAr(bars[bars.length - 1].to, { year: false })}
            </SvgText>
          </Svg>
        )}
      </View>
      {avg && (
        <View style={styles.legend}>
          <View style={styles.dash} />
          <AppText variant="caption" color="textSecondary">
            {avg}
          </AppText>
        </View>
      )}
    </Card>
  );
}

// --- One category, A vs B -------------------------------------------------------------------------------------------------

function CategoryCompare({ view, currency, context, category, periodA, aChosen, onPickA, onResetA }: SpendingSectionProps) {
  const ids = [...new Set([...view.shares.rows.map((r) => r.categoryId), ...view.comparison.categories.map((c) => c.categoryId)])];
  const [picked, setPicked] = useState<string | null>(null);
  const id = picked && ids.includes(picked) ? picked : ids[0];
  if (!id) {
    return (
      <Card variant="subtle">
        <AppText variant="secondary" color="textSecondary" align="center">
          مفيش بنود اتصرف عليها في الفترتين.
        </AppText>
      </Card>
    );
  }
  const change = compareCategory(view, id);
  const line = changeLine(change, currency, context);
  const value = (v: { value: number | null }) => (v.value === null ? '—' : formatMoney(v.value, currency));
  return (
    <Card style={styles.card}>
      <ChipRow>
        {ids.slice(0, 12).map((c) => (
          <Chip key={c} label={category(c).name} selected={c === id} onPress={() => setPicked(c)} />
        ))}
      </ChipRow>
      <View style={styles.pills}>
        {periodA ? <PeriodPill label="أ" period={periodA} previous={!aChosen} onPress={onPickA} /> : <Chip label="أ: اختار فترة" onPress={onPickA} />}
        <AppText variant="secondary" color="textSecondary">{`ب: ${pillLabel(view.comparison.current.period).replace(' ▾', '')} · ${periodLine(view.comparison.current.period)}`}</AppText>
        {aChosen && <Chip label="أ = الفترة اللي قبلها" onPress={onResetA} />}
      </View>
      <View style={styles.sides}>
        <View style={styles.side}>
          <AppText variant="micro" color="textMuted">
            أ
          </AppText>
          <AppText variant="moneyRow">{value(change.previous)}</AppText>
        </View>
        <View style={styles.side}>
          <AppText variant="micro" color="textMuted">
            ب
          </AppText>
          <AppText variant="moneyRow">{value(change.current)}</AppText>
        </View>
      </View>
      <AppText variant="caption" color={line.color}>
        {line.text}
      </AppText>
    </Card>
  );
}

// --- By account / currency ----------------------------------------------------------------------------------------------

function ByAccountOrCurrency({ view, currency, accountName, currencyName }: { view: SpendingView; currency: string; accountName: (id: string) => string; currencyName: (c: string) => string }) {
  const [by, setBy] = useState<'account' | 'currency'>('account');
  const rows: NativeSpend[] = by === 'account' ? view.byAccount : view.byCurrency;
  return (
    <Card style={styles.card}>
      <Segment<'account' | 'currency'>
        options={[
          { label: 'حسب الحساب', value: 'account' },
          { label: 'حسب العملة', value: 'currency' },
        ]}
        value={by}
        onChange={setBy}
      />
      {rows.length === 0 ? (
        <AppText variant="secondary" color="textSecondary" align="center">
          مفيش مصروف في الفترة دي.
        </AppText>
      ) : (
        rows.map((r) => (
          <View key={r.key} style={styles.row}>
            <AppText variant="secondary" style={styles.flex}>
              {by === 'account' ? accountName(r.key) : currencyName(r.key)}
            </AppText>
            <Money amount={r.native} currency={r.currency} size="row" {...(r.currency !== currency ? { converted: { amount: r.value, currency } } : {})} />
          </View>
        ))
      )}
      <AppText variant="micro" color="textMuted">
        المبلغ بعملته، وتحته قيمته بعملة العرض وقت التسجيل.
      </AppText>
    </Card>
  );
}

// --- Where it was paid from ----------------------------------------------------------------------------------------------

function Sources({ view, currency, onOpenOneTime }: { view: SpendingView; currency: string; onOpenOneTime: () => void; context: Context }) {
  const sources = sourcesLine(view.fromFunds, view.fromFree, currency);
  const funds = view.fromFunds ?? 0;
  const free = view.fromFree ?? 0;
  return (
    <Card style={styles.card}>
      {sources ? (
        <>
          {funds + free > 0.005 && funds >= 0 && free >= 0 && (
            <View style={styles.bar}>
              <View style={{ flex: funds, backgroundColor: colors[RESERVED_COLOR] }} />
              <View style={{ flex: free, backgroundColor: colors[EXPENSE_COLOR] }} />
            </View>
          )}
          <AppText variant="secondary">{sources}</AppText>
        </>
      ) : (
        <AppText variant="secondary" color="textSecondary">
          مفيش بيانات متسجّلة في الفترة دي.
        </AppText>
      )}
      <Pressable onPress={onOpenOneTime} disabled={view.oneTime.amount < 0.005} accessibilityRole="button" style={({ pressed }) => [pressed && styles.pressed]}>
        <AppText variant="secondary" color={view.oneTime.amount < 0.005 ? 'textSecondary' : 'primary800'}>
          {oneTimeLine(view.oneTime.amount, view.oneTime.ofTotal, currency)}
        </AppText>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  block: { gap: space.sm },
  card: { gap: space.sm },
  donut: { width: DONUT, height: DONUT, alignSelf: 'center' },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xxxl },
  list: { gap: space.md },
  rankRow: { flexDirection: 'row-reverse', gap: space.sm, alignItems: 'flex-start' },
  rankHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.sm },
  icon: { width: 28, height: 28, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  track: { height: 6, borderRadius: radius.pill, backgroundColor: colors.progressTrack, overflow: 'hidden', marginTop: space.xxs, flexDirection: 'row-reverse' },
  fill: { height: 6 },
  pressed: { opacity: opacity.pressed },
  flex: { flex: 1 },
  legend: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.xs },
  dash: { width: 18, height: 0, borderTopWidth: 2, borderStyle: 'dashed', borderColor: colors.textSecondary },
  pills: { gap: space.sm },
  sides: { flexDirection: 'row-reverse', gap: space.md },
  side: { flex: 1, gap: space.xxs, alignItems: 'flex-end' },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.sm },
  bar: { flexDirection: 'row-reverse', height: 10, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: colors.progressTrack },
});
