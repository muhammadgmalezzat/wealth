import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { AccountPicker } from '@/components/transactions/AccountPicker';
import { CategoryPicker } from '@/components/transactions/CategoryPicker';
import { MoreDetails } from '@/components/transactions/MoreDetails';
import { AmountInput } from '@/components/ui/AmountInput';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { FutureDateField } from '@/components/ui/DateFields';
import { FormField } from '@/components/ui/FormField';
import { FormInput, FormSheet } from '@/components/ui/FormSheet';
import { Segment } from '@/components/ui/Segment';
import { colors, space } from '@/constants/theme';
import type { NewRecurringRule } from '@/store/operations';
import { pickerCategories } from '@/store/selectors';
import type { RecurringFrequency, RecurringKind, RecurringRule } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { fromDateKey, toDateKey } from '@/utils/dates';
import { confirmAction, showMessage } from '@/utils/dialogs';
import { currencySymbol } from '@/utils/formatters';
import { parseAmount } from '@/utils/parseAmount';
import { runAction } from '@/utils/runAction';

import { frequencyLabel } from './labels';
import { ruleDetailsOpen } from './recurringUi';

interface RuleSheetProps {
  // Edit an existing rule…
  rule?: RecurringRule;
  // …or start a new one from these values (e.g. "خليها متكررة").
  prefill?: Partial<NewRecurringRule>;
  // Transaction to link as the first occurrence when creating from it.
  linkTransactionId?: string;
  onClose: () => void;
}

