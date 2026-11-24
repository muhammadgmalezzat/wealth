import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { TransactionRow } from '@/components/transactions/TransactionRow';
import { AmountInput } from '@/components/ui/AmountInput';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FutureDateField } from '@/components/ui/DateFields';
import { FormField } from '@/components/ui/FormField';
import { FormInput, FormSheet } from '@/components/ui/FormSheet';
import { formatMoney } from '@/components/ui/formatMoney';
import { formatDateAr } from '@/components/ui/formatDateAr';
import { InsightCard } from '@/components/ui/InsightCard';
import { ListGroup } from '@/components/ui/ListRow';
import { MonthSwitcher } from '@/components/ui/MonthSwitcher';
import { Segment } from '@/components/ui/Segment';
import { currencyNameAr } from '@/constants/currencies';
import { space } from '@/constants/theme';
import {
  currencyList,
  duplicateSalaryReceivable,
  receivableCollected,
  receivableCollections,
  receivableRemaining,
  receivableStatus,
} from '@/store/selectors';
import type { CurrencyCode, Receivable, ReceivableKind } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { confirmAction } from '@/utils/dialogs';
import { parseAmount } from '@/utils/parseAmount';
import { runAction } from '@/utils/runAction';

import { amountText, receivableDefaults } from './receivablesUi';

interface ReceivableSheetProps {
  // Omit to add one.
  receivable?: Receivable;
  onClose: () => void;
  // Edit mode: the sheet closes and the screen opens the collect sheet / a collection's transaction sheet.
  onCollect?: (receivable: Receivable) => void;
  onOpenTransaction?: (transactionId: string) => void;
}

