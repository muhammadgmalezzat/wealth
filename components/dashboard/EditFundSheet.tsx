import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FieldLabel, FormInput, FormSheet } from '@/components/ui/FormSheet';
import { Colors, FinanceColors } from '@/constants/theme';
import { fundAllocated, unassignedEGP, unassignedEGPWithFundCash } from '@/store/selectors';
import type { Fund } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { formatCurrency } from '@/utils/formatters';
import { runAction } from '@/utils/runAction';

interface EditFundSheetProps {
  fund: Fund;
  onClose: () => void;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Edits a fund and its cash allocation. The resulting unassigned money is previewed live;
// the store rejects increases that would push it below zero.
export function EditFundSheet({ fund, onClose }: EditFundSheetProps) {
  const state = useFinanceStore();
  const [name, setName] = useState(fund.name);
  const [target, setTarget] = useState(String(fund.targetAmount));
  const [deadline, setDeadline] = useState(fund.deadline ?? '');
  const [cash, setCash] = useState(String(round2(fundAllocated(state, fund.id))));

  const cashValue = parseFloat(cash);
  const previewEGP = Number.isFinite(cashValue)
    ? unassignedEGPWithFundCash(state, fund.id, cashValue)
    : unassignedEGP(state);

  const handleSave = () => {
    const saved = runAction('تعذّر الحفظ', () =>
      state.editFund(fund.id, {
        name,
        targetAmount: parseFloat(target),
        deadline: deadline.trim() || undefined,
        cashAllocation: cashValue,
      })
    );
    if (saved) onClose();
  };

  return (
    <FormSheet visible title="تعديل الصندوق" onCancel={onClose} onSave={handleSave}>
      <FieldLabel>الاسم</FieldLabel>
      <FormInput value={name} onChangeText={setName} />

      <FieldLabel>المبلغ المستهدف ({fund.currency})</FieldLabel>
      <FormInput value={target} onChangeText={setTarget} keyboardType="decimal-pad" />

      <FieldLabel>الموعد النهائي (YYYY-MM-DD، اختياري)</FieldLabel>
      <FormInput value={deadline} onChangeText={setDeadline} placeholder="2026-12-31" />

      <FieldLabel>المبلغ المخصص نقداً ({fund.currency})</FieldLabel>
      <FormInput value={cash} onChangeText={setCash} keyboardType="decimal-pad" />

      <View style={styles.preview}>
        <Text style={styles.previewLabel}>فلوس بدون وظيفة بعد الحفظ</Text>
        <Text
          style={[
            styles.previewAmount,
            { color: previewEGP < 0 ? FinanceColors.expense : Colors.light.text },
          ]}>
          {formatCurrency(previewEGP, 'EGP')}
        </Text>
      </View>
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  preview: {
    marginTop: 24,
    padding: 14,
    borderRadius: 10,
    backgroundColor: FinanceColors.cardBackground,
    alignItems: 'flex-end',
    gap: 4,
  },
  previewLabel: {
    fontSize: 13,
    color: Colors.light.icon,
  },
  previewAmount: {
    fontSize: 18,
    fontWeight: '700',
  },
});
