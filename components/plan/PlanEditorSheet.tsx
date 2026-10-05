import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AmountInput } from '@/components/ui/AmountInput';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { FormInput, FormSheet } from '@/components/ui/FormSheet';
import { formatMoney } from '@/components/ui/formatMoney';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Segment } from '@/components/ui/Segment';
import { StatusChip } from '@/components/ui/StatusChip';
import { colors, opacity, radius, space } from '@/constants/theme';
import type { PlanInput } from '@/store/operations';
import { planProgress, unplannedAmount } from '@/store/planning';
import { fundsByPriority } from '@/store/selectors';
import type { CurrencyCode, ExpenseBucket, MonthlyPlan, PlanLineKind } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { fromEGP, toEGP } from '@/utils/currency';
import { confirmAction } from '@/utils/dialogs';
import { formatMonthLabel } from '@/utils/formatters';
import { parseAmount } from '@/utils/parseAmount';
import { runAction } from '@/utils/runAction';

import { AddLineSheet, type AddedLine } from './AddLineSheet';
import { BUCKET_TITLES } from './labels';
import { LineSheet } from './LineSheet';
import { unplannedStatus } from './planUi';

export { BUCKET_TITLES };

interface DraftLine {
  categoryId: string;
  limitText: string;
  kind: PlanLineKind;
}

const amountOf = (text: string) => parseAmount(text, { allowZero: true });

interface PlanEditorSheetProps {
  plan: MonthlyPlan;
  onClose: () => void;
}

