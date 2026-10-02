import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { FormSheet } from '@/components/ui/FormSheet';
import { Colors, FinanceColors } from '@/constants/theme';
import {
  defaultCoverFundId,
  fundAllocated,
  fundsByPriority,
  planCover,
  unassignedEGP,
} from '@/store/selectors';
import { useFinanceStore } from '@/store/useFinanceStore';
import { formatCurrency } from '@/utils/formatters';
import { runAction } from '@/utils/runAction';

interface CoverSheetProps {
  onClose: () => void;
}

// "غطّيها": take cash back from funds to cover spending that ate into allocated money.
export function CoverSheet({ onClose }: CoverSheetProps) {
  const state = useFinanceStore();
  const deficitEGP = Math.max(0, -unassignedEGP(state));
  // Lowest priority first: those are the first candidates to give money back.
  const candidates = [...fundsByPriority(state)].reverse().filter((f) => fundAllocated(state, f.id) > 0);
  const [selected, setSelected] = useState<string[]>(() => {
    const first = defaultCoverFundId(state);
    return first ? [first] : [];
  });

  const plan = planCover(state, selected);
  const withdrawalFor = (fundId: string) => plan.withdrawals.find((w) => w.fundId === fundId)?.amount;

  const toggle = (fundId: string) =>
    setSelected((prev) => (prev.includes(fundId) ? prev.filter((id) => id !== fundId) : [...prev, fundId]));

  const handleSave = () => {
    if (runAction('تعذّرت التغطية', () => state.withdrawMany(plan.withdrawals, 'تغطية مصروف'))) onClose();
  };

  return (
    <FormSheet visible title="غطّي المصروف" onCancel={onClose} onSave={handleSave}>
      <View style={styles.summary}>
        <Text style={styles.summaryLabel}>صرفت من فلوس مخصصة لصناديق</Text>
        <Text style={styles.summaryAmount}>{formatCurrency(deficitEGP, 'EGP')}</Text>
      </View>

      <Text style={styles.hint}>اختار الصناديق اللي هتسحب منها:</Text>
      {candidates.length === 0 && <Text style={styles.hint}>مفيش صناديق فيها فلوس نقدية</Text>}
      {candidates.map((fund) => {
        const isSelected = selected.includes(fund.id);
        const take = withdrawalFor(fund.id);
        return (
          <TouchableOpacity
            key={fund.id}
            style={[styles.row, isSelected && styles.rowSelected]}
            onPress={() => toggle(fund.id)}
            activeOpacity={0.8}>
            <Text style={styles.take}>{take ? `−${formatCurrency(take, fund.currency)}` : ''}</Text>
            <View style={styles.rowText}>
              <Text style={styles.name}>{fund.name}</Text>
              <Text style={styles.hint}>
                نقداً: {formatCurrency(fundAllocated(state, fund.id), fund.currency)}
              </Text>
            </View>
          </TouchableOpacity>
        );
      })}

      <Text style={[styles.result, plan.remainingEGP > 0.005 && { color: FinanceColors.expense }]}>
        {plan.remainingEGP > 0.005
          ? `لسه فاضل ${formatCurrency(plan.remainingEGP, 'EGP')} — اختار صندوق تاني`
          : 'هيتغطى المبلغ بالكامل'}
      </Text>
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  summary: {
    padding: 14,
    borderRadius: 10,
    backgroundColor: FinanceColors.expense + '12',
    alignItems: 'flex-end',
    gap: 4,
    marginBottom: 14,
  },
  summaryLabel: {
    fontSize: 13,
    color: FinanceColors.expense,
  },
  summaryAmount: {
    fontSize: 22,
    fontWeight: '700',
    color: FinanceColors.expense,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: FinanceColors.progressTrack,
  },
  rowSelected: {
    borderColor: Colors.light.tint,
    backgroundColor: Colors.light.tint + '10',
  },
  rowText: {
    flex: 1,
    alignItems: 'flex-end',
    gap: 2,
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.light.text,
  },
  take: {
    fontSize: 14,
    fontWeight: '600',
    color: FinanceColors.expense,
  },
  hint: {
    fontSize: 12,
    color: Colors.light.icon,
    textAlign: 'right',
  },
  result: {
    marginTop: 16,
    fontSize: 13,
    fontWeight: '600',
    color: FinanceColors.income,
    textAlign: 'right',
  },
});
