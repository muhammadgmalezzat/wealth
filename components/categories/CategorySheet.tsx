import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';

import { BUCKET_TITLES } from '@/components/plan/labels';
import { FieldLabel, FormInput, FormSheet } from '@/components/ui/FormSheet';
import { Segment } from '@/components/ui/Segment';
import { Colors, FinanceColors } from '@/constants/theme';
import { categoryInUse } from '@/store/operations';
import type { Category, ExpenseBucket } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { confirmAction, showMessage } from '@/utils/dialogs';
import { runAction } from '@/utils/runAction';

interface CategorySheetProps {
  // Omitted = new category.
  category?: Category;
  onClose: () => void;
}

const BUCKET_OPTIONS = (Object.keys(BUCKET_TITLES) as ExpenseBucket[]).map((value) => ({
  label: BUCKET_TITLES[value],
  value,
}));

// Add / edit a category. Used categories (and defaults) can be archived; only unused custom
// ones can be deleted.
export function CategorySheet({ category, onClose }: CategorySheetProps) {
  const state = useFinanceStore();
  const [name, setName] = useState(category?.name ?? '');
  const [kind, setKind] = useState<Category['kind']>(category?.kind ?? 'expense');
  const [bucket, setBucket] = useState<ExpenseBucket | undefined>(
    category && category.bucket !== 'income' ? (category.bucket as ExpenseBucket) : undefined
  );

  const inUse = category ? categoryInUse(state, category.id) : false;
  const canDelete = !!category && !category.isDefault && !inUse;

  const handleSave = () => {
    if (kind === 'expense' && !bucket) {
      showMessage('تنبيه', 'اختار نوع البند (أساسيات / رفاهيات / عطاء)');
      return;
    }
    const fields = { name, kind, bucket: kind === 'income' ? ('income' as const) : bucket! };
    const ok = category
      ? runAction('تعذّر الحفظ', () => state.updateCategory({ ...category, ...fields }))
      : runAction('تعذّر الإضافة', () => state.addCategory(fields));
    if (ok) onClose();
  };

  const handleArchive = (archived: boolean) => {
    if (!category) return;
    if (!archived) {
      if (runAction('تعذّر الاسترجاع', () => state.archiveCategory(category.id, false))) onClose();
      return;
    }
    confirmAction({
      title: 'أرشفة البند',
      message: 'البند هيختفي من الاختيارات، لكن معاملاته القديمة هتفضل في السجل والتقارير.',
      confirmText: 'أرشفة',
      cancelText: 'إلغاء',
      onConfirm: () => {
        if (runAction('تعذّر الأرشفة', () => state.archiveCategory(category.id, true))) onClose();
      },
    });
  };

  const handleDelete = () => {
    if (!category) return;
    confirmAction({
      title: 'حذف البند',
      message: `هل تريد حذف «${category.name}»؟`,
      confirmText: 'حذف',
      cancelText: 'إلغاء',
      onConfirm: () => {
        if (runAction('تعذّر الحذف', () => state.deleteCategory(category.id))) onClose();
      },
    });
  };

  return (
    <FormSheet visible title={category ? 'تعديل البند' : 'بند جديد'} onCancel={onClose} onSave={handleSave}>
      <FieldLabel>الاسم</FieldLabel>
      <FormInput value={name} onChangeText={setName} placeholder="مثال: جيم" />

      {!category && (
        <>
          <FieldLabel>مصروف ولا دخل؟</FieldLabel>
          <Segment<Category['kind']>
            options={[
              { label: 'مصروف', value: 'expense' },
              { label: 'دخل', value: 'income' },
            ]}
            value={kind}
            onChange={setKind}
          />
        </>
      )}

      {kind === 'expense' && (
        <>
          <FieldLabel>النوع</FieldLabel>
          <Segment<ExpenseBucket> options={BUCKET_OPTIONS} value={bucket} onChange={setBucket} />
          {category && (
            <Text style={styles.hint}>تغيير النوع بيأثر على كل معاملات البند ده، القديمة والجديدة</Text>
          )}
        </>
      )}

      {category?.archived && (
        <TouchableOpacity style={styles.secondaryBtn} onPress={() => handleArchive(false)} activeOpacity={0.8}>
          <Text style={styles.secondaryText}>استرجاع</Text>
        </TouchableOpacity>
      )}
      {category && !category.archived && !canDelete && (
        <>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => handleArchive(true)} activeOpacity={0.8}>
            <Text style={styles.secondaryText}>أرشفة</Text>
          </TouchableOpacity>
          <Text style={styles.hint}>
            {category.isDefault
              ? 'البنود الأساسية مينفعش تتحذف، ممكن تأرشفها.'
              : 'البند مستخدم في معاملات أو خطط أو معاملات متكررة، فبيتأرشف بدل ما يتحذف.'}
          </Text>
        </>
      )}
      {canDelete && (
        <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} activeOpacity={0.8}>
          <Text style={styles.deleteText}>حذف البند</Text>
        </TouchableOpacity>
      )}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  hint: { marginTop: 8, fontSize: 12, color: Colors.light.icon, textAlign: 'right' },
  secondaryBtn: {
    marginTop: 28,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: Colors.light.icon + '18',
  },
  secondaryText: { fontSize: 16, fontWeight: '700', color: Colors.light.text },
  deleteBtn: {
    marginTop: 28,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: FinanceColors.expense + '15',
  },
  deleteText: { fontSize: 16, fontWeight: '700', color: FinanceColors.expense },
});
