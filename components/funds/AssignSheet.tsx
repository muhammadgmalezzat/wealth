import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { FormInput, FormSheet } from '@/components/ui/FormSheet';
import { Colors, FinanceColors } from '@/constants/theme';
import {
  fundAmountsEGP,
  fundsByPriority,
  fundSuggestedMonthly,
  suggestAllocation,
  unassignedEGP,
  type FundAmount,
} from '@/store/selectors';
import { useFinanceStore } from '@/store/useFinanceStore';
import { formatCurrency } from '@/utils/formatters';
import { parseAmount } from '@/utils/parseAmount';
import { runAction } from '@/utils/runAction';

interface AssignSheetProps {
  onClose: () => void;
}

// "وزّعها": split unassigned money across funds in one atomic save.
export function AssignSheet({ onClose }: AssignSheetProps) {
  const state = useFinanceStore();
  const funds = fundsByPriority(state);
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  // Non-empty inputs only; unparseable ones become NaN so the store reports them in Arabic.
  const entries: FundAmount[] = funds
    .filter((f) => amounts[f.id]?.trim())
    .map((f) => ({ fundId: f.id, amount: parseAmount(amounts[f.id]) ?? NaN }));
  const remainingEGP =
    unassignedEGP(state) - fundAmountsEGP(state, entries.filter((e) => Number.isFinite(e.amount)));

  const fillSuggested = () => {
    const next: Record<string, string> = {};
    for (const { fundId, amount } of suggestAllocation(state, unassignedEGP(state))) {
      next[fundId] = String(amount);
    }
    setAmounts(next);
  };

  const handleSave = () => {
    if (runAction('تعذّر التوزيع', () => state.allocateMany(entries, 'توزيع'))) onClose();
  };

  return (
    <FormSheet visible title="وزّع الفلوس" onCancel={onClose} onSave={handleSave}>
      <View style={styles.summary}>
        <Text style={styles.summaryLabel}>فلوس بدون وظيفة</Text>
        <Text style={[styles.summaryAmount, remainingEGP < -0.005 && { color: FinanceColors.expense }]}>
          {formatCurrency(remainingEGP, 'EGP')}
        </Text>
      </View>

      <TouchableOpacity style={styles.suggestBtn} onPress={fillSuggested} activeOpacity={0.8}>
        <Text style={styles.suggestText}>وزّع المقترح</Text>
      </TouchableOpacity>

      {funds.length === 0 && <Text style={styles.hint}>أنشئ صندوقاً أولاً</Text>}
      {funds.map((fund) => (
        <View key={fund.id} style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.name}>{fund.name}</Text>
            <Text style={styles.hint}>
              المقترح: {formatCurrency(fundSuggestedMonthly(state, fund.id), fund.currency)}
            </Text>
          </View>
          <FormInput
            value={amounts[fund.id] ?? ''}
            onChangeText={(text) => setAmounts((prev) => ({ ...prev, [fund.id]: text }))}
            placeholder="0"
            keyboardType="decimal-pad"
            style={styles.input}
          />
        </View>
      ))}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  summary: {
    padding: 14,
    borderRadius: 10,
    backgroundColor: FinanceColors.cardBackground,
    alignItems: 'flex-end',
    gap: 4,
  },
  summaryLabel: {
    fontSize: 13,
    color: Colors.light.icon,
  },
  summaryAmount: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.light.text,
  },
  suggestBtn: {
    marginVertical: 14,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.light.tint,
  },
  suggestText: {
    color: Colors.light.tint,
    fontWeight: '700',
    fontSize: 15,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
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
  hint: {
    fontSize: 12,
    color: Colors.light.icon,
    textAlign: 'right',
  },
  input: {
    width: 120,
  },
});
