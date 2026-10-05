import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AddLineSheet, type AddedLine } from '@/components/plan/AddLineSheet';
import { LineSheet } from '@/components/plan/LineSheet';
import { BUCKET_TITLES } from '@/components/plan/labels';
import { PlanEditorSheet } from '@/components/plan/PlanEditorSheet';
import { PlanLineRow } from '@/components/plan/PlanLineRow';
import { contributionDone, unplannedStatus, withLine, withoutLine } from '@/components/plan/planUi';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatMoney } from '@/components/ui/formatMoney';
import { ListGroup, ListRow } from '@/components/ui/ListRow';
import { LoadingView } from '@/components/ui/LoadingView';
import { MetricGroup } from '@/components/ui/MetricGroup';
import { Money } from '@/components/ui/Money';
import { MonthSwitcher } from '@/components/ui/MonthSwitcher';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { StatusChip } from '@/components/ui/StatusChip';
import { colors, opacity, space } from '@/constants/theme';
import { emptyPlan, planProgress, planSuggestion, previousPlanMonth, safeToSpend } from '@/store/planning';
import type { ExpenseBucket } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { toMonthKey } from '@/utils/dates';
import { formatMonthLabel } from '@/utils/formatters';
import { parseAmount } from '@/utils/parseAmount';
import { runAction } from '@/utils/runAction';

const BUCKETS = Object.keys(BUCKET_TITLES) as ExpenseBucket[];

