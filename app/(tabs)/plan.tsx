import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BUCKET_TITLES, PlanEditorSheet, unplannedColor } from '@/components/plan/PlanEditorSheet';
import { Card } from '@/components/ui/Card';
import { LoadingView } from '@/components/ui/LoadingView';
import { MonthSwitcher } from '@/components/ui/MonthSwitcher';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Colors, FinanceColors } from '@/constants/theme';
import { emptyPlan, planProgress, planSuggestion, previousPlanMonth, type LineProgress } from '@/store/planning';
import type { CurrencyCode, ExpenseBucket } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { toMonthKey } from '@/utils/dates';
import { formatCurrency, formatMonthLabel } from '@/utils/formatters';
import { runAction } from '@/utils/runAction';

export default function PlanScreen() {
  const insets = useSafeAreaInsets();
  const state = useFinanceStore();
  const [month, setMonth] = useState(() => toMonthKey(new Date()));
  const [editing, setEditing] = useState(false);

  if (!state.hasHydrated) return <LoadingView />;

  const progress = planProgress(state, month);
  const previous = previousPlanMonth(state, month);
  const categoryName = (id: string) => state.categories.find((c) => c.id === id)?.name ?? '—';
  const fundName = (id: string) => state.funds.find((f) => f.id === id)?.name ?? '—';

  const create = (how: 'suggest' | 'copy' | 'scratch') => {
    const created = runAction('تعذّر إنشاء الخطة', () => {
      if (how === 'suggest') state.savePlan(planSuggestion(state, month));
      else if (how === 'copy' && previous) state.copyPlan(previous, month);
      else state.savePlan(emptyPlan(state, month));
    });
    // A blank plan is only useful once filled in.
    if (created && how === 'scratch') setEditing(true);
  };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}>
        <MonthSwitcher month={month} onChange={setMonth} />
        <TouchableOpacity onPress={() => router.push('/recurring')} style={styles.recurringLink} hitSlop={8}>
          <Text style={styles.editLink}>المعاملات المتكررة ‹</Text>
        </TouchableOpacity>

        {!progress ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>مفيش خطة لشهر {formatMonthLabel(month)}</Text>
            <Text style={styles.emptyBody}>خطط لكل جنيه من دخلك: مصاريف ثابتة، مرنة، وتحويش.</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => create('suggest')} activeOpacity={0.85}>
              <Text style={styles.primaryText}>اقترح من مصروفي</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryBtn, !previous && styles.disabled]}
              onPress={() => create('copy')}
              disabled={!previous}
              activeOpacity={0.85}>
              <Text style={styles.secondaryText}>
                {previous ? `انسخ خطة ${formatMonthLabel(previous)}` : 'انسخ خطة الشهر اللي فات'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => create('scratch')} activeOpacity={0.85}>
              <Text style={styles.secondaryText}>ابدأ من الصفر</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* ── Header: income & unplanned ── */}
            <Card>
              <View style={styles.headerRow}>
                <TouchableOpacity onPress={() => setEditing(true)} hitSlop={8}>
                  <Text style={styles.editLink}>تعديل</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setEditing(true)} style={styles.headerText}>
                  <Text style={styles.muted}>الدخل المتوقع</Text>
                  <Text style={styles.income}>{formatCurrency(progress.plan.expectedIncome, progress.plan.currency)}</Text>
                </TouchableOpacity>
              </View>
              <Text style={[styles.unplanned, { color: unplannedColor(progress.unplanned) }]}>
                {unplannedLabel(progress.unplanned, progress.plan.currency)}
              </Text>
            </Card>

            {/* ── Lines by bucket ── */}
            {(Object.keys(BUCKET_TITLES) as ExpenseBucket[]).map((bucket) => {
              const lines = progress.lines.filter((l) => l.bucket === bucket);
              if (lines.length === 0) return null;
              const totals = progress.buckets[bucket];
              return (
                <View key={bucket} style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.muted}>
                      {formatCurrency(totals.spent, progress.plan.currency)} / {formatCurrency(totals.planned, progress.plan.currency)}
                    </Text>
                    <Text style={styles.sectionTitle}>{BUCKET_TITLES[bucket]}</Text>
                  </View>
                  <Card style={styles.listCard}>
                    {lines.map((line, i) => (
                      <PlanLineRow
                        key={line.categoryId}
                        line={line}
                        name={categoryName(line.categoryId)}
                        currency={progress.plan.currency}
                        isLast={i === lines.length - 1}
                      />
                    ))}
                  </Card>
                </View>
              );
            })}

            {progress.unplannedSpent > 0.005 && (
              <Text style={[styles.muted, styles.offPlan]}>
                مصروفات خارج الخطة: {formatCurrency(progress.unplannedSpent, progress.plan.currency)}
              </Text>
            )}

            {/* ── Fund contributions ── */}
            {progress.contributions.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>تحويش للصناديق</Text>
                <Card style={styles.listCard}>
                  {progress.contributions.map((c, i) => (
                    <View key={c.fundId} style={[styles.row, i < progress.contributions.length - 1 && styles.rowBorder]}>
                      <Text style={[styles.value, { color: c.allocated + 0.005 >= c.planned ? FinanceColors.income : Colors.light.text }]}>
                        {formatCurrency(c.allocated, progress.plan.currency)} / {formatCurrency(c.planned, progress.plan.currency)}
                      </Text>
                      <Text style={styles.lineName}>{fundName(c.fundId)}</Text>
                    </View>
                  ))}
                </Card>
              </View>
            )}

            {/* ── Summary ── */}
            <Card style={styles.summary}>
              <SummaryItem label="مخطط" value={formatCurrency(progress.totalPlanned, progress.plan.currency)} />
              <SummaryItem label="مصروف" value={formatCurrency(progress.totalSpent, progress.plan.currency)} />
              <SummaryItem
                label="متبقي"
                value={formatCurrency(progress.totalPlanned - progress.totalSpent, progress.plan.currency)}
                color={progress.totalPlanned - progress.totalSpent < 0 ? FinanceColors.expense : undefined}
              />
            </Card>
          </>
        )}
      </ScrollView>

      {editing && progress && <PlanEditorSheet key={progress.plan.id} plan={progress.plan} onClose={() => setEditing(false)} />}
    </View>
  );
}

