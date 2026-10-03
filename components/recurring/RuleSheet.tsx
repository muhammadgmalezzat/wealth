import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';

import { Chip, ChipRow } from '@/components/ui/Chip';
import { FutureDateField } from '@/components/ui/DateFields';
import { FieldLabel, FormInput, FormSheet } from '@/components/ui/FormSheet';
import { Segment } from '@/components/ui/Segment';
import { Colors, FinanceColors } from '@/constants/theme';
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

interface RuleSheetProps {
  // Edit an existing rule…
  rule?: RecurringRule;
  // …or start a new one from these values (e.g. "خليها متكررة").
  prefill?: Partial<NewRecurringRule>;
  // Transaction to link as the first occurrence when creating from it.
  linkTransactionId?: string;
  onClose: () => void;
}

// Add / edit a recurring income, expense or transfer.
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

  const accountChips = (selected: string, onSelect: (id: string) => void, disabledId?: string) => (
    <ChipRow>
      {accounts.map((a) => (
        <Chip
          key={a.id}
          label={`${a.name} · ${currencySymbol(a.currency)}`}
          selected={a.id === selected}
          disabled={a.id === disabledId}
          onPress={() => onSelect(a.id)}
        />
      ))}
    </ChipRow>
  );

  const preview =
    startDate && Number.isFinite(interval)
      ? frequencyLabel({ frequency, interval, startDate, ...(Number.isFinite(dayOfMonth) ? { dayOfMonth } : {}) })
      : '';

  return (
    <FormSheet visible title={rule ? 'تعديل المتكرر' : 'معاملة متكررة'} onCancel={onClose} onSave={handleSave}>
      <Segment<RecurringKind>
        options={[
          { label: 'مصروف', value: 'expense' },
          { label: 'دخل', value: 'income' },
          { label: 'تحويل', value: 'transfer' },
        ]}
        value={kind}
        onChange={(next) => {
          setKind(next);
          setCategoryId('');
        }}
      />

      <FieldLabel>الاسم</FieldLabel>
      <FormInput value={name} onChangeText={setName} placeholder="مثال: إيجار" />

      <FieldLabel>المبلغ{account ? ` (${currencySymbol(account.currency)})` : ''}</FieldLabel>
      <FormInput value={amountText} onChangeText={setAmountText} placeholder="0" keyboardType="decimal-pad" />
      <ChipRow>
        <Chip label="المبلغ بيتغير" selected={variableAmount} onPress={() => setVariableAmount((v) => !v)} />
      </ChipRow>

      <FieldLabel>{kind === 'transfer' ? 'من حساب' : 'الحساب'}</FieldLabel>
      {accountChips(accountId, setAccountId, kind === 'transfer' ? toAccountId : undefined)}

      {kind === 'transfer' ? (
        <>
          <FieldLabel>إلى حساب</FieldLabel>
          {accountChips(toAccountId, setToAccountId, accountId)}
          {crossCurrency && (
            <>
              <FieldLabel>المبلغ المستلم ({currencySymbol(toAccount.currency)})</FieldLabel>
              <FormInput value={toAmountText} onChangeText={setToAmountText} placeholder="0" keyboardType="decimal-pad" />
            </>
          )}
        </>
      ) : (
        <>
          <FieldLabel>التصنيف</FieldLabel>
          <ChipRow>
            {categories.map((c) => (
              <Chip key={c.id} label={c.name} selected={c.id === categoryId} onPress={() => setCategoryId(c.id)} />
            ))}
          </ChipRow>
        </>
      )}

      <FieldLabel>التكرار</FieldLabel>
      <Segment<RecurringFrequency>
        options={[
          { label: 'شهري', value: 'monthly' },
          { label: 'أسبوعي', value: 'weekly' },
          { label: 'سنوي', value: 'yearly' },
        ]}
        value={frequency}
        onChange={setFrequency}
      />
      <FieldLabel>كل كام {frequency === 'weekly' ? 'أسبوع' : frequency === 'yearly' ? 'سنة' : 'شهر'}</FieldLabel>
      <FormInput value={intervalText} onChangeText={setIntervalText} keyboardType="number-pad" />
      {frequency !== 'weekly' && (
        <>
          <FieldLabel>يوم الشهر (لو الشهر أقصر بيتسجل آخر يوم)</FieldLabel>
          <FormInput value={dayText} onChangeText={setDayText} keyboardType="number-pad" />
        </>
      )}
      {preview ? <Text style={styles.preview}>{preview}</Text> : null}

      <FieldLabel>تاريخ البداية</FieldLabel>
      <FutureDateField value={startDate} onChange={setStartDate} />
      <FieldLabel>تاريخ النهاية</FieldLabel>
      <FutureDateField value={endDate} onChange={setEndDate} clearLabel="بدون نهاية" />

      <FieldLabel>طريقة التسجيل</FieldLabel>
      <Segment<RecurringRule['mode']>
        options={[
          { label: 'بتأكيد', value: 'confirm' },
          { label: 'تلقائي', value: 'auto' },
        ]}
        value={mode}
        onChange={setMode}
      />
      <Text style={styles.hint}>
        {mode === 'auto'
          ? 'بتتسجل لوحدها في ميعادها.'
          : 'بتظهر في «المستحقات» وأنت تأكدها أو تتخطاها.'}
      </Text>

      <FieldLabel>ملاحظة (اختياري)</FieldLabel>
      <FormInput value={note} onChangeText={setNote} />

      {rule && (
        <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} activeOpacity={0.8}>
          <Text style={styles.deleteText}>حذف المتكرر</Text>
        </TouchableOpacity>
      )}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  preview: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: '600',
    color: Colors.light.tint,
    textAlign: 'right',
  },
  hint: {
    marginTop: 6,
    fontSize: 12,
    color: Colors.light.icon,
    textAlign: 'right',
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
