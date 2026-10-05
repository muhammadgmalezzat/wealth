import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { AccountPicker } from '@/components/transactions/AccountPicker';
import { CategoryPicker } from '@/components/transactions/CategoryPicker';
import { AmountInput } from '@/components/ui/AmountInput';
import { AppText } from '@/components/ui/AppText';
import { PastDateField } from '@/components/ui/DateFields';
import { FormField } from '@/components/ui/FormField';
import { FormInput, FormSheet } from '@/components/ui/FormSheet';
import { formatDateAr } from '@/components/ui/formatDateAr';
import { formatMoney } from '@/components/ui/formatMoney';
import { space } from '@/constants/theme';
import { fundAllocated, pickerCategories, SINKING_CYCLE_MONTHS } from '@/store/selectors';
import type { Fund } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { fromEGP, toEGP } from '@/utils/currency';
import { addMonthsToDate, toDateKey } from '@/utils/dates';
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
  const expenseCategories = pickerCategories(state.categories, 'expense');
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
      <AmountInput
        value={amountValue}
        onChangeText={setAmountText}
        currency={account?.currency ?? fund.currency}
        accessibilityLabel="المبلغ"
      />

      <AccountPicker label="من" accounts={accounts} selectedId={accountId} onSelect={setAccountId} />

      <CategoryPicker
        categories={expenseCategories}
        selectedId={categoryId}
        lastUsedId={lastUsed?.categoryId}
        onSelect={setCategoryId}
      />

      <FormField label="التاريخ">
        <PastDateField value={date} onChange={setDate} />
      </FormField>

      <FormField label="ملاحظة (اختياري)">
        <FormInput value={note} onChangeText={setNote} placeholder={fund.name} />
      </FormField>

      <AppText variant="secondary" color="textSecondary" style={styles.info}>
        هيتسحب من الصندوق لحد {formatMoney(fundAllocated(state, fund.id), fund.currency)} نقداً
        {nextDue ? `، والموعد الجاي هيبقى ${formatDateAr(nextDue)}` : ''}.
      </AppText>
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  info: { marginTop: space.xl },
});
