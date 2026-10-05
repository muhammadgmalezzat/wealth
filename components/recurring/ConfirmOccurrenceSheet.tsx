import { useState } from 'react';

import { AccountPicker } from '@/components/transactions/AccountPicker';
import { AmountInput } from '@/components/ui/AmountInput';
import { AppText } from '@/components/ui/AppText';
import { PastDateField } from '@/components/ui/DateFields';
import { FormField } from '@/components/ui/FormField';
import { FormInput, FormSheet } from '@/components/ui/FormSheet';
import { formatDateAr } from '@/components/ui/formatDateAr';
import type { RecurringRule } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { currencySymbol } from '@/utils/formatters';
import { parseAmount } from '@/utils/parseAmount';
import { runAction } from '@/utils/runAction';

interface ConfirmOccurrenceSheetProps {
  rule: RecurringRule;
  occurrenceDate: string;
  onClose: () => void;
}

// "تم": records one due occurrence. Amount, date, account and note are prefilled from the rule
// and can be changed (the amount is a guess for variable bills).
export function ConfirmOccurrenceSheet({ rule, occurrenceDate, onClose }: ConfirmOccurrenceSheetProps) {
  const state = useFinanceStore();
  const accounts = state.accounts.filter((a) => !a.archived || a.id === rule.accountId);
  const [amountText, setAmountText] = useState(String(rule.amount));
  const [toAmountText, setToAmountText] = useState(rule.toAmount ? String(rule.toAmount) : '');
  const [date, setDate] = useState(occurrenceDate);
  const [accountId, setAccountId] = useState(rule.accountId);
  const [note, setNote] = useState(rule.note ?? '');

  const account = accounts.find((a) => a.id === accountId);
  const toAccount = state.accounts.find((a) => a.id === rule.toAccountId);
  const crossCurrency = rule.kind === 'transfer' && !!account && !!toAccount && account.currency !== toAccount.currency;

  const handleSave = () => {
    const saved = runAction('تعذّر التسجيل', () =>
      state.confirmOccurrence(rule.id, occurrenceDate, {
        amount: parseAmount(amountText) ?? NaN,
        date,
        accountId,
        ...(crossCurrency && toAmountText.trim() ? { toAmount: parseAmount(toAmountText) ?? NaN } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      })
    );
    if (saved) onClose();
  };

  return (
    <FormSheet visible title={rule.name} onCancel={onClose} onSave={handleSave} saveLabel="سجّل">
      <AppText variant="secondary" color="textSecondary">
        مستحق {formatDateAr(occurrenceDate)}
      </AppText>

      <AmountInput
        value={amountText}
        onChangeText={setAmountText}
        currency={account?.currency ?? rule.currency}
        hint={rule.variableAmount ? { tone: 'neutral', icon: 'edit', text: 'المبلغ بيتغير: اكتب المبلغ الفعلي' } : undefined}
      />

      {crossCurrency && toAccount && (
        <FormField label={`المبلغ المستلم (${currencySymbol(toAccount.currency)})`}>
          <FormInput value={toAmountText} onChangeText={setToAmountText} keyboardType="decimal-pad" placeholder="بالسعر الحالي" />
        </FormField>
      )}

      <AccountPicker
        label={rule.kind === 'transfer' ? 'من' : rule.kind === 'income' ? 'في' : 'من'}
        accounts={accounts.filter((a) => a.id !== rule.toAccountId)}
        selectedId={accountId}
        onSelect={setAccountId}
      />

      <FormField label="التاريخ">
        <PastDateField value={date} onChange={setDate} />
      </FormField>

      <FormField label="ملاحظة (اختياري)">
        <FormInput value={note} onChangeText={setNote} placeholder={rule.name} />
      </FormField>
    </FormSheet>
  );
}
