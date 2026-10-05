import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AmountInput } from '@/components/ui/AmountInput';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { FormInput, FormSheet } from '@/components/ui/FormSheet';
import { Segment } from '@/components/ui/Segment';
import { space } from '@/constants/theme';
import { accountBalance, openingBalanceForCurrentBalance } from '@/store/selectors';
import type { Account, Location } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { confirmAction } from '@/utils/dialogs';
import { runAction } from '@/utils/runAction';

interface EditAccountSheetProps {
  account: Account;
  onClose: () => void;
}

// Edits an account's name, location and current balance. The balance is derived, so saving
// solves for the openingBalance that makes it equal what the user typed. Delete (refused while
// the account has transactions) and archive / restore (existing updateAccount) live here too.
export function EditAccountSheet({ account, onClose }: EditAccountSheetProps) {
  const state = useFinanceStore();
  const [name, setName] = useState(account.name);
  const [location, setLocation] = useState<Location>(account.location);
  const [balance, setBalance] = useState(String(Math.round(accountBalance(state, account.id) * 100) / 100));

  const handleSave = () => {
    const saved = runAction('تعذّر الحفظ', () =>
      state.updateAccount({
        ...account,
        name: name.trim(),
        location,
        openingBalance: openingBalanceForCurrentBalance(state, account.id, parseFloat(balance)),
      })
    );
    if (saved) onClose();
  };

  // Archive hides the account from pickers (it stays in history and in the "مؤرشفة" group).
  const toggleArchived = () => {
    if (runAction('تعذّر الحفظ', () => state.updateAccount({ ...account, archived: !account.archived }))) onClose();
  };

  const handleDelete = () =>
    confirmAction({
      title: 'حذف الأصل',
      message: `هل تريد حذف "${account.name}"؟`,
      confirmText: 'حذف',
      cancelText: 'إلغاء',
      onConfirm: () => {
        if (runAction('تعذّر الحذف', () => state.deleteAccount(account.id))) onClose();
      },
    });

  return (
    <FormSheet visible title="تعديل الحساب" onCancel={onClose} onSave={handleSave}>
      <FormField label="الاسم">
        <FormInput value={name} onChangeText={setName} />
      </FormField>
      <FormField label="المكان">
        <Segment<Location>
          options={[
            { label: 'مصر', value: 'EG' },
            { label: 'السعودية', value: 'SA' },
          ]}
          value={location}
          onChange={setLocation}
        />
      </FormField>
      <FormField label="الرصيد الحالي" helper="اكتب الرصيد اللي في إيدك فعلاً؛ المعاملات مش بتتغير.">
        <AmountInput value={balance} onChangeText={setBalance} currency={account.currency} allowZero accessibilityLabel="الرصيد الحالي" />
      </FormField>
      <View style={styles.actions}>
        <Button
          label={account.archived ? 'استرجاع الحساب' : 'أرشفة الحساب'}
          variant="secondary"
          icon={account.archived ? 'unarchive' : 'archive'}
          block
          onPress={toggleArchived}
        />
        <Button label="احذف الحساب" variant="destructive" icon="delete-outline" block onPress={handleDelete} />
      </View>
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  actions: { marginTop: space.xxxl, gap: space.sm },
});