// "Where should this month's money go?" — read like a plan: summary (income / planned / left to
// plan), the safe-to-spend note, lines by bucket, fund contributions, spending outside the plan,
// add a line, recurring. Line taps open LineSheet; changes there are saved with savePlan.
export default function PlanScreen() {
  const state = useFinanceStore();
  const [month, setMonth] = useState(() => toMonthKey(new Date()));
  const [editing, setEditing] = useState(false);
  const [lineId, setLineId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  if (!state.hasHydrated) return <LoadingView />;

  const progress = planProgress(state, month);
  const previous = previousPlanMonth(state, month);
  const category = (id: string) => state.categories.find((c) => c.id === id);
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

  if (!progress) {
    return (
      <Screen scroll contentStyle={styles.content}>
        <MonthSwitcher month={month} onChange={setMonth} />
        <EmptyState
          icon="event-note"
          title={`مفيش خطة لشهر ${formatMonthLabel(month)}`}
          body="خطط لكل جنيه من دخلك: مصاريف ثابتة، مرنة، وتحويش."
          actionLabel="اقترح من مصروفي"
          onAction={() => create('suggest')}
        />
        <View style={styles.emptyActions}>
          {previous && (
            <Button label={`انسخ خطة ${formatMonthLabel(previous)}`} variant="secondary" block onPress={() => create('copy')} />
          )}
          <Button label="ابدأ من الصفر" variant="tertiary" onPress={() => create('scratch')} />
        </View>
        <RecurringLink />
      </Screen>
    );
  }

  const { plan } = progress;
  const currency = plan.currency;
  const contributionsTotal = plan.fundContributions.reduce((s, c) => s + c.amount, 0);
  const status = unplannedStatus(progress.unplanned);
  const safe = safeToSpend(state, month) ?? 0;
  const selectedLine = lineId ? progress.lines.find((l) => l.categoryId === lineId) : undefined;
  const selectedCategory = selectedLine && category(selectedLine.categoryId);

  // LineSheet / AddLineSheet edits on the saved plan (the editor sheet has its own draft).
  const saveLine = (categoryId: string, limitText: string, kind: AddedLine['kind']) => {
    const fresh = useFinanceStore.getState();
    const current = planProgress(fresh, month)?.plan;
    if (!current) return false;
    const limit = parseAmount(limitText, { allowZero: true }) ?? NaN;
    return runAction('تعذّر حفظ الخطة', () => fresh.savePlan(withLine(current, { categoryId, limit, kind })));
  };
  const removeLine = (categoryId: string) => {
    const fresh = useFinanceStore.getState();
    const current = planProgress(fresh, month)?.plan;
    if (current) runAction('تعذّر حفظ الخطة', () => fresh.savePlan(withoutLine(current, categoryId)));
  };

  return (
    <Screen scroll contentStyle={styles.content}>
      <MonthSwitcher month={month} onChange={setMonth} />

      {/* ── Summary ── */}
      <View style={styles.block}>
        <View style={styles.titleRow}>
          <AppText variant="section" style={styles.flex}>
            خطة الشهر
          </AppText>
          <Button label="تعديل" variant="tertiary" icon="edit" onPress={() => setEditing(true)} />
        </View>
        <MetricGroup
          metrics={[
            { label: 'الدخل المتوقع', value: <Money amount={plan.expectedIncome} currency={currency} align="center" /> },
            {
              label: 'المخطط',
              value: <Money amount={progress.totalPlanned + contributionsTotal} currency={currency} align="center" />,
            },
            { label: 'المتبقي للتخطيط', value: <Money amount={progress.unplanned} currency={currency} align="center" /> },
          ]}
        />
        {status === 'balanced' ? (
          <View style={styles.statusRow}>
            <StatusChip label="كل الدخل متخطط له" tone="ok" />
            <AppText variant="secondary" color="textSecondary">
              {formatMoney(0, currency)} غير مخطط
            </AppText>
          </View>
        ) : (
          <View style={styles.statusRow}>
            <AppText variant="secondary" color={status === 'over' ? 'warning' : 'text'} style={styles.flex}>
              {status === 'over'
                ? `مخطط أكتر من الدخل المتوقع بـ ${formatMoney(-progress.unplanned, currency)}`
                : `لسه ${formatMoney(progress.unplanned, currency)} محتاجة تتخطط`}
            </AppText>
            <Button label={status === 'over' ? 'راجع الخطة' : 'خطّطها'} variant="tertiary" onPress={() => setEditing(true)} />
          </View>
        )}
      </View>

      {/* ── Safe to spend + fixed vs flexible, explained once ── */}
      <View>
        <Pressable
          onPress={() => setInfoOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: infoOpen }}
          style={({ pressed }) => [styles.infoRow, pressed && { opacity: opacity.pressed }]}>
          <MaterialIcons name="info-outline" size={18} color={colors.textSecondary} />
          <AppText variant="secondary" color="textSecondary" style={styles.flex}>
            المرن هو اللي بيتحسب في «تقدر تصرف بأمان»: {formatMoney(safe, currency)} متاح.
          </AppText>
          <MaterialIcons name={infoOpen ? 'expand-less' : 'expand-more'} size={20} color={colors.textSecondary} />
        </Pressable>
        {infoOpen && (
          <View style={styles.infoBody}>
            <AppText variant="secondary">ثابت: مبلغ محجوز لمصروف معروف.</AppText>
            <AppText variant="secondary">مرن: جزء من المبلغ المتاح للصرف.</AppText>
          </View>
        )}
      </View>

      {/* ── Lines by bucket ── */}
      <View>
        {BUCKETS.map((bucket) => {
          const lines = progress.lines.filter((l) => l.bucket === bucket);
          if (lines.length === 0) return null;
          const totals = progress.buckets[bucket];
          return (
            <View key={bucket}>
              <SectionHeader
                title={BUCKET_TITLES[bucket]}
                trailing={
                  <AppText variant="secondary" color="textSecondary">
                    {formatMoney(totals.spent, currency)} من {formatMoney(totals.planned, currency)}
                  </AppText>
                }
              />
              <ListGroup>
                {lines.map((line) => {
                  const c = category(line.categoryId);
                  return (
                    <PlanLineRow
                      key={line.categoryId}
                      line={line}
                      name={c?.name ?? '—'}
                      archived={!!c?.archived}
                      currency={currency}
                      onPress={() => setLineId(line.categoryId)}
                    />
                  );
                })}
              </ListGroup>
            </View>
          );
        })}
        <View style={styles.addLine}>
          <Button label="+ أضف بند" variant="tertiary" onPress={() => setAdding(true)} />
        </View>
      </View>

      {/* ── Fund contributions ── */}
      {progress.contributions.length > 0 && (
        <View>
          <SectionHeader title="تحويش للصناديق" />
          <ListGroup>
            {progress.contributions.map((c) => {
              const done = contributionDone(c);
              return (
                <Pressable
                  key={c.fundId}
                  onPress={() => router.push({ pathname: '/fund/[id]', params: { id: c.fundId } })}
                  accessibilityRole="button"
                  accessibilityLabel={`${fundName(c.fundId)}، ${formatMoney(c.allocated, currency)} من ${formatMoney(c.planned, currency)}`}
                  style={({ pressed }) => [styles.contribution, pressed && styles.pressed]}>
                  <View style={styles.titleRow}>
                    <AppText variant="bodyStrong" numberOfLines={1} style={styles.flex}>
                      {fundName(c.fundId)}
                    </AppText>
                    {done && <StatusChip label="اتخصص" tone="ok" />}
                  </View>
                  <AppText variant="secondary" color="textSecondary">
                    {formatMoney(c.allocated, currency)} من {formatMoney(c.planned, currency)}
                  </AppText>
                  <ProgressBar progress={c.planned > 0 ? c.allocated / c.planned : 0} height={6} />
                </Pressable>
              );
            })}
          </ListGroup>
        </View>
      )}

      {/* ── Spending outside the plan ── */}
      {progress.unplannedSpent > 0.005 && (
        <View style={styles.titleRow}>
          <AppText variant="secondary" color="textSecondary" style={styles.flex}>
            مصروف خارج الخطة: {formatMoney(progress.unplannedSpent, currency)}
          </AppText>
          <Button label="المعاملات" variant="tertiary" onPress={() => router.push('/transactions')} />
        </View>
      )}

      <RecurringLink />

      {editing && <PlanEditorSheet key={plan.id} plan={plan} onClose={() => setEditing(false)} />}
      {selectedLine && selectedCategory && (
        <LineSheet
          key={selectedLine.categoryId}
          category={selectedCategory}
          limitText={String(selectedLine.limit)}
          kind={selectedLine.kind}
          currency={currency}
          progress={selectedLine}
          onSave={({ limitText, kind }) => {
            if (saveLine(selectedLine.categoryId, limitText, kind)) setLineId(null);
          }}
          onRemove={() => {
            removeLine(selectedLine.categoryId);
            setLineId(null);
          }}
          onClose={() => setLineId(null)}
        />
      )}
      {adding && (
        <AddLineSheet
          month={month}
          currency={currency}
          usedIds={plan.lines.map((l) => l.categoryId)}
          onAdd={(line) => {
            // "بند جديد" already saved its category and line; only existing categories are added here.
            const already = planProgress(useFinanceStore.getState(), month)?.plan.lines.some((l) => l.categoryId === line.categoryId);
            if (already || saveLine(line.categoryId, line.limitText, line.kind)) setAdding(false);
          }}
          onManage={() => {
            setAdding(false);
            router.push('/categories');
          }}
          onClose={() => setAdding(false)}
        />
      )}
    </Screen>
  );
}

function RecurringLink() {
  return (
    <ListGroup>
      <ListRow
        title="المعاملات المتكررة"
        subtitle="الإيجار والمرتب والفواتير اللي بتتكرر"
        icon="repeat"
        chevron
        onPress={() => router.push('/recurring')}
      />
    </ListGroup>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xxxl, gap: space.xl },
  block: { gap: space.md },
  titleRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.sm },
  statusRow: { flexDirection: 'row-reverse', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  flex: { flex: 1 },
  infoRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.sm, minHeight: 44 },
  infoBody: { gap: space.xs, paddingRight: space.xxl },
  addLine: { marginTop: space.md },
  contribution: { paddingHorizontal: space.lg, paddingVertical: space.md, gap: 6, minHeight: 64 },
  pressed: { backgroundColor: colors.surfaceSubtle, opacity: opacity.pressed },
  emptyActions: { gap: space.sm, alignItems: 'center' },
});
