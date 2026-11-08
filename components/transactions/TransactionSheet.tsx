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
import { Card } from '@/components/ui/Card';
import { Segment } from '@/components/ui/Segment';
import { StatusChip } from '@/components/ui/StatusChip';
import { colors, space } from '@/constants/theme';
import type { NewRecurringRule } from '@/store/operations';
import { coversOf, followPreview, mergeOptions, type OpOptions } from '@/store/cover';
import { feeCategoryId } from '@/store/defaultCategories';
import { feeSpendImpact, planFor, spendImpact } from '@/store/planning';
import { pickerCategories } from '@/store/selectors';
import { DEFAULT_COUNTRY } from '@/components/ui/countryOptions';
import type { CountryCode, GoldKarat, Transaction } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { convertCurrency } from '@/utils/currency';
import { roundIn } from '@/utils/money';
import { monthOf, toDateKey } from '@/utils/dates';
import { confirmAction, showMessage } from '@/utils/dialogs';
import { parseAmount } from '@/utils/parseAmount';
import { runAction } from '@/utils/runAction';

import { AccountPicker } from './AccountPicker';
import { ExchangeFields } from './ExchangeFields';
import { FeeFields, type FeeDraft } from './FeeFields';
import { CategoryPicker } from './CategoryPicker';
import { GoldFields, type KaratOption } from './GoldFields';
import { MoreDetails } from './MoreDetails';

// The sheet's types: a transfer between accounts of two currencies is saved as an exchange, so the form has
// one "تحويل" tab for both.
type TxType = Exclude<Transaction['type'], 'exchange'>;
type FlowType = 'income' | 'expense';

const formType = (type: Transaction['type']): TxType => (type === 'exchange' ? 'transfer' : type);
// What the user typed in the amount box: a transfer's amount, an exchange's sent amount.
const typedAmount = (tx: Transaction): number => (tx.type === 'exchange' ? tx.sentAmount : tx.amount);

interface TransactionSheetProps {
  // Omit to add a new transaction.
  transaction?: Transaction;
  // New transactions only: the type selected when the sheet opens (default expense).
  initialType?: Transaction['type'];
  onClose: () => void;
}

