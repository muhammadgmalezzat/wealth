import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { FormInput, FormSheet } from '@/components/ui/FormSheet';
import { formatMoney } from '@/components/ui/formatMoney';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Segment } from '@/components/ui/Segment';
import { StatusChip } from '@/components/ui/StatusChip';
import { space } from '@/constants/theme';
import type { LineProgress } from '@/store/planning';
import type { Category, CurrencyCode, ExpenseBucket, PlanLineKind } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { showMessage } from '@/utils/dialogs';
import { currencySymbol } from '@/utils/formatters';
import { parseAmount } from '@/utils/parseAmount';
import { runAction } from '@/utils/runAction';

import { BUCKET_TITLES, KIND_OPTIONS } from './labels';
import { lineSentence, lineState } from './planUi';

interface LineSheetProps {
  category: Category;
  limitText: string;
  kind: PlanLineKind;
  currency: CurrencyCode;
  // This month's progress on the saved line, when there is one.
  progress?: LineProgress;
  onSave: (patch: { limitText: string; kind: PlanLineKind }) => void;
  onRemove: () => void;
  onClose: () => void;
}

const BUCKET_OPTIONS = (Object.keys(BUCKET_TITLES) as ExpenseBucket[]).map((value) => ({
  label: BUCKET_TITLES[value],
  value,
}));

// One plan line: where it stands this month, then limit and fixed/flexible, "نقل لـ" (moves the
// category itself to another bucket right away) and "شيل من الخطة".
export function LineSheet({
  category,
  limitText: initialLimit,
  kind: initialKind,
  currency,
  progress,
  onSave,
  onRemove,
  onClose,
}: LineSheetProps) {
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

  const state = progress && lineState(progress);

  return (
    <FormSheet visible title={category.name} onCancel={onClose} onSave={handleSave}>
      <StatusChip label={initialKind === 'fixed' ? 'ثابت' : 'مرن'} tone="neutral" />

      {progress && (
        <View style={styles.progress}>
          <AppText variant="bodyStrong">
            {formatMoney(progress.spent, currency)} من {formatMoney(progress.limit, currency)}
          </AppText>
          <ProgressBar
            progress={progress.pct}
            height={6}
            tone={state === 'over' ? 'over' : state === 'approaching' ? 'attention' : 'normal'}
          />
          <AppText variant="secondary" color={state === 'over' ? 'danger' : 'textSecondary'}>
            {lineSentence(progress, category.name, currency)}
          </AppText>
        </View>
      )}

      <FormField label={`الحد (${currencySymbol(currency)})`}>
        <FormInput value={limitText} onChangeText={setLimitText} keyboardType="decimal-pad" placeholder="0" />
      </FormField>
      <FormField label="ثابت ولا مرن؟" helper="ثابت: مبلغ محجوز لمصروف معروف. مرن: جزء من المبلغ المتاح للصرف.">
        <Segment<PlanLineKind> options={KIND_OPTIONS} value={kind} onChange={setKind} />
      </FormField>
      <FormField label="نقل لـ" helper="تغيير النوع بيأثر على كل معاملات البند ده، القديمة والجديدة.">
        <Segment<ExpenseBucket> options={BUCKET_OPTIONS} value={bucket} onChange={setBucket} />
      </FormField>

      <View style={styles.remove}>
        <Button label="شيل من الخطة" variant="destructive" icon="remove-circle-outline" block onPress={onRemove} />
      </View>
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  progress: { marginTop: space.lg, gap: space.sm },
  remove: { marginTop: space.xxxl },
});