function unplannedLabel(unplanned: number, currency: CurrencyCode): string {
  if (Math.abs(unplanned) < 0.5) return 'كل الدخل متخطط له ✓';
  if (unplanned > 0) return `لسه ${formatCurrency(unplanned, currency)} محتاج تخطط له`;
  return `مخطط أكتر من دخلك بـ ${formatCurrency(-unplanned, currency)}`;
}

function PlanLineRow({ line, name, currency, isLast }: { line: LineProgress; name: string; currency: CurrencyCode; isLast: boolean }) {
  const over = line.remaining < -0.005;
  return (
    <View style={[styles.line, !isLast && styles.rowBorder]}>
      <View style={styles.row}>
        <Text style={[styles.value, over && styles.over]}>
          {over ? `عدّيت بـ ${formatCurrency(-line.remaining, currency)}` : `باقي ${formatCurrency(line.remaining, currency)}`}
        </Text>
        <View style={styles.lineTitle}>
          <View style={[styles.badge, line.kind === 'fixed' && styles.badgeFixed]}>
            <Text style={styles.badgeText}>{line.kind === 'fixed' ? 'ثابت' : 'مرن'}</Text>
          </View>
          <Text style={styles.lineName}>{name}</Text>
        </View>
      </View>
      <ProgressBar progress={line.pct} color={over ? FinanceColors.expense : Colors.light.tint} />
      <Text style={styles.small}>
        {formatCurrency(line.spent, currency)} من {formatCurrency(line.limit, currency)}
      </Text>
    </View>
  );
}

function SummaryItem({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.summaryItem}>
      <Text style={[styles.value, color ? { color } : null]}>{value}</Text>
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.light.background },
  content: { paddingHorizontal: 16 },
  empty: { alignItems: 'stretch', paddingVertical: 32, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.light.text, textAlign: 'center' },
  emptyBody: { fontSize: 14, color: Colors.light.icon, textAlign: 'center', marginBottom: 8 },
  primaryBtn: { paddingVertical: 14, borderRadius: 10, alignItems: 'center', backgroundColor: Colors.light.tint },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  secondaryBtn: { paddingVertical: 14, borderRadius: 10, alignItems: 'center', backgroundColor: Colors.light.tint + '15' },
  secondaryText: { color: Colors.light.tint, fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.4 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerText: { alignItems: 'flex-end', gap: 2 },
  income: { fontSize: 22, fontWeight: '700', color: Colors.light.text },
  recurringLink: { alignSelf: 'flex-end', marginTop: -8, marginBottom: 12 },
  editLink: { fontSize: 15, fontWeight: '700', color: Colors.light.tint },
  unplanned: { marginTop: 10, fontSize: 14, fontWeight: '700', textAlign: 'right' },
  section: { marginTop: 22 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: Colors.light.text, textAlign: 'right', marginBottom: 8 },
  listCard: { padding: 0, overflow: 'hidden' },
  line: { paddingHorizontal: 16, paddingVertical: 12, gap: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 0 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: FinanceColors.progressTrack },
  lineTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  lineName: { fontSize: 15, fontWeight: '600', color: Colors.light.text, textAlign: 'right' },
  badge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1, backgroundColor: Colors.light.tint + '18' },
  badgeFixed: { backgroundColor: Colors.light.icon + '22' },
  badgeText: { fontSize: 10, fontWeight: '700', color: Colors.light.icon },
  value: { fontSize: 13, fontWeight: '600', color: Colors.light.text },
  over: { color: FinanceColors.expense },
  small: { fontSize: 11, color: Colors.light.icon, textAlign: 'right' },
  muted: { fontSize: 13, color: Colors.light.icon, textAlign: 'right' },
  offPlan: { marginTop: 12 },
  summary: { marginTop: 22, flexDirection: 'row', justifyContent: 'space-around' },
  summaryItem: { alignItems: 'center', gap: 2 },
});