// Add / edit sheet for income, expense, transfer (and exchange between currencies) and gold-purchase transactions. A gold
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
      : transaction.type === 'transfer' || transaction.type === 'exchange'
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
    transaction?.type === 'transfer' || transaction?.type === 'exchange'
      ? { from: transaction.fromAccountId, to: transaction.toAccountId }
      : transferDefaults();

  const [type, setType] = useState<TxType>(formType(transaction?.type ?? initialType ?? 'expense'));
  const [amountText, setAmountText] = useState(transaction ? String(typedAmount(transaction)) : '');
  const [accountId, setAccountId] = useState(initialFlow.accountId);
  const [categoryId, setCategoryId] = useState(initialFlow.categoryId);
  const [fromAccountId, setFromAccountId] = useState(initialTransfer.from);
  const [toAccountId, setToAccountId] = useState(initialTransfer.to);
  // An exchange's received amount: typed by the user, never filled in from a rate.
  const [receivedText, setReceivedText] = useState(transaction?.type === 'exchange' ? String(transaction.receivedAmount) : '');
  // The reserved money that travels with a new transfer, as the user edited it (null = the proportional default).
  const [followEdit, setFollowEdit] = useState<Record<string, string> | null>(null);
  const [fees, setFees] = useState<FeeDraft[]>(() =>
    transaction?.type === 'transfer' || transaction?.type === 'exchange'
      ? transaction.fees.map((fee, i) => ({
          key: i + 1,
          amountText: String(fee.amount),
          side: fee.accountId === transaction.fromAccountId ? ('from' as const) : ('to' as const),
        }))
      : []
  );
  const [date, setDate] = useState(transaction?.date ?? toDateKey(new Date()));
  const [note, setNote] = useState(transaction?.note ?? '');
  const [oneTime, setOneTime] = useState(transaction?.type === 'expense' && !!transaction.oneTime);
  // Gold purchase fields.
  const [weightText, setWeightText] = useState(editedGold ? String(editedGold.weightGrams) : '');
  const [karat, setKarat] = useState<KaratOption>(editedGold ? `${editedGold.karat}` : '21');
  const [goldLocation, setGoldLocation] = useState<CountryCode>(editedGold?.country ?? accountById(initialFlow.accountId)?.country ?? DEFAULT_COUNTRY);
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

  // Live budget hint for new expenses, and for the fees of a new transfer or exchange (never blocks saving).
  const typedFees = fees.flatMap((fee) => {
    const feeAmount = parseAmount(fee.amountText);
    const feeCurrency = (fee.side === 'from' ? fromAccount : toAccount)?.currency;
    return feeAmount !== null && feeCurrency ? [{ amount: feeAmount, currency: feeCurrency }] : [];
  });
  // Reserved money that has to leave the source account WITH a new transfer or exchange (design C3 / C4): a notice,
  // not a question; an exchange converts it at its own rate and the cover sheet asks for that.
  const feeOnSource = fees.filter((f) => f.side === 'from').reduce((sum, f) => sum + (parseAmount(f.amountText) ?? 0), 0);
  const followNotice =
    !transaction && isTransfer && fromAccount && amount !== null ? followPreview(state, fromAccount.id, amount, feeOnSource) : null;
  const fundName = (id: string) => state.funds.find((f) => f.id === id)?.name ?? '—';
  const followOverride = (): OpOptions | undefined => {
    if (!followNotice || followNotice.need <= 0 || !followEdit) return undefined;
    return {
      follow: followNotice.split.map((s) => ({ fundId: s.fundId, amount: parseAmount(followEdit[s.fundId] ?? '') ?? NaN })),
    };
  };
  const impact = transaction
    ? null
    : type === 'expense' && categoryId && amount !== null && flowAccount
      ? spendImpact(state, monthOf(date), categoryId, amount, flowAccount.currency)
      : isTransfer
        ? feeSpendImpact(state, monthOf(date), typedFees)
        : null;
  const impactCategory = state.categories.find((c) => c.id === (isTransfer ? feeCategoryId(state.categories) : categoryId))?.name;
  const impactCurrency = planFor(state, monthOf(date))?.currency ?? 'EGP';
  const rates = state.settings.rates;
  // Market values are suggestions only (D3): shown beside the received amount, never saved by themselves.
  const marketRate = crossCurrency ? convertCurrency(1, fromAccount.currency, toAccount.currency, rates) : 0;
  const suggestedReceived =
    crossCurrency && amount !== null ? roundIn(convertCurrency(amount, fromAccount.currency, toAccount.currency, rates), toAccount.currency) : null;
  const receivedValue = parseAmount(receivedText);

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
      // An empty fee row is just not a fee; anything typed in one goes to the store to validate.
      const feeList = fees
        .filter((fee) => fee.amountText.trim() !== '')
        .map((fee) => ({
          accountId: fee.side === 'from' ? fromAccountId : toAccountId,
          amount: parseAmount(fee.amountText) ?? NaN,
        }));
      const common = { fromAccountId, toAccountId, fees: feeList, date, ...noteField };
      const existing = transaction
        ? { ...occurrenceLink, id: transaction.id, createdAt: transaction.createdAt, rateSnapshotId: transaction.rateSnapshotId }
        : null;
      const override = followOverride();
      const saved = runAction('تعذّر الحفظ', (decided) => {
        const options = override ? mergeOptions(override, decided) : decided;
        if (crossCurrency) {
          // The received amount is required: no rate fills it in.
          const exchange = { ...common, sentAmount: value, receivedAmount: receivedValue ?? NaN };
          if (existing) state.updateTransaction({ ...exchange, ...existing, type: 'exchange' }, options);
          else state.addExchange(exchange, options);
        } else {
          const transfer = { ...common, amount: value };
          if (existing) state.updateTransaction({ ...transfer, ...existing, type: 'transfer' }, options);
          else state.addTransfer(transfer, options);
        }
      }, onClose);
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
          country: goldLocation,
          ...(editedGold?.note ? { note: editedGold.note } : {}),
        },
      };
      const saved = runAction(
        'تعذّر الحفظ',
        (options) => (transaction ? state.updateGoldPurchase(transaction.id, purchase, options) : state.buyGold(purchase, options)),
        onClose
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
    const saved = runAction('تعذّر الحفظ', (options) => {
      if (!transaction) {
        state.addTransaction(fields, options);
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
      state.updateTransaction(
        {
          ...fields,
          ...links,
          id: transaction.id,
          createdAt: transaction.createdAt,
          // The store keeps this unless the currency changed.
          rateSnapshotId: transaction.rateSnapshotId,
        },
        options
      );
    }, onClose);
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
              }
            : transaction.type === 'exchange'
              ? {
                  kind: 'exchange' as const,
                  name: 'تحويل عملة',
                  accountId: transaction.fromAccountId,
                  toAccountId: transaction.toAccountId,
                  toAmount: transaction.receivedAmount,
                }
              : {
                kind: transaction.type,
                name: state.categories.find((c) => c.id === transaction.categoryId)?.name ?? '',
                accountId: transaction.accountId,
                categoryId: transaction.categoryId,
              }),
          amount: typedAmount(transaction),
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
        // Q4: what a cover took from the funds for this transaction is NOT re-reserved by itself; offer it, once.
        const covers = coversOf(state, transaction.id);
        const afterDelete = () => {
          if (covers.length > 0) {
            confirmAction({
              title: 'رجّع للصناديق؟',
              message: 'المعاملة دي كانت واخدة فلوس من صناديق. تحب ترجّعها لهم (على قد المتاح في الحسابات)؟',
              confirmText: 'رجّع',
              cancelText: 'لأ',
              onConfirm: () => runAction('تعذّر الرجوع', () => state.reReserveCovers(covers, transaction.id)),
            });
          }
          onClose();
        };
        if (runAction('تعذّر الحذف', (options) => state.deleteTransaction(transaction.id, options), afterDelete)) afterDelete();
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
            <ExchangeFields
              fromCurrency={fromAccount.currency}
              toCurrency={toAccount.currency}
              sent={amount}
              receivedText={receivedText}
              onReceivedText={setReceivedText}
              marketRate={marketRate}
              suggestedReceived={suggestedReceived}
              receivedValue={receivedValue}
            />
          )}
          <FeeFields fees={fees} onChange={setFees} from={fromAccount} to={toAccount} />
          {followNotice && followNotice.need > 0 && (
            <Card variant="subtle" style={styles.follow}>
              <AppText variant="bodyStrong">
                {formatMoney(followNotice.need, followNotice.currency)} من فلوس الصناديق هتتنقل مع {crossCurrency ? 'التحويل (وهتتحوّل بسعره، وهيطلب تأكيدك)' : 'التحويل'}.
              </AppText>
              {followNotice.split.map((s) =>
                followEdit && !crossCurrency ? (
                  <FormField key={s.fundId} label={fundName(s.fundId)}>
                    <FormInput
                      value={followEdit[s.fundId] ?? ''}
                      onChangeText={(text) => setFollowEdit((prev) => ({ ...(prev ?? {}), [s.fundId]: text }))}
                      keyboardType="decimal-pad"
                    />
                  </FormField>
                ) : (
                  <AppText key={s.fundId} variant="secondary" color="textSecondary">
                    {fundName(s.fundId)}: {formatMoney(s.amount, followNotice.currency)}
                  </AppText>
                )
              )}
              {!crossCurrency && (
                <Button
                  label={followEdit ? 'خلّيها تلقائي' : 'عدّل التقسيم'}
                  variant="tertiary"
                  onPress={() => setFollowEdit(followEdit ? null : Object.fromEntries(followNotice.split.map((s) => [s.fundId, String(s.amount)])))}
                />
              )}
            </Card>
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
              thumbColor={colors.text}
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
  follow: { gap: space.xs, marginTop: space.sm },
  lockedType: { gap: space.xs, alignItems: 'flex-end' },
  hint: { marginTop: space.sm },
  date: { marginTop: space.lg, gap: space.sm },
  note: { minHeight: 72, textAlignVertical: 'top' },
  // RTL: text on the right, switch on the left.
  switchRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.md, marginTop: space.lg },
  switchText: { flex: 1, gap: space.xxs },
  recurring: { marginTop: space.md },
  delete: { marginTop: space.xxxl },
});