// Edit mode for a month's plan: income, currency, limits, fixed/flexible, categories and
// fund contributions. Changing the currency converts every amount at current rates.
// Layout: live "المتبقي للتخطيط" at the top · currency · expected income (big) · lines by bucket
// (name → LineSheet, ثابت/مرن, limit, remove) · "+ أضف بند" · fund contributions · delete plan.
export function PlanEditorSheet({ plan, onClose }: PlanEditorSheetProps) {
  const state = useFinanceStore();
  const funds = fundsByPriority(state);
  // All expense categories (archived ones included, so existing lines keep their names).
  const expenseCategories = state.categories.filter((c) => c.kind === 'expense');

  const [currency, setCurrency] = useState<CurrencyCode>(plan.currency);
  const [incomeText, setIncomeText] = useState(String(plan.expectedIncome));
  const [lines, setLines] = useState<DraftLine[]>(
    plan.lines.map((l) => ({ categoryId: l.categoryId, limitText: String(l.limit), kind: l.kind }))
  );
  const [contributions, setContributions] = useState<Record<string, string>>(
    Object.fromEntries(plan.fundContributions.map((c) => [c.fundId, String(c.amount)]))
  );

  const toInput = (): PlanInput => ({
    month: plan.month,
    currency,
    expectedIncome: amountOf(incomeText) ?? NaN,
    lines: lines.map((l) => ({ categoryId: l.categoryId, limit: amountOf(l.limitText) ?? NaN, kind: l.kind })),
    fundContributions: Object.entries(contributions)
      .filter(([, text]) => text.trim() !== '')
      .map(([fundId, text]) => ({ fundId, amount: amountOf(text) ?? NaN })),
  });
  const draft = toInput();
  const unplanned = [draft.expectedIncome, ...draft.lines.map((l) => l.limit), ...draft.fundContributions.map((c) => c.amount)].every(
    Number.isFinite
  )
    ? unplannedAmount(draft)
    : null;

  const changeCurrency = (next: CurrencyCode) => {
    if (next === currency) return;
    const rates = state.settings.exchangeRates;
    const convert = (text: string) => {
      const value = amountOf(text);
      return value === null ? text : String(Math.round(fromEGP(toEGP(value, currency, rates), next, rates)));
    };
    setIncomeText(convert);
    setLines((prev) => prev.map((l) => ({ ...l, limitText: convert(l.limitText) })));
    setContributions((prev) => Object.fromEntries(Object.entries(prev).map(([id, text]) => [id, convert(text)])));
    setCurrency(next);
  };

  const updateLine = (categoryId: string, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l) => (l.categoryId === categoryId ? { ...l, ...patch } : l)));
  const removeLine = (categoryId: string) => setLines((prev) => prev.filter((l) => l.categoryId !== categoryId));
  const addLine = (line: AddedLine) => setLines((prev) => [...prev.filter((l) => l.categoryId !== line.categoryId), line]);

  const [sheet, setSheet] = useState<'add' | { categoryId: string } | null>(null);
  const editingLine = sheet && sheet !== 'add' ? lines.find((l) => l.categoryId === sheet.categoryId) : undefined;

  // The categories screen is a route, which can't show above this modal: leave the editor first.
  const openCategories = () =>
    confirmAction({
      title: 'إدارة البنود',
      message: 'هيتقفل تعديل الخطة، والتعديلات اللي ما اتحفظتش هتضيع.',
      confirmText: 'متابعة',
      cancelText: 'إلغاء',
      onConfirm: () => {
        setSheet(null);
        onClose();
        router.push('/categories');
      },
    });

  const handleSave = () => {
    if (runAction('تعذّر حفظ الخطة', () => state.savePlan(toInput()))) onClose();
  };

  const handleDelete = () =>
    confirmAction({
      title: 'حذف الخطة',
      message: `هل تريد حذف خطة ${formatMonthLabel(plan.month)}؟`,
      confirmText: 'حذف',
      cancelText: 'إلغاء',
      onConfirm: () => {
        if (runAction('تعذّر الحذف', () => state.deletePlan(plan.month))) onClose();
      },
    });

  const categoryById = new Map(expenseCategories.map((c) => [c.id, c]));
  const savedProgress = planProgress(state, plan.month);
  const status = unplanned === null ? null : unplannedStatus(unplanned);

  return (
    <FormSheet visible title={`خطة ${formatMonthLabel(plan.month)}`} onCancel={onClose} onSave={handleSave}>
      {/* Live summary at the top of the content. */}
      <View style={styles.summary}>
        <AppText variant="secondary" color="textSecondary">
          المتبقي للتخطيط
        </AppText>
        {unplanned === null ? (
          <AppText variant="bodyStrong" color="textSecondary">
            —
          </AppText>
        ) : status === 'balanced' ? (
          <StatusChip label="كل الدخل متخطط له" tone="ok" />
        ) : (
          <AppText variant="bodyStrong" color={status === 'over' ? 'warning' : 'text'}>
            {status === 'over' ? `مخطط أكتر من الدخل بـ ${formatMoney(-unplanned, currency)}` : formatMoney(unplanned, currency)}
          </AppText>
        )}
      </View>

      <FormField label="العملة">
        <Segment<CurrencyCode>
          options={[
            { label: 'ر.س', value: 'SAR' },
            { label: 'ج.م', value: 'EGP' },
            { label: '$', value: 'USD' },
          ]}
          value={currency}
          onChange={changeCurrency}
        />
      </FormField>

      <FormField label="الدخل المتوقع">
        <AmountInput value={incomeText} onChangeText={setIncomeText} currency={currency} allowZero accessibilityLabel="الدخل المتوقع" />
      </FormField>

      {(Object.keys(BUCKET_TITLES) as ExpenseBucket[]).map((bucket) => {
        const bucketLines = lines.filter((l) => categoryById.get(l.categoryId)?.bucket === bucket);
        if (bucketLines.length === 0) return null;
        return (
          <View key={bucket}>
            <SectionHeader title={BUCKET_TITLES[bucket]} />
            <View style={styles.group}>
              {bucketLines.map((line, i) => {
                const category = categoryById.get(line.categoryId);
                const name = category?.name ?? '—';
                return (
                  <View key={line.categoryId} style={[styles.lineRow, i > 0 && styles.lineBorder]}>
                    <View style={styles.lineTop}>
                      <Pressable
                        onPress={() => setSheet({ categoryId: line.categoryId })}
                        accessibilityRole="button"
                        accessibilityLabel={`تفاصيل ${name}`}
                        style={({ pressed }) => [styles.lineName, pressed && { opacity: opacity.pressed }]}>
                        <AppText variant="bodyStrong" color={category?.archived ? 'textMuted' : 'text'} numberOfLines={1} style={styles.flex}>
                          {name}
                        </AppText>
                        <MaterialIcons name="chevron-left" size={20} color={colors.textSecondary} />
                      </Pressable>
                      <Pressable
                        onPress={() => removeLine(line.categoryId)}
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel={`شيل ${name} من الخطة`}
                        style={({ pressed }) => [styles.remove, pressed && { opacity: opacity.pressed }]}>
                        <MaterialIcons name="remove-circle-outline" size={22} color={colors.textSecondary} />
                      </Pressable>
                    </View>
                    <View style={styles.lineBottom}>
                      <View style={styles.kind}>
                        <Segment<PlanLineKind>
                          options={[
                            { label: 'ثابت', value: 'fixed' },
                            { label: 'مرن', value: 'flexible' },
                          ]}
                          value={line.kind}
                          onChange={(kind) => updateLine(line.categoryId, { kind })}
                        />
                      </View>
                      <FormInput
                        value={line.limitText}
                        onChangeText={(text) => updateLine(line.categoryId, { limitText: text })}
                        keyboardType="decimal-pad"
                        placeholder="0"
                        accessibilityLabel={`حد ${name}`}
                        style={styles.limitInput}
                      />
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        );
      })}

      <View style={styles.add}>
        <Button label="+ أضف بند" variant="tertiary" onPress={() => setSheet('add')} />
      </View>

      {funds.length > 0 && (
        <>
          <SectionHeader title="تحويش للصناديق" />
          <View style={styles.group}>
            {funds.map((fund, i) => (
              <View key={fund.id} style={[styles.fundRow, i > 0 && styles.lineBorder]}>
                <AppText variant="bodyStrong" numberOfLines={1} style={styles.flex}>
                  {fund.name}
                </AppText>
                <FormInput
                  value={contributions[fund.id] ?? ''}
                  onChangeText={(text) => setContributions((prev) => ({ ...prev, [fund.id]: text }))}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  accessibilityLabel={`تحويش ${fund.name}`}
                  style={styles.limitInput}
                />
              </View>
            ))}
          </View>
        </>
      )}

      <View style={styles.delete}>
        <Button label="احذف الخطة" variant="destructive" icon="delete-outline" block onPress={handleDelete} />
      </View>

      {sheet === 'add' && (
        <AddLineSheet
          month={plan.month}
          currency={currency}
          usedIds={lines.map((l) => l.categoryId)}
          onAdd={(line) => {
            addLine(line);
            setSheet(null);
          }}
          onManage={openCategories}
          onClose={() => setSheet(null)}
        />
      )}
      {editingLine && categoryById.get(editingLine.categoryId) && (
        <LineSheet
          key={editingLine.categoryId}
          category={categoryById.get(editingLine.categoryId)!}
          limitText={editingLine.limitText}
          kind={editingLine.kind}
          currency={currency}
          progress={currency === plan.currency ? savedProgress?.lines.find((l) => l.categoryId === editingLine.categoryId) : undefined}
          onSave={(patch) => {
            updateLine(editingLine.categoryId, patch);
            setSheet(null);
          }}
          onRemove={() => {
            removeLine(editingLine.categoryId);
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  summary: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  group: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  lineRow: { paddingHorizontal: space.md, paddingVertical: space.md, gap: space.sm },
  lineBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  lineTop: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.sm },
  lineName: { flex: 1, flexDirection: 'row-reverse', alignItems: 'center', gap: space.xs, minHeight: 36 },
  remove: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  lineBottom: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.md },
  kind: { flex: 1 },
  limitInput: { width: 120, textAlign: 'right' },
  fundRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.md, padding: space.md },
  flex: { flex: 1 },
  add: { marginTop: space.md },
  delete: { marginTop: space.xxxl },
});
