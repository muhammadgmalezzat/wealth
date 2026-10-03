import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { Chip, ChipRow } from '@/components/ui/Chip';
import { PastDateField } from '@/components/ui/DateFields';
import { FieldLabel, FormInput, FormSheet } from '@/components/ui/FormSheet';
import { Colors } from '@/constants/theme';
import type { RecurringRule } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { currencySymbol, formatDate } from '@/utils/formatters';
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
    <FormSheet visible title={rule.name} onCancel={onClose} onSave={handleSave} saveLabel="تم">
      <Text style={styles.hint}>مستحق {formatDate(occurrenceDate)}</Text>

      <FieldLabel>
        المبلغ{account ? ` (${currencySymbol(account.currency)})` : ''}
        {rule.variableAmount ? ' — بيتغير، اكتب المبلغ الفعلي' : ''}
      </FieldLabel>
      <FormInput value={amountText} onChangeText={setAmountText} keyboardType="decimal-pad" />

      {crossCurrency && toAccount && (
        <>
          <FieldLabel>المبلغ المستلم ({currencySymbol(toAccount.currency)})</FieldLabel>
          <FormInput value={toAmountText} onChangeText={setToAmountText} keyboardType="decimal-pad" placeholder="بالسعر الحالي" />
        </>
      )}

      <FieldLabel>{rule.kind === 'transfer' ? 'من حساب' : 'الحساب'}</FieldLabel>
      <ChipRow>
        {accounts
          .filter((a) => a.id !== rule.toAccountId)
          .map((a) => (
            <Chip
              key={a.id}
              label={`${a.name} · ${currencySymbol(a.currency)}`}
              selected={a.id === accountId}
              onPress={() => setAccountId(a.id)}
            />
          ))}
      </ChipRow>

      <FieldLabel>التاريخ</FieldLabel>
      <PastDateField value={date} onChange={setDate} />

      <FieldLabel>ملاحظة (اختياري)</FieldLabel>
      <FormInput value={note} onChangeText={setNote} placeholder={rule.name} />
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  hint: {
    fontSize: 13,
    color: Colors.light.icon,
    textAlign: 'right',
  },
});
