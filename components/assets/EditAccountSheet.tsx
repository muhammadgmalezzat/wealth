import { useState } from 'react';

import { FieldLabel, FormInput, FormSheet } from '@/components/ui/FormSheet';
import { accountBalance, openingBalanceForCurrentBalance } from '@/store/selectors';
import type { Account } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { runAction } from '@/utils/runAction';

interface EditAccountSheetProps {
  account: Account;
  onClose: () => void;
}

// Edits an account's name and current balance. The balance is derived, so saving solves
// for the openingBalance that makes it equal what the user typed.
export function EditAccountSheet({ account, onClose }: EditAccountSheetProps) {
  const state = useFinanceStore();
  const [name, setName] = useState(account.name);
  const [balance, setBalance] = useState(
    String(Math.round(accountBalance(state, account.id) * 100) / 100)
  );

  const handleSave = () => {
    const saved = runAction('تعذّر الحفظ', () =>
      state.updateAccount({
        ...account,
        name: name.trim(),
        openingBalance: openingBalanceForCurrentBalance(state, account.id, parseFloat(balance)),
      })
    );
    if (saved) onClose();
  };

  return (
    <FormSheet visible title="تعديل الحساب" onCancel={onClose} onSave={handleSave}>
      <FieldLabel>الاسم</FieldLabel>
      <FormInput value={name} onChangeText={setName} />

      <FieldLabel>الرصيد الحالي ({account.currency})</FieldLabel>
      <FormInput value={balance} onChangeText={setBalance} keyboardType="decimal-pad" />
    </FormSheet>
  );
}
