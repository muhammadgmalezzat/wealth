import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormInput, FormSheet } from '@/components/ui/FormSheet';
import { formatMoney } from '@/components/ui/formatMoney';
import { ListGroup, ListRow } from '@/components/ui/ListRow';
import { space } from '@/constants/theme';
import {
  fundAmountsEGP,
  fundsByPriority,
  fundSuggestedMonthly,
  suggestAllocation,
  unassignedEGP,
  type FundAmount,
} from '@/store/selectors';
import { useFinanceStore } from '@/store/useFinanceStore';
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

  const available = unassignedEGP(state);
  const assigning = available - remainingEGP;

  return (
    <FormSheet visible title="وزّع الفلوس" onCancel={onClose} onSave={handleSave}>
      <Card variant="subtle" style={styles.summary}>
        <AppText variant="secondary" color="textSecondary">
          هتوزّع {formatMoney(assigning, 'EGP')} من {formatMoney(available, 'EGP')}
        </AppText>
        <AppText variant="caption" color={remainingEGP < -0.005 ? 'danger' : 'textSecondary'}>
          {remainingEGP < -0.005
            ? `أكتر من المتاح بـ ${formatMoney(-remainingEGP, 'EGP')}`
            : `هيفضل متاح للتخطيط: ${formatMoney(remainingEGP, 'EGP')}`}
        </AppText>
      </Card>

      {funds.length === 0 ? (
        <AppText variant="secondary" color="textSecondary" style={styles.hint}>
          أنشئ صندوق الأول.
        </AppText>
      ) : (
        <>
          <View style={styles.suggest}>
            <Button label="وزّع المقترح" variant="secondary" icon="auto-awesome" block onPress={fillSuggested} />
          </View>
          <ListGroup>
            {funds.map((fund) => (
              <ListRow
                key={fund.id}
                title={fund.name}
                subtitle={`المقترح: ${formatMoney(fundSuggestedMonthly(state, fund.id), fund.currency)}`}
                subtitleLines={1}
                trailing={
                  <FormInput
                    value={amounts[fund.id] ?? ''}
                    onChangeText={(text) => setAmounts((prev) => ({ ...prev, [fund.id]: text }))}
                    placeholder="0"
                    keyboardType="decimal-pad"
                    accessibilityLabel={`مبلغ ${fund.name}`}
                    style={styles.input}
                  />
                }
              />
            ))}
          </ListGroup>
        </>
      )}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  summary: { gap: space.xs },
  hint: { marginTop: space.md },
  suggest: { marginVertical: space.md },
  input: { width: 110 },
});
