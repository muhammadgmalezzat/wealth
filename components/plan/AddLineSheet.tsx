import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { CategoryPicker } from '@/components/transactions/CategoryPicker';
import { AmountInput } from '@/components/ui/AmountInput';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { FormInput, FormSheet } from '@/components/ui/FormSheet';
import { Segment } from '@/components/ui/Segment';
import { space } from '@/constants/theme';
import { FIXED_CATEGORY_IDS } from '@/store/defaultCategories';
import { pickerCategories } from '@/store/selectors';
import type { CurrencyCode, ExpenseBucket, PlanLineKind } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { fromEGP, toEGP } from '@/utils/currency';
import { showMessage } from '@/utils/dialogs';
import { parseAmount } from '@/utils/parseAmount';
import { runAction } from '@/utils/runAction';

import { BUCKET_TITLES, KIND_OPTIONS } from './labels';

export interface AddedLine {
  categoryId: string;
  limitText: string;
  kind: PlanLineKind;
}

interface AddLineSheetProps {
  month: string;
  // The editor's (draft) currency; limits are typed in it.
  currency: CurrencyCode;
  // Categories already in the draft plan.
  usedIds: string[];
  onAdd: (line: AddedLine) => void;
  onManage: () => void;
  onClose: () => void;
}

type Tab = 'existing' | 'new';

const BUCKET_OPTIONS = (Object.keys(BUCKET_TITLES) as ExpenseBucket[]).map((value) => ({
  label: BUCKET_TITLES[value],
  value,
}));

// "أضف بند": pick an existing expense category ("من الموجود") or create one ("بند جديد").
// A new category is created and added to the saved plan in one store action.
export function AddLineSheet({ month, currency, usedIds, onAdd, onManage, onClose }: AddLineSheetProps) {
  const state = useFinanceStore();
  const [tab, setTab] = useState<Tab>('existing');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [bucket, setBucket] = useState<ExpenseBucket | undefined>(undefined);
  const [kind, setKind] = useState<PlanLineKind>('flexible');
  const [limitText, setLimitText] = useState('');

  const query = search.trim().toLocaleLowerCase();
  const available = pickerCategories(state.categories, 'expense').filter(
    (c) => !usedIds.includes(c.id) && (!query || c.name.toLocaleLowerCase().includes(query))
  );

  const select = (id: string) => {
    setSelectedId(id);
    setKind(FIXED_CATEGORY_IDS.includes(id) ? 'fixed' : 'flexible');
  };

  const handleSave = () => {
    const limit = parseAmount(limitText, { allowZero: true });
    if (limit === null) {
      showMessage('تنبيه', 'اكتب حد البند');
      return;
    }
    if (tab === 'existing') {
      if (!selectedId) {
        showMessage('تنبيه', 'اختار بند');
        return;
      }
      onAdd({ categoryId: selectedId, limitText, kind });
      return;
    }
    if (!bucket) {
      showMessage('تنبيه', 'اختار نوع البند (أساسيات / رفاهيات / عطاء)');
      return;
    }
    // The saved plan may still be in another currency than the draft.
    const planCurrency = state.monthlyPlans.find((p) => p.month === month)?.currency ?? currency;
    const rates = state.settings.exchangeRates;
    const savedLimit = planCurrency === currency ? limit : fromEGP(toEGP(limit, currency, rates), planCurrency, rates);
    let categoryId = '';
    const ok = runAction('تعذّر إضافة البند', () => {
      categoryId = state.addCategoryWithPlanLine({ name, bucket }, { month, limit: savedLimit, kind });
    });
    if (ok) onAdd({ categoryId, limitText, kind });
  };

  const limitFields = (
    <>
      <AmountInput value={limitText} onChangeText={setLimitText} currency={currency} allowZero accessibilityLabel="حد البند" />
      <FormField label="ثابت ولا مرن؟" helper="ثابت: مبلغ محجوز لمصروف معروف. مرن: جزء من المبلغ المتاح للصرف.">
        <Segment<PlanLineKind> options={KIND_OPTIONS} value={kind} onChange={setKind} />
      </FormField>
    </>
  );

  return (
    <FormSheet visible title="أضف بند" saveLabel="إضافة" onCancel={onClose} onSave={handleSave}>
      <Segment<Tab>
        options={[
          { label: 'من الموجود', value: 'existing' },
          { label: 'بند جديد', value: 'new' },
        ]}
        value={tab}
        onChange={(next) => {
          setTab(next);
          setKind(next === 'existing' && selectedId && FIXED_CATEGORY_IDS.includes(selectedId) ? 'fixed' : 'flexible');
        }}
      />

      {tab === 'existing' ? (
        <>
          <FormInput value={search} onChangeText={setSearch} placeholder="دوّر على بند…" style={styles.search} />
          {available.length === 0 ? (
            <AppText variant="secondary" color="textSecondary" style={styles.hint}>
              مفيش بنود تانية؛ اعمل «بند جديد».
            </AppText>
          ) : (
            <CategoryPicker
              categories={available}
              selectedId={selectedId ?? ''}
              onSelect={select}
              forceExpanded={query !== ''}
              label={null}
            />
          )}
          {selectedId && limitFields}
        </>
      ) : (
        <>
          <FormField label="اسم البند">
            <FormInput value={name} onChangeText={setName} placeholder="مثال: جيم" />
          </FormField>
          <FormField label="النوع">
            <Segment<ExpenseBucket> options={BUCKET_OPTIONS} value={bucket} onChange={setBucket} />
          </FormField>
          {limitFields}
        </>
      )}

      <View style={styles.manage}>
        <Button label="إدارة البنود" variant="tertiary" icon="tune" onPress={onManage} />
      </View>
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  search: { marginTop: space.lg },
  hint: { marginTop: space.md },
  manage: { marginTop: space.xxl, alignItems: 'center' },
});
