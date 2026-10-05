import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { FREQUENCY_LABELS } from '@/components/funds/labels';
import { AmountInput } from '@/components/ui/AmountInput';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { FutureDateField } from '@/components/ui/DateFields';
import { FormField } from '@/components/ui/FormField';
import { FormInput, FormSheet } from '@/components/ui/FormSheet';
import { formatMoney } from '@/components/ui/formatMoney';
import { Money } from '@/components/ui/Money';
import { Segment } from '@/components/ui/Segment';
import { space } from '@/constants/theme';
import {
  fundAllocated,
  holdingValueEGP,
  linkableHoldings,
  sinkingMonthlySuggestion,
  suggestedEmergencyTarget,
  unassignedEGP,
  unassignedEGPWithFundCash,
} from '@/store/selectors';
import type { Fund, SinkingFrequency } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { confirmAction } from '@/utils/dialogs';
import { currencySymbol, formatNumber } from '@/utils/formatters';
import { parseAmount } from '@/utils/parseAmount';
import { runAction } from '@/utils/runAction';

type FundType = Fund['type'];

const round2 = (n: number) => Math.round(n * 100) / 100;
const toArabicDigits = (text: string) => text.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);

interface FundSheetProps {
  // Omit to create a new fund.
  fund?: Fund;
  initialType?: FundType;
  onClose: () => void;
  // Called instead of onClose after the fund was deleted.
  onDeleted?: () => void;
}

