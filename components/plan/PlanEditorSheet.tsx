import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { FieldLabel, FormInput, FormSheet } from '@/components/ui/FormSheet';
import { Segment } from '@/components/ui/Segment';
import { Colors, FinanceColors } from '@/constants/theme';
import type { PlanInput } from '@/store/operations';
import { unplannedAmount } from '@/store/planning';
import { fundsByPriority } from '@/store/selectors';
import type { CurrencyCode, ExpenseBucket, MonthlyPlan, PlanLineKind } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { fromEGP, toEGP } from '@/utils/currency';
import { confirmAction } from '@/utils/dialogs';
import { currencySymbol, formatCurrency, formatMonthLabel } from '@/utils/formatters';
import { parseAmount } from '@/utils/parseAmount';
import { runAction } from '@/utils/runAction';

import { AddLineSheet, type AddedLine } from './AddLineSheet';
import { BUCKET_TITLES } from './labels';
import { LineSheet } from './LineSheet';

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
  const symbol = currencySymbol(currency);

  return (
    <FormSheet visible title={`خطة ${formatMonthLabel(plan.month)}`} onCancel={onClose} onSave={handleSave}>
      <FieldLabel>العملة</FieldLabel>
      <Segment<CurrencyCode>
        options={[
          { label: 'ر.س', value: 'SAR' },
          { label: 'ج.م', value: 'EGP' },
          { label: '$', value: 'USD' },
        ]}
        value={currency}
        onChange={changeCurrency}
      />

      <FieldLabel>الدخل المتوقع ({symbol})</FieldLabel>
      <FormInput value={incomeText} onChangeText={setIncomeText} keyboardType="decimal-pad" />

      {unplanned !== null && (
        <Text style={[styles.unplanned, { color: unplannedColor(unplanned) }]}>
          غير مخطط: {formatCurrency(unplanned, currency)}
        </Text>
      )}

      {(Object.keys(BUCKET_TITLES) as ExpenseBucket[]).map((bucket) => {
        const bucketLines = lines.filter((l) => categoryById.get(l.categoryId)?.bucket === bucket);
        return (
          <View key={bucket}>
            <Text style={styles.bucketTitle}>{BUCKET_TITLES[bucket]}</Text>
            {bucketLines.length === 0 && <Text style={styles.hint}>مفيش بنود</Text>}
            {bucketLines.map((line) => {
              const limit = amountOf(line.limitText);
              return (
                <TouchableOpacity
                  key={line.categoryId}
                  style={styles.lineRow}
                  onPress={() => setSheet({ categoryId: line.categoryId })}
                  activeOpacity={0.7}>
                  <Text style={styles.chevron}>‹</Text>
                  <Text style={styles.lineLimit}>{limit === null ? '—' : formatCurrency(limit, currency)}</Text>
                  <View style={[styles.kindBadge, line.kind === 'fixed' && styles.kindFixed]}>
                    <Text style={styles.kindText}>{line.kind === 'fixed' ? 'ثابت' : 'مرن'}</Text>
                  </View>
                  <Text style={styles.lineName} numberOfLines={1}>
                    {categoryById.get(line.categoryId)?.name ?? '—'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        );
      })}

      <TouchableOpacity style={styles.addBtn} onPress={() => setSheet('add')} activeOpacity={0.8}>
        <Text style={styles.addText}>+ أضف بند</Text>
      </TouchableOpacity>

      {funds.length > 0 && (
        <>
          <Text style={styles.bucketTitle}>تحويش للصناديق</Text>
          {funds.map((fund) => (
            <View key={fund.id} style={styles.lineRow}>
              <FormInput
                value={contributions[fund.id] ?? ''}
                onChangeText={(text) => setContributions((prev) => ({ ...prev, [fund.id]: text }))}
                keyboardType="decimal-pad"
                placeholder="0"
                style={styles.limitInput}
              />
              <Text style={styles.lineName} numberOfLines={1}>
                {fund.name}
              </Text>
            </View>
          ))}
        </>
      )}

      <Text style={styles.hint}>
        «ثابت» للفواتير اللي مبلغها محدد (إيجار، إنترنت)؛ «مرن» هو اللي بيتحسب في «تقدر تصرف بأمان».
      </Text>

      <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} activeOpacity={0.8}>
        <Text style={styles.deleteText}>حذف الخطة</Text>
      </TouchableOpacity>

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

export function unplannedColor(unplanned: number): string {
  if (Math.abs(unplanned) < 0.5) return FinanceColors.income;
  return unplanned > 0 ? FinanceColors.gold : FinanceColors.expense;
}

const styles = StyleSheet.create({
  unplanned: {
    marginTop: 10,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'right',
  },
  bucketTitle: {
    marginTop: 22,
    marginBottom: 6,
    fontSize: 15,
    fontWeight: '700',
    color: Colors.light.text,
    textAlign: 'right',
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  chevron: { fontSize: 18, color: Colors.light.icon },
  lineLimit: { fontSize: 14, fontWeight: '600', color: Colors.light.text, minWidth: 90 },
  kindBadge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1, backgroundColor: Colors.light.icon + '22' },
  kindFixed: { backgroundColor: Colors.light.tint + '22' },
  kindText: { fontSize: 11, fontWeight: '700', color: Colors.light.icon },
  addBtn: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.light.tint,
  },
  addText: { fontSize: 15, fontWeight: '700', color: Colors.light.tint },
  lineName: {
    flex: 1,
    fontSize: 14,
    color: Colors.light.text,
    textAlign: 'right',
  },
  limitInput: {
    width: 100,
    paddingVertical: 8,
  },
  hint: {
    fontSize: 12,
    color: Colors.light.icon,
    textAlign: 'right',
    marginTop: 8,
  },
  deleteBtn: {
    marginTop: 28,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: FinanceColors.expense + '15',
  },
  deleteText: {
    fontSize: 16,
    fontWeight: '700',
    color: FinanceColors.expense,
  },
});
