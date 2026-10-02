import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { DatePicker } from '@/components/transactions/DatePicker';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { FieldLabel, FormInput, FormSheet } from '@/components/ui/FormSheet';
import { Segment } from '@/components/ui/Segment';
import { Colors, FinanceColors } from '@/constants/theme';
import type { Category, ExpenseBucket, Transaction } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { fromEGP, toEGP } from '@/utils/currency';
import { shiftDate, toDateKey } from '@/utils/dates';
import { confirmAction, showMessage } from '@/utils/dialogs';
import { currencySymbol, formatDate } from '@/utils/formatters';
import { parseAmount } from '@/utils/parseAmount';
import { runAction } from '@/utils/runAction';

type TxType = Transaction['type'];
type FlowType = Exclude<TxType, 'transfer'>;

const BUCKET_LABELS: Record<ExpenseBucket, string> = {
  essentials: 'أساسيات',
  lifestyle: 'رفاهيات',
  giving: 'عطاء',
};

const round2 = (n: number) => Math.round(n * 100) / 100;

interface TransactionSheetProps {
  // Omit to add a new transaction.
  transaction?: Transaction;
  onClose: () => void;
}

// Add / edit sheet for income, expense and transfer transactions. Mount it only while open:
// its form state is initialised from `transaction` (or the remembered defaults) on mount.
export function TransactionSheet({ transaction, onClose }: TransactionSheetProps) {
  const state = useFinanceStore();
  const today = toDateKey(new Date());
  const yesterday = shiftDate(today, -1);
  const lastUsed = state.settings.lastUsed ?? {};

  // Archived accounts are hidden unless the edited transaction already uses them.
  const involvedIds = new Set(
    !transaction
      ? []
      : transaction.type === 'transfer'
        ? [transaction.fromAccountId, transaction.toAccountId]
        : [transaction.accountId]
  );
  const accounts = state.accounts.filter((a) => !a.archived || involvedIds.has(a.id));
  const accountById = (id: string) => accounts.find((a) => a.id === id);
  const validAccount = (id: string | undefined) => (id && accountById(id) ? id : undefined);
  const validCategory = (id: string | undefined, kind: FlowType) =>
    id && state.categories.some((c) => c.id === id && c.kind === kind) ? id : '';

  const flowDefaults = (kind: FlowType) => ({
    accountId: validAccount(lastUsed[kind]?.accountId) ?? accounts[0]?.id ?? '',
    categoryId: validCategory(lastUsed[kind]?.categoryId, kind),
  });
  const transferDefaults = () => {
    const from = validAccount(lastUsed.transfer?.fromAccountId) ?? accounts[0]?.id ?? '';
    const to =
      validAccount(lastUsed.transfer?.toAccountId) ?? accounts.find((a) => a.id !== from)?.id ?? '';
    return { from, to: to === from ? '' : to };
  };

  const initialFlow =
    transaction && transaction.type !== 'transfer'
      ? { accountId: transaction.accountId, categoryId: transaction.categoryId }
      : flowDefaults('expense');
  const initialTransfer =
    transaction?.type === 'transfer'
      ? { from: transaction.fromAccountId, to: transaction.toAccountId }
      : transferDefaults();

  const [type, setType] = useState<TxType>(transaction?.type ?? 'expense');
  const [amountText, setAmountText] = useState(transaction ? String(transaction.amount) : '');
  const [accountId, setAccountId] = useState(initialFlow.accountId);
  const [categoryId, setCategoryId] = useState(initialFlow.categoryId);
  const [fromAccountId, setFromAccountId] = useState(initialTransfer.from);
  const [toAccountId, setToAccountId] = useState(initialTransfer.to);
  // null = follow the converted amount automatically; a string once the user edits it.
  const [toAmountText, setToAmountText] = useState<string | null>(
    transaction?.type === 'transfer' ? String(transaction.toAmount) : null
  );
  const [date, setDate] = useState(transaction?.date ?? today);
  const [note, setNote] = useState(transaction?.note ?? '');
  const [pickerOpen, setPickerOpen] = useState(false);

  const isTransfer = type === 'transfer';
  const fromAccount = accountById(fromAccountId);
  const toAccount = accountById(toAccountId);
  const flowAccount = accountById(accountId);
  const amountCurrency = isTransfer ? fromAccount?.currency : flowAccount?.currency;
  const crossCurrency = isTransfer && !!fromAccount && !!toAccount && fromAccount.currency !== toAccount.currency;

  const amount = parseAmount(amountText);
  const rates = state.settings.exchangeRates;
  const convertedToAmount =
    crossCurrency && amount !== null
      ? round2(fromEGP(toEGP(amount, fromAccount.currency, rates), toAccount.currency, rates))
      : null;
  const toAmountValue = toAmountText ?? (convertedToAmount !== null ? String(convertedToAmount) : '');

  const changeType = (next: TxType) => {
    if (next === type) return;
    setType(next);
    if (next === 'transfer') return;
    // Categories differ per kind: restore the original when switching back while editing,
    // otherwise fall back to the remembered defaults.
    if (transaction && transaction.type === next) {
      setAccountId(transaction.accountId);
      setCategoryId(transaction.categoryId);
    } else {
      const defaults = flowDefaults(next);
      setAccountId(validAccount(accountId) ?? defaults.accountId);
      setCategoryId(defaults.categoryId);
    }
  };

  const handleSave = () => {
    const value = amount ?? NaN; // NaN → the store reports an Arabic "invalid amount" message
    const noteField = note.trim() ? { note: note.trim() } : {};

    if (isTransfer) {
      if (!fromAccountId || !toAccountId) {
        showMessage('تنبيه', 'اختر الحساب المحوَّل منه والمحوَّل إليه');
        return;
      }
      const toAmount = crossCurrency ? (parseAmount(toAmountValue) ?? NaN) : value;
      const fields = { fromAccountId, toAccountId, amount: value, toAmount, date, ...noteField };
      const saved = runAction('تعذّر الحفظ', () =>
        transaction
          ? state.updateTransaction({
              ...fields,
              type: 'transfer',
              id: transaction.id,
              createdAt: transaction.createdAt,
              rateToEGP: transaction.rateToEGP,
            })
          : state.addTransfer(fields)
      );
      if (saved) onClose();
      return;
    }

    if (!flowAccount) {
      showMessage('تنبيه', 'اختر الحساب');
      return;
    }
    if (!categoryId) {
      showMessage('تنبيه', 'اختر التصنيف');
      return;
    }
    const fields = {
      type,
      amount: value,
      currency: flowAccount.currency,
      accountId,
      categoryId,
      date,
      ...noteField,
    };
    const saved = runAction('تعذّر الحفظ', () => {
      if (!transaction) {
        state.addTransaction(fields);
        return;
      }
      // Keep links that the form doesn't edit (recurring rule, liability payment).
      const links =
        transaction.type !== 'transfer'
          ? {
              ...(transaction.recurringRuleId ? { recurringRuleId: transaction.recurringRuleId } : {}),
              ...(transaction.liabilityId && type === 'expense' ? { liabilityId: transaction.liabilityId } : {}),
            }
          : {};
      state.updateTransaction({
        ...fields,
        ...links,
        id: transaction.id,
        createdAt: transaction.createdAt,
        // The store keeps this unless the currency changed.
        rateToEGP: transaction.rateToEGP,
      });
    });
    if (saved) onClose();
  };

  const handleDelete = () => {
    if (!transaction) return;
    confirmAction({
      title: 'حذف المعاملة',
      message: 'هل تريد حذف هذه المعاملة؟',
      confirmText: 'حذف',
      cancelText: 'إلغاء',
      onConfirm: () => {
        if (runAction('تعذّر الحذف', () => state.deleteTransaction(transaction.id))) onClose();
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

  const categoryChips = (categories: Category[]) => (
    <ChipRow>
      {categories.map((c) => (
        <Chip key={c.id} label={c.name} selected={c.id === categoryId} onPress={() => setCategoryId(c.id)} />
      ))}
    </ChipRow>
  );

  const kindCategories = isTransfer ? [] : state.categories.filter((c) => c.kind === type);
  const otherDate = date !== today && date !== yesterday;

  return (
    <FormSheet
      visible
      title={transaction ? 'تعديل المعاملة' : 'معاملة جديدة'}
      onCancel={onClose}
      onSave={handleSave}>
      <Segment<TxType>
        options={[
          { label: 'مصروف', value: 'expense' },
          { label: 'دخل', value: 'income' },
          { label: 'تحويل', value: 'transfer' },
        ]}
        value={type}
        onChange={changeType}
      />

      {/* Amount */}
      <FieldLabel>المبلغ</FieldLabel>
      <View style={styles.amountRow}>
        <FormInput
          value={amountText}
          onChangeText={setAmountText}
          placeholder="0"
          keyboardType="decimal-pad"
          style={styles.amountInput}
        />
        {amountCurrency && <Text style={styles.currency}>{currencySymbol(amountCurrency)}</Text>}
      </View>

      {accounts.length === 0 && (
        <Text style={styles.hint}>أضف حساباً أولاً من شاشة الأصول</Text>
      )}

      {isTransfer ? (
        <>
          <FieldLabel>من حساب</FieldLabel>
          {accountChips(fromAccountId, setFromAccountId, toAccountId)}
          <FieldLabel>إلى حساب</FieldLabel>
          {accountChips(toAccountId, setToAccountId, fromAccountId)}

          {crossCurrency && (
            <>
              <FieldLabel>المبلغ المستلم ({currencySymbol(toAccount.currency)})</FieldLabel>
              <FormInput
                value={toAmountValue}
                onChangeText={setToAmountText}
                placeholder="0"
                keyboardType="decimal-pad"
              />
              <Text style={styles.hint}>محسوب بسعر الصرف الحالي، عدّله لو السعر الفعلي أو الرسوم مختلفة</Text>
            </>
          )}
        </>
      ) : (
        <>
          <FieldLabel>الحساب</FieldLabel>
          {accountChips(accountId, setAccountId)}

          <FieldLabel>التصنيف</FieldLabel>
          {type === 'expense'
            ? (Object.keys(BUCKET_LABELS) as ExpenseBucket[]).map((bucket) => (
                <View key={bucket} style={styles.bucket}>
                  <Text style={styles.bucketTitle}>{BUCKET_LABELS[bucket]}</Text>
                  {categoryChips(kindCategories.filter((c) => c.bucket === bucket))}
                </View>
              ))
            : categoryChips(kindCategories)}
        </>
      )}

      {/* Date */}
      <FieldLabel>التاريخ</FieldLabel>
      <ChipRow>
        <Chip label="النهارده" selected={date === today} onPress={() => setDate(today)} />
        <Chip label="امبارح" selected={date === yesterday} onPress={() => setDate(yesterday)} />
        <Chip
          label={otherDate ? formatDate(date) : 'تاريخ تاني'}
          selected={otherDate}
          onPress={() => setPickerOpen(true)}
        />
      </ChipRow>
      {pickerOpen && <DatePicker value={date} onChange={setDate} onClose={() => setPickerOpen(false)} />}

      {/* Note */}
      <FieldLabel>ملاحظة (اختياري)</FieldLabel>
      <FormInput value={note} onChangeText={setNote} placeholder="مثال: عشاء مع الأصحاب" />

      {transaction && (
        <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} activeOpacity={0.8}>
          <Text style={styles.deleteText}>حذف</Text>
        </TouchableOpacity>
      )}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  amountInput: {
    flex: 1,
    fontSize: 28,
    fontWeight: '700',
    paddingVertical: 10,
  },
  currency: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.light.icon,
  },
  bucket: {
    marginBottom: 10,
    gap: 6,
  },
  bucketTitle: {
    fontSize: 12,
    color: Colors.light.icon,
    textAlign: 'right',
  },
  hint: {
    fontSize: 12,
    color: Colors.light.icon,
    textAlign: 'right',
    marginTop: 6,
  },
  deleteBtn: {
    marginTop: 32,
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
