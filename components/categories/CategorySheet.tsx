import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BUCKET_TITLES } from '@/components/plan/labels';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { FormInput, FormSheet } from '@/components/ui/FormSheet';
import { Segment } from '@/components/ui/Segment';
import { space } from '@/constants/theme';
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

  // Inline copy of the "bucket required" message (the alert stays).
  const [bucketError, setBucketError] = useState(false);

  const inUse = category ? categoryInUse(state, category.id) : false;
  const canDelete = !!category && !category.isDefault && !inUse;

  const handleSave = () => {
    if (kind === 'expense' && !bucket) {
      setBucketError(true);
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
      <FormField label="الاسم">
        <FormInput value={name} onChangeText={setName} placeholder="مثال: جيم" />
      </FormField>

      {!category && (
        <FormField label="مصروف ولا دخل؟">
          <Segment<Category['kind']>
            options={[
              { label: 'مصروف', value: 'expense' },
              { label: 'دخل', value: 'income' },
            ]}
            value={kind}
            onChange={setKind}
          />
        </FormField>
      )}

      {kind === 'expense' && (
        <FormField
          label="النوع"
          helper={category ? 'تغيير النوع بيأثر على كل معاملات البند ده، القديمة والجديدة.' : undefined}
          error={bucketError ? 'اختار نوع البند (أساسيات / رفاهيات / عطاء)' : null}>
          <Segment<ExpenseBucket>
            options={BUCKET_OPTIONS}
            value={bucket}
            onChange={(next) => {
              setBucket(next);
              setBucketError(false);
            }}
          />
        </FormField>
      )}

      {category && (
        <View style={styles.actions}>
          {category.archived && (
            <Button label="استرجاع" variant="secondary" icon="unarchive" block onPress={() => handleArchive(false)} />
          )}
          {!category.archived && !canDelete && (
            <>
              <Button label="أرشفة" variant="secondary" icon="archive" block onPress={() => handleArchive(true)} />
              <AppText variant="caption" color="textSecondary">
                {category.isDefault
                  ? 'البنود الأساسية مينفعش تتحذف، ممكن تأرشفها.'
                  : 'البند مستخدم في معاملات أو خطط أو معاملات متكررة، فبيتأرشف بدل ما يتحذف.'}
              </AppText>
            </>
          )}
          {canDelete && <Button label="احذف البند" variant="destructive" icon="delete-outline" block onPress={handleDelete} />}
        </View>
      )}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  actions: { marginTop: space.xxxl, gap: space.sm },
});
