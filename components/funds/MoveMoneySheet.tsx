import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AmountInput } from '@/components/ui/AmountInput';
import { FormField } from '@/components/ui/FormField';
import { FormInput, FormSheet } from '@/components/ui/FormSheet';
import { formatMoney } from '@/components/ui/formatMoney';
import { Segment } from '@/components/ui/Segment';
import { space } from '@/constants/theme';
import { fundAllocated, unassignedEGP } from '@/store/selectors';
import type { Fund } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { fromEGP } from '@/utils/currency';
import { parseAmount } from '@/utils/parseAmount';
import { runAction } from '@/utils/runAction';

type Mode = 'allocate' | 'withdraw';

interface MoveMoneySheetProps {
  fund: Fund;
  // The side the sheet opens on; the segment can switch it.
  mode: Mode;
  onClose: () => void;
}

// Adds unassigned money to a fund ("إضافة") or returns fund cash to unassigned ("سحب").
export function MoveMoneySheet({ fund, mode: initialMode, onClose }: MoveMoneySheetProps) {
  const state = useFinanceStore();
  const [mode, setMode] = useState<Mode>(initialMode);
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
    <FormSheet visible title={fund.name} onCancel={onClose} onSave={handleSave}>
      <Segment<Mode>
        options={[
          { label: 'إضافة', value: 'allocate' },
          { label: 'سحب', value: 'withdraw' },
        ]}
        value={mode}
        onChange={setMode}
      />
      <AmountInput
        value={amountText}
        onChangeText={setAmountText}
        currency={fund.currency}
        autoFocus
        hint={{
          tone: 'neutral',
          text: `${mode === 'allocate' ? 'المتاح للتخطيط' : 'في الصندوق نقداً'}: ${formatMoney(available, fund.currency)}`,
        }}
      />
      <View style={styles.note}>
        <FormField label="ملاحظة (اختياري)">
          <FormInput value={note} onChangeText={setNote} />
        </FormField>
      </View>
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  note: { marginTop: space.sm },
});
