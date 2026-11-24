import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AssignSheet } from '@/components/funds/AssignSheet';
import { AccountPicker } from '@/components/transactions/AccountPicker';
import { CategoryPicker } from '@/components/transactions/CategoryPicker';
import { AmountInput } from '@/components/ui/AmountInput';
import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { PastDateField } from '@/components/ui/DateFields';
import { FormField } from '@/components/ui/FormField';
import { FormInput, FormSheet } from '@/components/ui/FormSheet';
import { formatMoney } from '@/components/ui/formatMoney';
import { StatusChip } from '@/components/ui/StatusChip';
import { space } from '@/constants/theme';
import { CATEGORY_IDS } from '@/store/defaultCategories';
import { pickerCategories, receivableRefillSuggestion, receivableRemaining, type FundAmount } from '@/store/selectors';
import type { Receivable } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { toDateKey } from '@/utils/dates';
import { showMessage } from '@/utils/dialogs';
import { parseAmount } from '@/utils/parseAmount';
import { runAction } from '@/utils/runAction';

import {
  amountText,
  collectAccountsHelper,
  collectHint,
  CROSS_CURRENCY_NOTE,
  forMonthLabel,
  noAccountNote,
  shouldOfferRefill,
} from './receivablesUi';

interface CollectSheetProps {
  receivable: Receivable;
  onClose: () => void;
}

// «تحصيل»: records (part of) a receivable as an income in its currency, on the date it arrived (rule 3). Only
// accounts in that currency are offered (Q2); more than what is left can't be saved (Q3). Then, when funds are below
// target, the same sheet becomes the refill offer (Q8): «وزّع الفلوس» prefilled from that account, all editable,
// إلغاء skips it. Never applied by itself.
export function CollectSheet({ receivable, onClose }: CollectSheetProps) {
  const state = useFinanceStore();
  const accounts = state.accounts.filter((a) => !a.archived && a.currency === receivable.currency);
  const lastIncomeAccount = state.settings.lastUsed?.income?.accountId;
  const defaultCategory = receivable.kind === 'salary' ? CATEGORY_IDS.salary : CATEGORY_IDS.otherIncome;
  const categories = pickerCategories(state.categories, 'income', [defaultCategory]);

  const [amountInput, setAmountInput] = useState(amountText(receivableRemaining(state, receivable)));
  const [accountId, setAccountId] = useState(accounts.find((a) => a.id === lastIncomeAccount)?.id ?? accounts[0]?.id ?? '');
  const [categoryId, setCategoryId] = useState(categories.some((c) => c.id === defaultCategory) ? defaultCategory : (categories[0]?.id ?? ''));
  const [date, setDate] = useState(toDateKey(new Date()));
  const [note, setNote] = useState('');
  const [refill, setRefill] = useState<{ accountId: string; suggestion: FundAmount[]; collected: number } | null>(null);

  if (refill) {
    return (
      <AssignSheet
        title="كمّل الصناديق"
        intro={`وصلك ${formatMoney(refill.collected, receivable.currency)}. ده اقتراح للصناديق اللي لسه ناقصة؛ عدّله زي ما تحب، أو دوس إلغاء وسيبه.`}
        initialCurrency={receivable.currency}
        initialAccountId={refill.accountId}
        prefill={refill.suggestion}
        onClose={onClose}
      />
    );
  }

  const amount = parseAmount(amountInput);
  const { hint, blocked } = collectHint(state, receivable, amount);

  const afterSave = (collected: number) => {
    const fresh = useFinanceStore.getState();
    const suggestion = receivableRefillSuggestion(fresh, accountId, collected);
    if (shouldOfferRefill(suggestion)) setRefill({ accountId, suggestion, collected });
    else onClose();
  };

  const handleSave = () => {
    if (!accountId) {
      showMessage('تنبيه', noAccountNote(receivable.currency));
      return;
    }
    const value = amount ?? NaN;
    const input = { receivableId: receivable.id, accountId, amount: value, date, categoryId, ...(note.trim() ? { note: note.trim() } : {}) };
    // An income never needs a cover; the gate still runs, and its retry finishes the same way.
    const saved = runAction('تعذّر التحصيل', (options) => state.collectReceivable(input, options), () => afterSave(value));
    if (saved) afterSave(value);
  };

  return (
    <FormSheet visible title={`تحصيل: ${receivable.label}`} onCancel={onClose} onSave={handleSave} saveLabel="تحصيل" saveDisabled={blocked || accounts.length === 0}>
      {receivable.forMonth && (
        <View style={styles.chip}>
          <StatusChip label={forMonthLabel(receivable.forMonth)} tone="neutral" icon="event-note" />
        </View>
      )}

      <AmountInput value={amountInput} onChangeText={setAmountInput} currency={receivable.currency} hint={hint} accessibilityLabel="المبلغ اللي وصل" />

      {accounts.length === 0 ? (
        <Card variant="subtle" style={styles.note}>
          <AppText variant="secondary" color="textSecondary">
            {noAccountNote(receivable.currency)}
          </AppText>
        </Card>
      ) : (
        <View style={styles.accounts}>
          <AccountPicker label="في" accounts={accounts} selectedId={accountId} onSelect={setAccountId} />
          <AppText variant="caption" color="textSecondary">
            {collectAccountsHelper(receivable.currency)}
          </AppText>
          <AppText variant="caption" color="textSecondary">
            {CROSS_CURRENCY_NOTE}
          </AppText>
        </View>
      )}

      <View style={styles.date}>
        <AppText variant="caption" color="textSecondary">
          وصل إمتى
        </AppText>
        <PastDateField value={date} onChange={setDate} />
      </View>

      <CategoryPicker categories={categories} selectedId={categoryId} lastUsedId={defaultCategory} onSelect={setCategoryId} />

      <FormField label="ملاحظة (اختياري)">
        <FormInput value={note} onChangeText={setNote} placeholder="مثال: اتحوّل على دفعتين" />
      </FormField>
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  chip: { alignItems: 'flex-end', marginBottom: space.sm },
  accounts: { gap: space.xs, marginTop: space.md },
  note: { marginTop: space.md },
  date: { marginTop: space.lg, gap: space.sm },
});
