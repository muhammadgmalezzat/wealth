import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { FieldLabel, FormInput, FormSheet } from '@/components/ui/FormSheet';
import { Colors } from '@/constants/theme';
import { fundAllocated, unassignedEGP } from '@/store/selectors';
import type { Fund } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { fromEGP } from '@/utils/currency';
import { formatCurrency } from '@/utils/formatters';
import { parseAmount } from '@/utils/parseAmount';
import { runAction } from '@/utils/runAction';

interface MoveMoneySheetProps {
  fund: Fund;
  mode: 'allocate' | 'withdraw';
  onClose: () => void;
}

// Adds unassigned money to a fund ("إضافة") or returns fund cash to unassigned ("سحب").
export function MoveMoneySheet({ fund, mode, onClose }: MoveMoneySheetProps) {
  const state = useFinanceStore();
  const [amountText, setAmountText] = useState('');
  const [note, setNote] = useState('');

  const available =
    mode === 'allocate'
      ? Math.max(0, fromEGP(unassignedEGP(state), fund.currency, state.settings.exchangeRates))
      : fundAllocated(state, fund.id);

  const handleSave = () => {
    const amount = parseAmount(amountText) ?? NaN;
    const trimmed = note.trim() || undefined;
    const saved = runAction('تعذّر الحفظ', () =>
      mode === 'allocate'
        ? // allocateMany enforces that the money is actually unassigned.
          state.allocateMany([{ fundId: fund.id, amount }], trimmed)
        : state.withdrawFromFund(fund.id, amount, trimmed)
    );
    if (saved) onClose();
  };

  return (
    <FormSheet
      visible
      title={mode === 'allocate' ? `إضافة إلى ${fund.name}` : `سحب من ${fund.name}`}
      onCancel={onClose}
      onSave={handleSave}>
      <Text style={styles.available}>
        {mode === 'allocate' ? 'متاح بدون وظيفة' : 'في الصندوق نقداً'}: {formatCurrency(available, fund.currency)}
      </Text>
      <FieldLabel>المبلغ ({fund.currency})</FieldLabel>
      <FormInput value={amountText} onChangeText={setAmountText} placeholder="0" keyboardType="decimal-pad" />
      <FieldLabel>ملاحظة (اختياري)</FieldLabel>
      <FormInput value={note} onChangeText={setNote} />
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  available: {
    fontSize: 13,
    color: Colors.light.icon,
    textAlign: 'right',
  },
});
