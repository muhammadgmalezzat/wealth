import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { FREQUENCY_LABELS } from '@/components/funds/labels';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { FutureDateField } from '@/components/ui/DateFields';
import { FieldLabel, FormInput, FormSheet } from '@/components/ui/FormSheet';
import { Segment } from '@/components/ui/Segment';
import { Colors, FinanceColors } from '@/constants/theme';
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
import { formatCurrency, formatNumber } from '@/utils/formatters';
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
          { label: 'طوارئ', value: 'emergency' },
          { label: 'هدف', value: 'goal' },
          { label: 'مصاريف دورية', value: 'sinking' },
        ]}
        value={type}
        onChange={setType}
      />

      <FieldLabel>الاسم</FieldLabel>
      <FormInput
        value={name}
        onChangeText={setName}
        placeholder={type === 'emergency' ? 'صندوق الطوارئ' : type === 'sinking' ? 'مثال: تأمين العربية' : 'مثال: الجواز'}
      />

      <FieldLabel>{type === 'sinking' ? 'المبلغ كل دورة' : 'المبلغ المستهدف'} ({currency})</FieldLabel>
      <FormInput value={targetText} onChangeText={setTargetText} placeholder="0" keyboardType="decimal-pad" />

      {type === 'emergency' &&
        (emergency3 !== null && emergency6 !== null ? (
          <View style={styles.suggestions}>
            <ChipRow>
              <Chip
                label={`٣ شهور: ${formatCurrency(emergency3, 'EGP')}`}
                onPress={() => setTargetText(String(Math.round(emergency3)))}
              />
              <Chip
                label={`٦ شهور: ${formatCurrency(emergency6, 'EGP')}`}
                onPress={() => setTargetText(String(Math.round(emergency6)))}
              />
            </ChipRow>
          </View>
        ) : (
          <Text style={styles.hint}>سجّل مصروفاتك الأساسية شهر على الأقل عشان نقترح رقم</Text>
        ))}

      {type === 'goal' && (
        <>
          <FieldLabel>الموعد النهائي</FieldLabel>
          <FutureDateField value={deadline} onChange={setDeadline} clearLabel="بدون موعد" />
        </>
      )}

      {type === 'sinking' && (
        <>
          <FieldLabel>التكرار</FieldLabel>
          <Segment<SinkingFrequency>
            options={(Object.keys(FREQUENCY_LABELS) as SinkingFrequency[]).map((value) => ({
              value,
              label: FREQUENCY_LABELS[value],
            }))}
            value={frequency}
            onChange={setFrequency}
          />
          <FieldLabel>تاريخ الاستحقاق القادم</FieldLabel>
          <FutureDateField value={nextDueDate} onChange={setNextDueDate} />
          {sinkingMonthly !== null && (
            <Text style={styles.hint}>المقترح شهرياً: {formatCurrency(sinkingMonthly, currency)}</Text>
          )}
        </>
      )}

      <FieldLabel>الأولوية (١ = الأهم)</FieldLabel>
      <FormInput
        value={priorityText}
        onChangeText={setPriorityText}
        keyboardType="number-pad"
        placeholder={toArabicDigits(String(nextPriority))}
      />

      {goldOptions.length > 0 && (
        <>
          <FieldLabel>ذهب مربوط بالصندوق</FieldLabel>
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
        </>
      )}

      {fund && (
        <>
          <FieldLabel>المبلغ المخصص نقداً ({currency})</FieldLabel>
          <FormInput value={cashText} onChangeText={setCashText} keyboardType="decimal-pad" />
          <View style={styles.preview}>
            <Text style={styles.previewLabel}>فلوس بدون وظيفة بعد الحفظ</Text>
            <Text
              style={[
                styles.previewAmount,
                { color: previewEGP < 0 ? FinanceColors.expense : Colors.light.text },
              ]}>
              {formatCurrency(previewEGP, 'EGP')}
            </Text>
          </View>

          <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} activeOpacity={0.8}>
            <Text style={styles.deleteText}>حذف الصندوق</Text>
          </TouchableOpacity>
        </>
      )}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  suggestions: {
    marginTop: 10,
  },
  hint: {
    fontSize: 12,
    color: Colors.light.icon,
    textAlign: 'right',
    marginTop: 8,
  },
  preview: {
    marginTop: 16,
    padding: 14,
    borderRadius: 10,
    backgroundColor: FinanceColors.cardBackground,
    alignItems: 'flex-end',
    gap: 4,
  },
  previewLabel: {
    fontSize: 13,
    color: Colors.light.icon,
  },
  previewAmount: {
    fontSize: 18,
    fontWeight: '700',
  },
  deleteBtn: {
    marginTop: 28,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: FinanceColors.expense + '15',
  },
  deleteText: {
    fontSize: 16,
    fontWeight: '700',
    color: FinanceColors.expense,
  },
});