// «فلوس ليّا عند حد» / «تعديل: <debtor>»: money owed to the user (a late salary, a loan). Not money until collected. Edit mode
// also shows what was collected and the actions: سجّل تحصيل · اشطبه / رجّعه مفتوح · احذف (only without collections).
export function ReceivableSheet({ receivable, onClose, onCollect, onOpenTransaction }: ReceivableSheetProps) {
  const state = useFinanceStore();
  const defaults = receivableDefaults(state);
  // Explicit checks instead of `receivable?.x`: with the React Compiler on, `receivable?.id` in a call argument was
  // compiled into a plain `receivable.id` and crashed the add sheet (seen in the web check).
  const editing: Receivable | null = receivable ?? null;
  const [kind, setKind] = useState<ReceivableKind>(editing ? editing.kind : 'salary');
  const [label, setLabel] = useState(editing ? editing.label : '');
  const [forMonth, setForMonth] = useState(editing && editing.forMonth ? editing.forMonth : defaults.forMonth);
  const [amountInput, setAmountInput] = useState(editing ? amountText(editing.amount) : '');
  const [currency, setCurrency] = useState<CurrencyCode>(editing ? editing.currency : defaults.currency);
  const [dueDate, setDueDate] = useState<string | undefined>(editing ? editing.dueDate : undefined);
  const [note, setNote] = useState(editing && editing.note ? editing.note : '');

  const collections = receivable ? receivableCollections(state, receivable.id) : [];
  const collected = receivable ? receivableCollected(state, receivable) : 0;
  const status = receivable ? receivableStatus(state, receivable) : 'open';
  const currencyLocked = collections.length > 0;
  // An 'other' receivable may have a month only if it already had one (it keeps it); a new one has none.
  const month = kind === 'salary' ? forMonth : editing && editing.kind === 'other' ? editing.forMonth : undefined;
  const editingId = editing ? editing.id : undefined;
  const duplicate = duplicateSalaryReceivable(state, { label, kind, forMonth: month }, editingId);
  const currencies = currencyList(state);

  const handleSave = () => {
    const fields = {
      label: label.trim(),
      kind,
      amount: parseAmount(amountInput) ?? NaN,
      currency,
      ...(month ? { forMonth: month } : {}),
      ...(dueDate ? { dueDate } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    // Closures only capture `editingId` / `label` (never `receivable.x`): see `editing` above.
    const saved = editingId
      ? runAction('تعذّر الحفظ', () => state.updateReceivable({ ...fields, id: editingId }))
      : runAction('تعذّر الحفظ', () => state.addReceivable(fields));
    if (saved) onClose();
  };

  const writeOff = () =>
    confirmAction({
      title: 'شطب الفلوس دي',
      message: 'هتقفلها من غير ما يتسجّل أي فلوس. اللي اتحصّل فعلاً بيفضل زي ما هو، وتقدر ترجّعها بعدين.',
      confirmText: 'اشطبها',
      cancelText: 'إلغاء',
      onConfirm: () => {
        if (editingId && runAction('تعذّر الشطب', () => state.writeOffReceivable(editingId))) onClose();
      },
    });

  const reopen = () => {
    if (editingId && runAction('تعذّر الحفظ', () => state.reopenReceivable(editingId))) onClose();
  };

  const savedLabel = editing ? editing.label : '';
  const remove = () =>
    confirmAction({
      title: 'حذف الفلوس دي',
      message: `هل تريد حذف «${savedLabel}»؟`,
      confirmText: 'حذف',
      cancelText: 'إلغاء',
      onConfirm: () => {
        if (editingId && runAction('تعذّر الحذف', () => state.deleteReceivable(editingId))) onClose();
      },
    });

  return (
    <FormSheet visible title={receivable ? `تعديل: ${receivable.label}` : 'فلوس ليّا عند حد'} onCancel={onClose} onSave={handleSave}>
      {receivable && (
        <Card variant="subtle" style={styles.summary}>
          <AppText variant="bodyStrong">
            اتحصّل {formatMoney(collected, receivable.currency)} من {formatMoney(receivable.amount, receivable.currency)}
          </AppText>
          <AppText variant="secondary" color="textSecondary">
            {status === 'written_off'
              ? `اتشطب ${formatDateAr(receivable.writtenOffAt!)}`
              : status === 'settled'
                ? 'اتحصّل كله'
                : `الباقي ${formatMoney(receivableRemaining(state, receivable), receivable.currency)}`}
          </AppText>
        </Card>
      )}

      <Segment<ReceivableKind>
        options={[
          { label: 'مرتب', value: 'salary' },
          { label: 'حاجة تانية', value: 'other' },
        ]}
        value={kind}
        onChange={setKind}
      />

      <FormField label="من مين؟">
        <FormInput value={label} onChangeText={setLabel} placeholder="مثال: الشركة" accessibilityLabel="من مين" />
      </FormField>

      {kind === 'salary' && (
        <FormField label="عن شهر">
          <MonthSwitcher month={forMonth} onChange={setForMonth} />
        </FormField>
      )}

      {duplicate && (
        <InsightCard tone="attention" icon="info-outline" message={`فيه مرتب لنفس الشهر عند «${duplicate.label}» متسجّل بالفعل. لو ده تاني فعلاً كمّل عادي.`} />
      )}

      <FormField label="المبلغ">
        <AmountInput value={amountInput} onChangeText={setAmountInput} currency={currency} accessibilityLabel="المبلغ اللي ليّا" />
      </FormField>

      {currencies.length > 1 && (
        <FormField label="العملة" helper={currencyLocked ? 'العملة مش بتتغيّر بعد أول تحصيل' : undefined}>
          {currencyLocked ? (
            <AppText variant="bodyStrong">{currencyNameAr(currency)}</AppText>
          ) : (
            <Segment<CurrencyCode>
              options={currencies.map((c) => ({ label: currencyNameAr(c), value: c }))}
              value={currency}
              onChange={setCurrency}
            />
          )}
        </FormField>
      )}

      <FormField label="ميعاد الاستحقاق (اختياري)">
        <FutureDateField value={dueDate} onChange={setDueDate} clearLabel="بدون ميعاد" />
      </FormField>

      <FormField label="ملاحظة (اختياري)">
        <FormInput value={note} onChangeText={setNote} multiline style={styles.note} />
      </FormField>

      {receivable && collections.length > 0 && (
        <View style={styles.collections}>
          <AppText variant="secondary" color="textSecondary">
            التحصيلات
          </AppText>
          <ListGroup>
            {collections.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} state={state} showDate onPress={() => onOpenTransaction?.(tx.id)} />
            ))}
          </ListGroup>
        </View>
      )}

      {receivable && (
        <View style={styles.actions}>
          {(status === 'open' || status === 'partial') && onCollect && (
            <Button label="سجّل تحصيل" icon="south-west" block onPress={() => onCollect(receivable)} />
          )}
          {status === 'written_off' ? (
            <Button label="رجّعها مفتوحة" variant="secondary" icon="undo" block onPress={reopen} />
          ) : status !== 'settled' ? (
            <Button label="اشطبها" variant="secondary" icon="block" block onPress={writeOff} />
          ) : null}
          {collections.length === 0 ? (
            <Button label="احذفها" variant="destructive" icon="delete-outline" block onPress={remove} />
          ) : (
            <AppText variant="caption" color="textSecondary" align="center">
              فيه تحصيلات، تقدر تشطبها بس
            </AppText>
          )}
        </View>
      )}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  summary: { gap: space.xs, marginBottom: space.md },
  note: { minHeight: 72, textAlignVertical: 'top' },
  collections: { marginTop: space.lg, gap: space.xs },
  actions: { marginTop: space.xxl, gap: space.sm },
});