// Add / edit a recurring income, expense or transfer. Order: kind · amount (+ "المبلغ بيتغير") ·
// name · category + account (or from / to) · frequency (+ interval, day of month) · start date ·
// mode; "تفاصيل أكتر": end date, note (open when the edited rule uses them) · delete.
export function RuleSheet({ rule, prefill, linkTransactionId, onClose }: RuleSheetProps) {
  const state = useFinanceStore();
  const accounts = state.accounts.filter((a) => !a.archived || a.id === rule?.accountId || a.id === rule?.toAccountId);
  const initial = rule ?? prefill ?? {};
  const today = toDateKey(new Date());

  const [kind, setKind] = useState<RecurringKind>(initial.kind ?? 'expense');
  const [name, setName] = useState(initial.name ?? '');
  const [amountText, setAmountText] = useState(initial.amount ? String(initial.amount) : '');
  const [accountId, setAccountId] = useState(initial.accountId ?? accounts[0]?.id ?? '');
  const [categoryId, setCategoryId] = useState(initial.categoryId ?? '');
  const [toAccountId, setToAccountId] = useState(initial.toAccountId ?? '');
  const [toAmountText, setToAmountText] = useState(initial.toAmount ? String(initial.toAmount) : '');
  const [frequency, setFrequency] = useState<RecurringFrequency>(initial.frequency ?? 'monthly');
  const [intervalText, setIntervalText] = useState(String(initial.interval ?? 1));
  const [startDate, setStartDate] = useState<string | undefined>(initial.startDate ?? today);
  const [dayText, setDayText] = useState(
    String(initial.dayOfMonth ?? fromDateKey(initial.startDate ?? today).getDate())
  );
  const [endDate, setEndDate] = useState<string | undefined>(initial.endDate);
  const [mode, setMode] = useState<RecurringRule['mode']>(initial.mode ?? 'confirm');
  const [variableAmount, setVariableAmount] = useState(initial.variableAmount ?? false);
  const [note, setNote] = useState(initial.note ?? '');

  const account = accounts.find((a) => a.id === accountId);
  const toAccount = accounts.find((a) => a.id === toAccountId);
  const crossCurrency = kind === 'transfer' && !!account && !!toAccount && account.currency !== toAccount.currency;
  const categories = kind === 'transfer' ? [] : pickerCategories(state.categories, kind, [rule?.categoryId]);
  const interval = parseAmount(intervalText) ?? NaN;
  const dayOfMonth = parseAmount(dayText) ?? NaN;

  const input = (): NewRecurringRule | null => {
    if (!account) {
      showMessage('تنبيه', 'اختر الحساب');
      return null;
    }
    if (!startDate) {
      showMessage('تنبيه', 'اختر تاريخ البداية');
      return null;
    }
    return {
      name: name.trim() || (kind === 'transfer' ? 'تحويل' : (categories.find((c) => c.id === categoryId)?.name ?? '')),
      kind,
      amount: parseAmount(amountText) ?? NaN,
      currency: account.currency,
      accountId,
      ...(kind === 'transfer'
        ? { toAccountId, ...(crossCurrency ? { toAmount: parseAmount(toAmountText) ?? NaN } : {}) }
        : { categoryId }),
      frequency,
      interval,
      ...(frequency !== 'weekly' ? { dayOfMonth } : {}),
      startDate,
      ...(endDate ? { endDate } : {}),
      mode,
      variableAmount,
      active: rule?.active ?? true,
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(rule ? { skippedDates: rule.skippedDates } : {}),
    };
  };

  const handleSave = () => {
    const value = input();
    if (!value) return;
    const saved = runAction('تعذّر الحفظ', () =>
      rule
        ? state.updateRecurringRule({ ...value, id: rule.id, createdAt: rule.createdAt, nextDate: rule.nextDate, skippedDates: rule.skippedDates })
        : state.addRecurringRule(value, linkTransactionId)
    );
    if (saved) onClose();
  };

  const handleDelete = () => {
    if (!rule) return;
    confirmAction({
      title: 'حذف المعاملة المتكررة',
      message: 'المعاملات اللي اتسجلت منها قبل كده هتفضل زي ما هي.',
      confirmText: 'حذف',
      cancelText: 'إلغاء',
      onConfirm: () => {
        if (runAction('تعذّر الحذف', () => state.deleteRecurringRule(rule.id))) onClose();
      },
    });
  };

  const preview =
    startDate && Number.isFinite(interval)
      ? frequencyLabel({ frequency, interval, startDate, ...(Number.isFinite(dayOfMonth) ? { dayOfMonth } : {}) })
      : '';

  return (
    <FormSheet visible title={rule ? 'تعديل المتكرر' : 'معاملة متكررة'} onCancel={onClose} onSave={handleSave}>
      <Segment<RecurringKind>
        options={[
          { label: 'دخل', value: 'income' },
          { label: 'مصروف', value: 'expense' },
          { label: 'تحويل', value: 'transfer' },
        ]}
        value={kind}
        onChange={(next) => {
          setKind(next);
          setCategoryId('');
        }}
      />

      <AmountInput value={amountText} onChangeText={setAmountText} currency={account?.currency ?? 'EGP'} />
      <View style={styles.switchRow}>
        <Switch
          value={variableAmount}
          onValueChange={setVariableAmount}
          trackColor={{ true: colors.primary600, false: colors.borderStrong }}
          thumbColor={colors.surface}
          accessibilityLabel="المبلغ بيتغير"
        />
        <View style={styles.flex}>
          <AppText variant="bodyStrong">المبلغ بيتغير</AppText>
          <AppText variant="caption" color="textSecondary">
            زي فاتورة الكهربا: المبلغ ده تقريبي، وبتكتب الفعلي لما تأكده.
          </AppText>
        </View>
      </View>

      <FormField label="الاسم">
        <FormInput value={name} onChangeText={setName} placeholder="مثال: إيجار" />
      </FormField>

      {kind === 'transfer' ? (
        <>
          <AccountPicker label="من" accounts={accounts} selectedId={accountId} disabledId={toAccountId} onSelect={setAccountId} />
          <AccountPicker label="إلى" accounts={accounts} selectedId={toAccountId} disabledId={accountId} onSelect={setToAccountId} />
          {/* Required when the currencies differ, so it stays in the main flow. */}
          {crossCurrency && (
            <FormField label={`المبلغ المستلم (${currencySymbol(toAccount.currency)})`}>
              <FormInput value={toAmountText} onChangeText={setToAmountText} placeholder="0" keyboardType="decimal-pad" />
            </FormField>
          )}
        </>
      ) : (
        <>
          <CategoryPicker categories={categories} selectedId={categoryId} onSelect={setCategoryId} />
          <AccountPicker label={kind === 'income' ? 'في' : 'من'} accounts={accounts} selectedId={accountId} onSelect={setAccountId} />
        </>
      )}

      <FormField label="التكرار" helper={preview || undefined}>
        <Segment<RecurringFrequency>
          options={[
            { label: 'أسبوعي', value: 'weekly' },
            { label: 'شهري', value: 'monthly' },
            { label: 'سنوي', value: 'yearly' },
          ]}
          value={frequency}
          onChange={setFrequency}
        />
      </FormField>
      <View style={styles.compact}>
        <View style={styles.flex}>
          <FormField label={`كل كام ${frequency === 'weekly' ? 'أسبوع' : frequency === 'yearly' ? 'سنة' : 'شهر'}`}>
            <FormInput value={intervalText} onChangeText={setIntervalText} keyboardType="number-pad" />
          </FormField>
        </View>
        {frequency !== 'weekly' && (
          <View style={styles.flex}>
            <FormField label="يوم الشهر" helper="لو الشهر أقصر: آخر يوم">
              <FormInput value={dayText} onChangeText={setDayText} keyboardType="number-pad" />
            </FormField>
          </View>
        )}
      </View>

      <FormField label="تاريخ البداية">
        <FutureDateField value={startDate} onChange={setStartDate} />
      </FormField>

      <FormField label="طريقة التسجيل" helper={mode === 'auto' ? 'بيتسجل لوحده في ميعاده.' : 'بيستناك تأكده من المستحقات.'}>
        <Segment<RecurringRule['mode']>
          options={[
            { label: 'تلقائي', value: 'auto' },
            { label: 'بتأكيد', value: 'confirm' },
          ]}
          value={mode}
          onChange={setMode}
        />
      </FormField>

      <MoreDetails initiallyOpen={ruleDetailsOpen(rule)}>
        <FormField label="تاريخ النهاية">
          <FutureDateField value={endDate} onChange={setEndDate} clearLabel="بدون نهاية" />
        </FormField>
        <FormField label="ملاحظة (اختياري)">
          <FormInput value={note} onChangeText={setNote} multiline style={styles.note} />
        </FormField>
      </MoreDetails>

      {rule && (
        <View style={styles.delete}>
          <Button label="احذف المتكرر" variant="destructive" icon="delete-outline" block onPress={handleDelete} />
        </View>
      )}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  // RTL: text on the right, switch on the left.
  switchRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.md },
  flex: { flex: 1 },
  compact: { flexDirection: 'row-reverse', gap: space.md },
  note: { minHeight: 72, textAlignVertical: 'top' },
  delete: { marginTop: space.xxxl },
});
