import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';

import { FieldLabel, FormInput, FormSheet } from '@/components/ui/FormSheet';
import { Segment } from '@/components/ui/Segment';
import { Colors, FinanceColors } from '@/constants/theme';
import type { Category, CurrencyCode, ExpenseBucket, PlanLineKind } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { showMessage } from '@/utils/dialogs';
import { currencySymbol } from '@/utils/formatters';
import { parseAmount } from '@/utils/parseAmount';
import { runAction } from '@/utils/runAction';

import { BUCKET_TITLES, KIND_OPTIONS } from './labels';

interface LineSheetProps {
  category: Category;
  limitText: string;
  kind: PlanLineKind;
  currency: CurrencyCode;
  onSave: (patch: { limitText: string; kind: PlanLineKind }) => void;
  onRemove: () => void;
  onClose: () => void;
}

const BUCKET_OPTIONS = (Object.keys(BUCKET_TITLES) as ExpenseBucket[]).map((value) => ({
  label: BUCKET_TITLES[value],
  value,
}));

// One plan line in edit mode: limit and fixed/flexible (draft, saved with the plan), and
// "نقل لـ" which moves the category itself to another bucket right away.
export function LineSheet({ category, limitText: initialLimit, kind: initialKind, currency, onSave, onRemove, onClose }: LineSheetProps) {
  const updateCategory = useFinanceStore((s) => s.updateCategory);
  const [limitText, setLimitText] = useState(initialLimit);
  const [kind, setKind] = useState(initialKind);
  const [bucket, setBucket] = useState(category.bucket as ExpenseBucket);

  const handleSave = () => {
    if (parseAmount(limitText, { allowZero: true }) === null) {
      showMessage('تنبيه', 'اكتب حد البند');
      return;
    }
    if (bucket !== category.bucket && !runAction('تعذّر نقل البند', () => updateCategory({ ...category, bucket }))) return;
    onSave({ limitText, kind });
  };

  return (
    <FormSheet visible title={category.name} onCancel={onClose} onSave={handleSave}>
      <FieldLabel>الحد ({currencySymbol(currency)})</FieldLabel>
      <FormInput value={limitText} onChangeText={setLimitText} keyboardType="decimal-pad" placeholder="0" />
      <FieldLabel>ثابت ولا مرن؟</FieldLabel>
      <Segment<PlanLineKind> options={KIND_OPTIONS} value={kind} onChange={setKind} />
      <FieldLabel>نقل لـ</FieldLabel>
      <Segment<ExpenseBucket> options={BUCKET_OPTIONS} value={bucket} onChange={setBucket} />
      <Text style={styles.hint}>تغيير النوع بيأثر على كل معاملات البند ده، القديمة والجديدة</Text>

      <TouchableOpacity style={styles.removeBtn} onPress={onRemove} activeOpacity={0.8}>
        <Text style={styles.removeText}>شيل من الخطة</Text>
      </TouchableOpacity>
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  hint: { marginTop: 8, fontSize: 12, color: Colors.light.icon, textAlign: 'right' },
  removeBtn: {
    marginTop: 28,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: FinanceColors.expense + '15',
  },
  removeText: { fontSize: 16, fontWeight: '700', color: FinanceColors.expense },
});
