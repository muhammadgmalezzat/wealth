import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { RuleSheet } from '@/components/recurring/RuleSheet';
import { AmountInput, type AmountHint } from '@/components/ui/AmountInput';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { PastDateField } from '@/components/ui/DateFields';
import { FormField } from '@/components/ui/FormField';
import { FormInput, FormSheet } from '@/components/ui/FormSheet';
import { formatMoney } from '@/components/ui/formatMoney';
import { Segment } from '@/components/ui/Segment';
import { StatusChip } from '@/components/ui/StatusChip';
import { colors, space } from '@/constants/theme';
import type { NewRecurringRule } from '@/store/operations';
import { planFor, spendImpact } from '@/store/planning';
import { pickerCategories } from '@/store/selectors';
import type { GoldKarat, Location, Transaction } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { fromEGP, toEGP } from '@/utils/currency';
import { monthOf, toDateKey } from '@/utils/dates';
import { confirmAction, showMessage } from '@/utils/dialogs';
import { currencySymbol } from '@/utils/formatters';
import { parseAmount } from '@/utils/parseAmount';
import { runAction } from '@/utils/runAction';

import { AccountPicker } from './AccountPicker';
import { CategoryPicker } from './CategoryPicker';
import { GoldFields, type KaratOption } from './GoldFields';
import { MoreDetails } from './MoreDetails';

type TxType = Transaction['type'];
type FlowType = 'income' | 'expense';

const round2 = (n: number) => Math.round(n * 100) / 100;

interface TransactionSheetProps {
  // Omit to add a new transaction.
  transaction?: Transaction;
  // New transactions only: the type selected when the sheet opens (default expense).
  initialType?: Transaction['type'];
  onClose: () => void;
}