// Create / edit sheet for all fund types. Mount only while open.
export function FundSheet({ fund, initialType = 'goal', onClose, onDeleted }: FundSheetProps) {
  const state = useFinanceStore();
  const nextPriority = Math.max(0, ...state.funds.map((f) => f.priority)) + 1;

  const [type, setType] = useState<FundType>(fund?.type ?? initialType);
  const [name, setName] = useState(fund?.name ?? '');
  const [targetText, setTargetText] = useState(fund ? String(fund.targetAmount) : '');
  const [priorityText, setPriorityText] = useState(String(fund?.priority ?? nextPriority));
  const [deadline, setDeadline] = useState<string | undefined>(fund?.deadline);
  const [frequency, setFrequency] = useState<SinkingFrequency>(fund?.frequency ?? 'yearly');
  const [nextDueDate, setNextDueDate] = useState<string | undefined>(fund?.nextDueDate);
  const [linked, setLinked] = useState<string[]>(fund?.linkedHoldingIds ?? []);
  const [cashText, setCashText] = useState(fund ? String(round2(fundAllocated(state, fund.id))) : '');

  const target = parseAmount(targetText);
  const cash = parseAmount(cashText, { allowZero: true });
  const currency = fund?.currency ?? 'EGP';

  // Gold that isn't backing another fund (plus whatever this fund already links).
  const goldOptions = linkableHoldings(state, fund?.id).filter(
    (h) => h.type === 'gold' || linked.includes(h.id)
  );
  const toggleLinked = (id: string) =>
    setLinked((prev) => (prev.includes(id) ? prev.filter((h) => h !== id) : [...prev, id]));

  const emergency3 = suggestedEmergencyTarget(state, 3);
  const emergency6 = suggestedEmergencyTarget(state, 6);
  const sinkingMonthly =
    type === 'sinking' && target !== null && nextDueDate
      ? sinkingMonthlySuggestion({ type, targetAmount: target, nextDueDate })
      : null;
  const previewEGP =
    fund && cash !== null ? unassignedEGPWithFundCash(state, fund.id, cash) : unassignedEGP(state);

  const handleSave = () => {
    const common = {
      name: name.trim() || (type === 'emergency' ? 'صندوق الطوارئ' : ''),
      type,
      targetAmount: target ?? NaN,
      priority: parseAmount(priorityText) ?? NaN,
      linkedHoldingIds: linked,
      ...(type === 'goal' && deadline ? { deadline } : {}),
      ...(type === 'sinking' ? { frequency, ...(nextDueDate ? { nextDueDate } : {}) } : {}),
    };
    const saved = runAction('تعذّر الحفظ', () =>
      fund
        ? state.editFund(fund.id, { ...common, cashAllocation: cash ?? NaN })
        : state.addFund({ ...common, currency })
    );
    if (saved) onClose();
  };

  const handleDelete = () => {
    if (!fund) return;
    confirmAction({
      title: 'حذف الصندوق',
      message: `هل تريد حذف "${fund.name}"؟ فلوسه النقدية هترجع لفلوس بدون وظيفة.`,
      confirmText: 'حذف',
      cancelText: 'إلغاء',
      onConfirm: () => {
        if (runAction('تعذّر الحذف', () => state.deleteFund(fund.id))) (onDeleted ?? onClose)();
      },
    });
  };

  return (
    <FormSheet visible title={fund ? 'تعديل الصندوق' : 'صندوق جديد'} onCancel={onClose} onSave={handleSave}>
      <Segment<FundType>
        options={[
          { label: 'الطوارئ', value: 'emergency' },
          { label: 'هدف', value: 'goal' },
          { label: 'مصاريف دورية', value: 'sinking' },
        ]}
        value={type}
        onChange={setType}
      />

      <FormField label="الاسم">
        <FormInput
          value={name}
          onChangeText={setName}
          placeholder={type === 'emergency' ? 'صندوق الطوارئ' : type === 'sinking' ? 'مثال: تأمين العربية' : 'مثال: الجواز'}
        />
      </FormField>

      <FormField label={type === 'sinking' ? 'المبلغ كل دورة' : 'المبلغ المستهدف'}>
        <AmountInput value={targetText} onChangeText={setTargetText} currency={currency} accessibilityLabel="المبلغ المستهدف" />
      </FormField>

      {type === 'emergency' &&
        (emergency3 !== null && emergency6 !== null ? (
          <View style={styles.suggestions}>
            <Button
              label={`استخدم المقترح (٣ شهور): ${formatMoney(emergency3, 'EGP')}`}
              variant="tertiary"
              onPress={() => setTargetText(String(Math.round(emergency3)))}
            />
            <Button
              label={`استخدم المقترح (٦ شهور): ${formatMoney(emergency6, 'EGP')}`}
              variant="tertiary"
              onPress={() => setTargetText(String(Math.round(emergency6)))}
            />
          </View>
        ) : (
          <AppText variant="caption" color="textSecondary" style={styles.hint}>
            سجّل مصروفاتك الأساسية شهر على الأقل عشان نقترح رقم.
          </AppText>
        ))}

      {type === 'goal' && (
        <FormField label="الموعد النهائي">
          <FutureDateField value={deadline} onChange={setDeadline} clearLabel="بدون موعد" />
        </FormField>
      )}

      {type === 'sinking' && (
        <>
          <FormField label="التكرار">
            <Segment<SinkingFrequency>
              options={(Object.keys(FREQUENCY_LABELS) as SinkingFrequency[]).map((value) => ({
                value,
                label: FREQUENCY_LABELS[value],
              }))}
              value={frequency}
              onChange={setFrequency}
            />
          </FormField>
          <FormField
            label="تاريخ الاستحقاق القادم"
            helper={sinkingMonthly !== null ? `المقترح شهرياً: ${formatMoney(sinkingMonthly, currency)}` : undefined}>
            <FutureDateField value={nextDueDate} onChange={setNextDueDate} />
          </FormField>
        </>
      )}

      <FormField label="الأولوية (١ = الأهم)">
        <FormInput
          value={priorityText}
          onChangeText={setPriorityText}
          keyboardType="number-pad"
          placeholder={toArabicDigits(String(nextPriority))}
        />
      </FormField>

      {goldOptions.length > 0 && (
        <FormField label="ذهب مربوط بالصندوق">
          <ChipRow>
            {goldOptions.map((h) => (
              <Chip
                key={h.id}
                label={`${h.name} · ${formatNumber(holdingValueEGP(state, h), 0)} ج.م`}
                selected={linked.includes(h.id)}
                onPress={() => toggleLinked(h.id)}
              />
            ))}
          </ChipRow>
        </FormField>
      )}

      {fund && (
        <>
          <FormField label={`المبلغ المخصص نقداً (${currencySymbol(currency)})`}>
            <FormInput value={cashText} onChangeText={setCashText} keyboardType="decimal-pad" />
          </FormField>
          <Card variant="subtle" style={styles.preview}>
            <AppText variant="caption" color="textSecondary">
              فلوس متاحة للتخطيط بعد الحفظ
            </AppText>
            <Money amount={previewEGP} currency="EGP" size="md" tone={previewEGP < -0.005 ? 'danger' : 'default'} />
          </Card>

          <View style={styles.delete}>
            <Button label="احذف الصندوق" variant="destructive" icon="delete-outline" block onPress={handleDelete} />
          </View>
        </>
      )}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  suggestions: { marginTop: space.sm, gap: space.xs },
  hint: { marginTop: space.sm },
  preview: { marginTop: space.lg, gap: space.xs },
  delete: { marginTop: space.xxxl },
});
