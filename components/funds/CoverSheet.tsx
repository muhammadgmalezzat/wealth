import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { FormSheet } from '@/components/ui/FormSheet';
import { formatMoney } from '@/components/ui/formatMoney';
import { ListGroup, ListRow } from '@/components/ui/ListRow';
import { Money } from '@/components/ui/Money';
import { colors, space } from '@/constants/theme';
import {
  defaultCoverFundId,
  fundAllocated,
  fundsByPriority,
  planCover,
  unassignedEGP,
} from '@/store/selectors';
import { useFinanceStore } from '@/store/useFinanceStore';
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
    <FormSheet visible title="غطّي الفرق" onCancel={onClose} onSave={handleSave}>
      <Card style={styles.summary}>
        <AppText variant="secondary" color="danger">
          استخدمت جزء من فلوس الصناديق.
        </AppText>
        <Money amount={deficitEGP} currency="EGP" size="md" tone="danger" />
      </Card>

      <AppText variant="secondary" color="textSecondary" style={styles.hint}>
        غطّي الفرق من الصناديق دي:
      </AppText>
      {candidates.length === 0 ? (
        <AppText variant="secondary" color="textSecondary">
          مفيش صناديق فيها فلوس نقدية.
        </AppText>
      ) : (
        <ListGroup>
          {candidates.map((fund) => {
            const isSelected = selected.includes(fund.id);
            const take = withdrawalFor(fund.id);
            return (
              <ListRow
                key={fund.id}
                title={fund.name}
                subtitle={`نقداً: ${formatMoney(fundAllocated(state, fund.id), fund.currency)}`}
                subtitleLines={1}
                icon={isSelected ? 'check-circle' : 'radio-button-unchecked'}
                iconTone={isSelected ? 'ok' : 'neutral'}
                trailing={take ? <Money amount={-take} currency={fund.currency} showSign align="left" /> : undefined}
                onPress={() => toggle(fund.id)}
                accessibilityLabel={`${fund.name}${isSelected ? '، مختار' : ''}`}
              />
            );
          })}
        </ListGroup>
      )}

      <AppText variant="secondary" color={plan.remainingEGP > 0.005 ? 'warning' : 'primary700'} style={styles.result}>
        {plan.remainingEGP > 0.005
          ? `لسه فاضل ${formatMoney(plan.remainingEGP, 'EGP')}، اختار صندوق تاني.`
          : 'هيتغطى المبلغ بالكامل.'}
      </AppText>
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  summary: { gap: space.xs, backgroundColor: colors.dangerSurface, borderColor: colors.dangerSurface },
  hint: { marginTop: space.lg, marginBottom: space.sm },
  result: { marginTop: space.lg, fontWeight: '600' },
});