// Add / edit sheet for income, expense, transfer and gold-purchase transactions. A gold
// purchase stays a gold purchase when edited (it owns a holding). Mount it only while open:
// its form state is initialised from `transaction` (or the remembered defaults) on mount.
//
// Progressive disclosure (fastest path: amount → category → حفظ): type · amount (+ budget hint)
// · category chips · account line(s) · date · gold fields · "تفاصيل أكتر" (note, one-time,
// make recurring) · delete. All state and save logic stay here; the pieces are presentational.
export function TransactionSheet({ transaction, initialType, onClose }: TransactionSheetProps) {
  const state = useFinanceStore();
  const lastUsed = state.settings.lastUsed ?? {};
  const editedHolding =
    transaction?.type === 'asset_purchase'
      ? state.holdings.find((h) => h.id === transaction.holdingId)
      : undefined;
  const editedGold = editedHolding?.type === 'gold' ? editedHolding : undefined;

  // Archived accounts are hidden unless the edited transaction already uses them.
  const involvedIds = new Set(
    !transaction
      ? []
      : transaction.type === 'transfer'
        ? [transaction.fromAccountId, transaction.toAccountId]
        : [transaction.accountId]
  );
  const accounts = state.accounts.filter((a) => !a.archived || involvedIds.has(a.id));
  const accountById = (id: string) => accounts.find((a) => a.id === id);
  const validAccount = (id: string | undefined) => (id && accountById(id) ? id : undefined);
  const validCategory = (id: string | undefined, kind: FlowType) =>
    id && state.categories.some((c) => c.id === id && c.kind === kind && !c.archived) ? id : '';

  const flowDefaults = (kind: FlowType) => ({
    accountId: validAccount(lastUsed[kind]?.accountId) ?? accounts[0]?.id ?? '',
    categoryId: validCategory(lastUsed[kind]?.categoryId, kind),
  });
  const transferDefaults = () => {
    const from = validAccount(lastUsed.transfer?.fromAccountId) ?? accounts[0]?.id ?? '';
    const to =
      validAccount(lastUsed.transfer?.toAccountId) ?? accounts.find((a) => a.id !== from)?.id ?? '';
    return { from, to: to === from ? '' : to };
  };

  const initialFlow =
    transaction?.type === 'income' || transaction?.type === 'expense'
      ? { accountId: transaction.accountId, categoryId: transaction.categoryId }
      : transaction?.type === 'asset_purchase'
        ? { accountId: transaction.accountId, categoryId: '' }
        : flowDefaults('expense');
  const initialTransfer =
    transaction?.type === 'transfer'
      ? { from: transaction.fromAccountId, to: transaction.toAccountId }
      : transferDefaults();

  const [type, setType] = useState<TxType>(transaction?.type ?? initialType ?? 'expense');
  const [amountText, setAmountText] = useState(transaction ? String(transaction.amount) : '');
  const [accountId, setAccountId] = useState(initialFlow.accountId);
  const [categoryId, setCategoryId] = useState(initialFlow.categoryId);
  const [fromAccountId, setFromAccountId] = useState(initialTransfer.from);
  const [toAccountId, setToAccountId] = useState(initialTransfer.to);
  // null = follow the converted amount automatically; a string once the user edits it.
  const [toAmountText, setToAmountText] = useState<string | null>(
    transaction?.type === 'transfer' ? String(transaction.toAmount) : null
  );
  const [date, setDate] = useState(transaction?.date ?? toDateKey(new Date()));
  const [note, setNote] = useState(transaction?.note ?? '');
  const [oneTime, setOneTime] = useState(transaction?.type === 'expense' && !!transaction.oneTime);
  // Gold purchase fields.
  const [weightText, setWeightText] = useState(editedGold ? String(editedGold.weightGrams) : '');
  const [karat, setKarat] = useState<KaratOption>(editedGold ? `${editedGold.karat}` : '21');
  const [goldLocation, setGoldLocation] = useState<Location>(editedGold?.location ?? 'EG');
  const [holdingName, setHoldingName] = useState(editedGold?.name ?? '');
  // Inline copies of the validation messages, shown under the related field.
  const [errors, setErrors] = useState<{ amount?: string; account?: string; category?: string }>({});

  const isTransfer = type === 'transfer';
  const isGold = type === 'asset_purchase';
  const fromAccount = accountById(fromAccountId);
  const toAccount = accountById(toAccountId);
  const flowAccount = accountById(accountId);
  const amountCurrency = isTransfer ? fromAccount?.currency : flowAccount?.currency;
  const crossCurrency = isTransfer && !!fromAccount && !!toAccount && fromAccount.currency !== toAccount.currency;

  const amount = parseAmount(amountText);

  // Live budget hint for new expenses (never blocks saving).
  const impact =
    !transaction && type === 'expense' && categoryId && amount !== null && flowAccount
      ? spendImpact(state, monthOf(date), categoryId, amount, flowAccount.currency)
      : null;
  const impactCategory = state.categories.find((c) => c.id === categoryId)?.name;
  const impactCurrency = planFor(state, monthOf(date))?.currency ?? 'EGP';
  const rates = state.settings.exchangeRates;
  const convertedToAmount =
    crossCurrency && amount !== null
      ? round2(fromEGP(toEGP(amount, fromAccount.currency, rates), toAccount.currency, rates))
      : null;
  const toAmountValue = toAmountText ?? (convertedToAmount !== null ? String(convertedToAmount) : '');

  const changeType = (next: TxType) => {
    if (next === type) return;
    setType(next);
    if (next === 'transfer') return;
    if (next === 'asset_purchase') {
      setAccountId(validAccount(accountId) ?? accounts[0]?.id ?? '');
      return;
    }
    // Categories differ per kind: restore the original when switching back while editing,
    // otherwise fall back to the remembered defaults.
    if (transaction && (transaction.type === 'income' || transaction.type === 'expense') && transaction.type === next) {
      setAccountId(transaction.accountId);
      setCategoryId(transaction.categoryId);
    } else {
      const defaults = flowDefaults(next);
      setAccountId(validAccount(accountId) ?? defaults.accountId);
      setCategoryId(defaults.categoryId);
    }
  };

  // A transaction recording a recurring occurrence keeps that link through edits.
  const occurrenceLink = transaction?.recurringRuleId
    ? {
        recurringRuleId: transaction.recurringRuleId,
        ...(transaction.occurrenceDate ? { occurrenceDate: transaction.occurrenceDate } : {}),
      }
    : {};

  const handleSave = () => {
    setErrors({
      amount: amount === null ? 'اكتب مبلغ أكبر من صفر' : undefined,
      account: (isTransfer ? !fromAccountId || !toAccountId : !flowAccount) ? 'اختار الحساب' : undefined,
      category: (type === 'income' || type === 'expense') && !categoryId ? 'اختار البند' : undefined,
    });
    const value = amount ?? NaN; // NaN → the store reports an Arabic "invalid amount" message
    const noteField = note.trim() ? { note: note.trim() } : {};

    if (isTransfer) {
      if (!fromAccountId || !toAccountId) {
        showMessage('تنبيه', 'اختر الحساب المحوَّل منه والمحوَّل إليه');
        return;
      }
      const toAmount = crossCurrency ? (parseAmount(toAmountValue) ?? NaN) : value;
      const fields = { fromAccountId, toAccountId, amount: value, toAmount, date, ...noteField };
      const saved = runAction('تعذّر الحفظ', () =>
        transaction
          ? state.updateTransaction({
              ...fields,
              ...occurrenceLink,
              type: 'transfer',
              id: transaction.id,
              createdAt: transaction.createdAt,
              rateToEGP: transaction.rateToEGP,
            })
          : state.addTransfer(fields)
      );
      if (saved) onClose();
      return;
    }

    if (!flowAccount) {
      showMessage('تنبيه', 'اختر الحساب');
      return;
    }

    if (isGold) {
      const karatValue = Number(karat) as GoldKarat;
      const purchase = {
        accountId,
        amount: value,
        date,
        ...noteField,
        holding: {
          name: holdingName.trim() || `ذهب ${weightText.trim()} جم عيار ${karatValue}`,
          weightGrams: parseAmount(weightText) ?? NaN,
          karat: karatValue,
          location: goldLocation,
          ...(editedGold?.note ? { note: editedGold.note } : {}),
        },
      };
      const saved = runAction('تعذّر الحفظ', () =>
        transaction ? state.updateGoldPurchase(transaction.id, purchase) : state.buyGold(purchase)
      );
      if (saved) onClose();
      return;
    }
    if (type !== 'income' && type !== 'expense') return;

    if (!categoryId) {
      showMessage('تنبيه', 'اختر التصنيف');
      return;
    }
    const fields = {
      type,
      amount: value,
      currency: flowAccount.currency,
      accountId,
      categoryId,
      date,
      ...noteField,
      ...(type === 'expense' && oneTime ? { oneTime: true } : {}),
    };
    const saved = runAction('تعذّر الحفظ', () => {
      if (!transaction) {
        state.addTransaction(fields);
        return;
      }
      // Keep links that the form doesn't edit (recurring occurrence, liability payment).
      const links =
        transaction.type === 'income' || transaction.type === 'expense'
          ? {
              ...occurrenceLink,
              ...(transaction.liabilityId && type === 'expense' ? { liabilityId: transaction.liabilityId } : {}),
            }
          : occurrenceLink;
      state.updateTransaction({
        ...fields,
        ...links,
        id: transaction.id,
        createdAt: transaction.createdAt,
        // The store keeps this unless the currency changed.
        rateToEGP: transaction.rateToEGP,
      });
    });
    if (saved) onClose();
  };

  // "خليها متكررة": a monthly rule prefilled from the saved transaction (not yet linked to one).
  const [ruleOpen, setRuleOpen] = useState(false);
  const recurringPrefill: Partial<NewRecurringRule> | null =
    !transaction || transaction.recurringRuleId || transaction.type === 'asset_purchase'
      ? null
      : {
          ...(transaction.type === 'transfer'
            ? {
                kind: 'transfer' as const,
                name: 'تحويل',
                accountId: transaction.fromAccountId,
                toAccountId: transaction.toAccountId,
                toAmount: transaction.toAmount,
              }
            : {
                kind: transaction.type,
                name: state.categories.find((c) => c.id === transaction.categoryId)?.name ?? '',
                accountId: transaction.accountId,
                categoryId: transaction.categoryId,
              }),
          amount: transaction.amount,
          frequency: 'monthly',
          interval: 1,
          dayOfMonth: Number(transaction.date.slice(8, 10)),
          startDate: transaction.date,
          mode: 'confirm',
          variableAmount: false,
          ...(transaction.note ? { note: transaction.note } : {}),
        };

  const handleDelete = () => {
    if (!transaction) return;
    confirmAction({
      title: 'حذف المعاملة',
      message:
        transaction.type === 'asset_purchase'
          ? 'هيتحذف الذهب المرتبط بالمعاملة كمان، والفلوس هترجع للحساب.'
          : 'هل تريد حذف هذه المعاملة؟',
      confirmText: 'حذف',
      cancelText: 'إلغاء',
      onConfirm: () => {
        if (runAction('تعذّر الحذف', () => state.deleteTransaction(transaction.id))) onClose();
      },
    });
  };

  // Archived categories are hidden, except the one this transaction already uses.
  const kindCategories =
    type === 'income' || type === 'expense'
      ? pickerCategories(state.categories, type, [
          transaction?.type === 'income' || transaction?.type === 'expense' ? transaction.categoryId : undefined,
        ])
      : [];
  // A gold purchase can't become another type (and vice versa) once saved.
  const typeOptions: { label: string; value: TxType }[] =
    transaction?.type === 'asset_purchase'
      ? []
      : [
          { label: 'مصروف', value: 'expense' },
          { label: 'دخل', value: 'income' },
          { label: 'تحويل', value: 'transfer' },
          ...(transaction ? [] : [{ label: 'ذهب', value: 'asset_purchase' as const }]),
        ];

  // Budget hint under the amount (new expenses with a plan line only; never blocks saving).
  const budgetHint: AmountHint | undefined =
    impact && impactCategory
      ? impact.overBy > 0
        ? {
            tone: 'attention',
            icon: 'info-outline',
            text: `المبلغ ده هيعدّي ميزانية ${impactCategory} بـ ${formatMoney(impact.overBy, impactCurrency)}`,
          }
        : {
            tone: 'neutral',
            icon: 'check-circle-outline',
            text: `هيفضل ${formatMoney(impact.remainingAfter, impactCurrency)} في ${impactCategory}`,
          }
      : undefined;

  const detailsOpen =
    !!transaction &&
    (!!transaction.note || (transaction.type === 'expense' && !!transaction.oneTime) || !!transaction.recurringRuleId);
  const lastUsedCategory = type === 'income' || type === 'expense' ? lastUsed[type]?.categoryId : undefined;

  return (
    <FormSheet
      visible
      title={transaction ? 'تعديل المعاملة' : 'معاملة جديدة'}
      onCancel={onClose}
      onSave={handleSave}>
      {typeOptions.length > 0 ? (
        <Segment<TxType> options={typeOptions} value={type} onChange={changeType} />
      ) : (
        <View style={styles.lockedType}>
          <StatusChip label="شراء ذهب" tone="gold" icon="diamond" />
          <AppText variant="caption" color="textSecondary">
            نوع المعاملة دي مش بيتغير بعد الحفظ.
          </AppText>
        </View>
      )}

      <AmountInput
        value={amountText}
        onChangeText={(text) => {
          setAmountText(text);
          if (errors.amount) setErrors((e) => ({ ...e, amount: undefined }));
        }}
        currency={amountCurrency ?? 'EGP'}
        hint={budgetHint}
        autoFocus={!transaction}
      />
      {errors.amount ? (
        <AppText variant="caption" color="danger" align="center">
          {errors.amount}
        </AppText>
      ) : null}

      {(type === 'income' || type === 'expense') && (
        <CategoryPicker
          categories={kindCategories}
          selectedId={categoryId}
          lastUsedId={lastUsedCategory}
          onSelect={(id) => {
            setCategoryId(id);
            if (errors.category) setErrors((e) => ({ ...e, category: undefined }));
          }}
          error={errors.category}
        />
      )}

      {accounts.length === 0 && (
        <AppText variant="caption" color="textSecondary" style={styles.hint}>
          أضف حساباً أولاً من شاشة الأصول
        </AppText>
      )}

      {isTransfer ? (
        <>
          <AccountPicker
            label="من"
            accounts={accounts}
            selectedId={fromAccountId}
            disabledId={toAccountId}
            onSelect={(id) => {
              setFromAccountId(id);
              if (errors.account) setErrors((e) => ({ ...e, account: undefined }));
            }}
            error={errors.account}
          />
          <AccountPicker
            label="إلى"
            accounts={accounts}
            selectedId={toAccountId}
            disabledId={fromAccountId}
            onSelect={(id) => {
              setToAccountId(id);
              if (errors.account) setErrors((e) => ({ ...e, account: undefined }));
            }}
          />
          {crossCurrency && (
            <FormField
              label={`المبلغ المستلم (${currencySymbol(toAccount.currency)})`}
              helper="محسوب بسعر الصرف الحالي، عدّله لو السعر الفعلي أو الرسوم مختلفة.">
              <FormInput value={toAmountValue} onChangeText={setToAmountText} placeholder="0" keyboardType="decimal-pad" />
            </FormField>
          )}
        </>
      ) : (
        <AccountPicker
          label={isGold ? 'دفعت من' : type === 'income' ? 'في' : 'من'}
          accounts={accounts}
          selectedId={accountId}
          onSelect={(id) => {
            setAccountId(id);
            if (errors.account) setErrors((e) => ({ ...e, account: undefined }));
          }}
          error={errors.account}
        />
      )}

      <View style={styles.date}>
        <AppText variant="caption" color="textSecondary">
          التاريخ
        </AppText>
        <PastDateField value={date} onChange={setDate} />
      </View>

      {isGold && (
        <GoldFields
          weightText={weightText}
          onWeightText={setWeightText}
          karat={karat}
          onKarat={setKarat}
          location={goldLocation}
          onLocation={setGoldLocation}
          name={holdingName}
          onName={setHoldingName}
        />
      )}

      <MoreDetails initiallyOpen={detailsOpen}>
        <FormField label="ملاحظة (اختياري)">
          <FormInput value={note} onChangeText={setNote} placeholder="مثال: عشاء مع الأصحاب" multiline style={styles.note} />
        </FormField>

        {type === 'expense' && (
          <View style={styles.switchRow}>
            <Switch
              value={oneTime}
              onValueChange={setOneTime}
              trackColor={{ true: colors.primary600, false: colors.borderStrong }}
              thumbColor={colors.surface}
              accessibilityLabel="مصروف لمرة واحدة"
            />
            <View style={styles.switchText}>
              <AppText variant="bodyStrong">مصروف لمرة واحدة</AppText>
              <AppText variant="caption" color="textSecondary">
                بيتحسب في الشهر ده بس، ومش بيدخل في متوسطات الخطة.
              </AppText>
            </View>
          </View>
        )}

        {recurringPrefill && (
          <View style={styles.recurring}>
            <Button label="خلّيها معاملة متكررة" variant="tertiary" icon="repeat" onPress={() => setRuleOpen(true)} />
          </View>
        )}
      </MoreDetails>

      {ruleOpen && recurringPrefill && transaction && (
        <RuleSheet prefill={recurringPrefill} linkTransactionId={transaction.id} onClose={() => setRuleOpen(false)} />
      )}

      {transaction && (
        <View style={styles.delete}>
          <Button label="احذف المعاملة" variant="destructive" icon="delete-outline" block onPress={handleDelete} />
        </View>
      )}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  lockedType: { gap: space.xs, alignItems: 'flex-end' },
  hint: { marginTop: space.sm },
  date: { marginTop: space.lg, gap: space.sm },
  note: { minHeight: 72, textAlignVertical: 'top' },
  // RTL: text on the right, switch on the left.
  switchRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.md, marginTop: space.lg },
  switchText: { flex: 1, gap: 2 },
  recurring: { marginTop: space.md },
  delete: { marginTop: space.xxxl },
});
