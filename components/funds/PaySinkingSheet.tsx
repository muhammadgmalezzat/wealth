import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { Chip, ChipRow } from '@/components/ui/Chip';
import { PastDateField } from '@/components/ui/DateFields';
import { FieldLabel, FormInput, FormSheet } from '@/components/ui/FormSheet';
import { Colors } from '@/constants/theme';
import { fundAllocated, SINKING_CYCLE_MONTHS } from '@/store/selectors';
import type { Fund } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { fromEGP, toEGP } from '@/utils/currency';
import { addMonthsToDate, toDateKey } from '@/utils/dates';
import { currencySymbol, formatCurrency, formatDate } from '@/utils/formatters';
import { parseAmount } from '@/utils/parseAmount';
import { runAction } from '@/utils/runAction';

const round2 = (n: number) => Math.round(n * 100) / 100;

interface PaySinkingSheetProps {
  fund: Fund;
  onClose: () => void;
}

// "اتدفعت": records the bill as an expense, withdraws it from the fund and moves the due
// date to the next cycle — all in one atomic store action.
export function PaySinkingSheet({ fund, onClose }: PaySinkingSheetProps) {
  const state = useFinanceStore();
  const rates = state.settings.exchangeRates;
  const accounts = state.accounts.filter((a) => !a.archived);
  const expenseCategories = state.categories.filter((c) => c.kind === 'expense');
  const lastUsed = state.settings.lastUsed?.expense;

  const [accountId, setAccountId] = useState(
    accounts.find((a) => a.id === lastUsed?.accountId)?.id ?? accounts[0]?.id ?? ''
  );
  const [categoryId, setCategoryId] = useState(
    expenseCategories.find((c) => c.id === lastUsed?.categoryId)?.id ?? ''
  );
  // null = follow the fund's cycle amount converted to the account's currency.
  const [amountText, setAmountText] = useState<string | null>(null);
  const [date, setDate] = useState(toDateKey(new Date()));
  const [note, setNote] = useState('');

  const account = accounts.find((a) => a.id === accountId);
  const defaultAmount = account
    ? round2(fromEGP(toEGP(fund.targetAmount, fund.currency, rates), account.currency, rates))
    : fund.targetAmount;
  const amountValue = amountText ?? String(defaultAmount);
  const nextDue =
    fund.nextDueDate && fund.frequency
      ? addMonthsToDate(fund.nextDueDate, SINKING_CYCLE_MONTHS[fund.frequency])
      : undefined;

  const handleSave = () => {
    const saved = runAction('تعذّر الحفظ', () =>
      state.paySinkingFund({
        fundId: fund.id,
        accountId,
        categoryId,
        amount: parseAmount(amountValue) ?? NaN,
        date,
        ...(note.trim() ? { note: note.trim() } : {}),
      })
    );
    if (saved) onClose();
  };

  return (
    <FormSheet visible title={`دفع ${fund.name}`} onCancel={onClose} onSave={handleSave}>
      <FieldLabel>المبلغ{account ? ` (${currencySymbol(account.currency)})` : ''}</FieldLabel>
      <FormInput value={amountValue} onChangeText={setAmountText} keyboardType="decimal-pad" />

      <FieldLabel>من حساب</FieldLabel>
      <ChipRow>
        {accounts.map((a) => (
          <Chip
            key={a.id}
            label={`${a.name} · ${currencySymbol(a.currency)}`}
            selected={a.id === accountId}
            onPress={() => setAccountId(a.id)}
          />
        ))}
      </ChipRow>

      <FieldLabel>التصنيف</FieldLabel>
      <ChipRow>
        {expenseCategories.map((c) => (
          <Chip key={c.id} label={c.name} selected={c.id === categoryId} onPress={() => setCategoryId(c.id)} />
        ))}
      </ChipRow>

      <FieldLabel>التاريخ</FieldLabel>
      <PastDateField value={date} onChange={setDate} />

      <FieldLabel>ملاحظة (اختياري)</FieldLabel>
      <FormInput value={note} onChangeText={setNote} placeholder={fund.name} />

      <Text style={styles.info}>
        هيتسحب من الصندوق لحد {formatCurrency(fundAllocated(state, fund.id), fund.currency)} نقداً
        {nextDue ? `، والموعد الجاي هيبقى ${formatDate(nextDue)}` : ''}
      </Text>
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  info: {
    marginTop: 20,
    fontSize: 13,
    color: Colors.light.icon,
    textAlign: 'right',
    lineHeight: 20,
  },
});
