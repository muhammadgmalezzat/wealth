import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { FormSheet } from '@/components/ui/FormSheet';
import { formatMoney } from '@/components/ui/formatMoney';
import { ListGroup, ListRow } from '@/components/ui/ListRow';
import { Money } from '@/components/ui/Money';
import { Segment } from '@/components/ui/Segment';
import { CURRENCY_NAMES_AR } from '@/constants/currencies';
import { colors, space, weight } from '@/constants/theme';
import {
  defaultCoverFundId,
  fundAllocatedIn,
  fundsByPriority,
  planCover,
  unassignedSummary,
} from '@/store/selectors';
import type { CurrencyCode } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { runAction } from '@/utils/runAction';

interface CoverSheetProps {
  onClose: () => void;
}

// "غطّيها": take cash back from funds to cover spending that ate into allocated money. A
// shortfall is in one currency (the money that was spent), so it is covered by funds' cash in
// that same currency; with several short currencies, pick which one to cover.
export function CoverSheet({ onClose }: CoverSheetProps) {
  const state = useFinanceStore();
  const { deficits } = unassignedSummary(state);
  const options: CurrencyCode[] = deficits.map((d) => d.currency);
  if (options.length === 0) options.push('EGP');
  const [picked, setPicked] = useState<CurrencyCode | null>(null);
  const currency = picked && options.includes(picked) ? picked : options[0];
  const deficit = deficits.find((d) => d.currency === currency)?.amount ?? 0;

  // Lowest priority first: those are the first candidates to give money back.
  const candidates = [...fundsByPriority(state)].reverse().filter((f) => fundAllocatedIn(state, f.id, currency) > 0);
  const initialSelection = (c: CurrencyCode) => {
    const first = defaultCoverFundId(state, c);
    return first ? [first] : [];
  };
  const [selected, setSelected] = useState<string[]>(() => initialSelection(currency));

  const plan = planCover(state, selected, currency);
  const withdrawalFor = (fundId: string) => plan.withdrawals.find((w) => w.fundId === fundId)?.amount;
  const covered = plan.withdrawals.reduce((total, w) => total + w.amount, 0);
  const remaining = Math.max(0, deficit - covered);

  const toggle = (fundId: string) =>
    setSelected((prev) => (prev.includes(fundId) ? prev.filter((id) => id !== fundId) : [...prev, fundId]));

  const changeCurrency = (next: CurrencyCode) => {
    setPicked(next);
    setSelected(initialSelection(next));
  };

  const handleSave = () => {
    if (runAction('تعذّرت التغطية', () => state.withdrawMany(plan.withdrawals, 'تغطية مصروف'))) onClose();
  };

  return (
    <FormSheet visible title="غطّي الفرق" onCancel={onClose} onSave={handleSave}>
      {options.length > 1 && (
        <View style={styles.currency}>
          <Segment<CurrencyCode>
            options={options.map((c) => ({ label: CURRENCY_NAMES_AR[c], value: c }))}
            value={currency}
            onChange={changeCurrency}
          />
        </View>
      )}
      <Card style={styles.summary}>
        <AppText variant="secondary" color="danger">
          استخدمت جزء من فلوس الصناديق.
        </AppText>
        <Money amount={deficit} currency={currency} size="md" tone="danger" />
      </Card>

      <AppText variant="secondary" color="textSecondary" style={styles.hint}>
        غطّي الفرق من الصناديق دي:
      </AppText>
      {candidates.length === 0 ? (
        <AppText variant="secondary" color="textSecondary">
          مفيش صناديق فيها فلوس نقدية بـ{CURRENCY_NAMES_AR[currency]}.
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
                subtitle={`نقداً: ${formatMoney(fundAllocatedIn(state, fund.id, currency), currency)}`}
                subtitleLines={1}
                icon={isSelected ? 'check-circle' : 'radio-button-unchecked'}
                iconTone={isSelected ? 'ok' : 'neutral'}
                trailing={take ? <Money amount={-take} currency={currency} showSign align="left" /> : undefined}
                onPress={() => toggle(fund.id)}
                accessibilityLabel={`${fund.name}${isSelected ? '، مختار' : ''}`}
              />
            );
          })}
        </ListGroup>
      )}

      <AppText variant="secondary" color={remaining > 0.005 ? 'warning' : 'primary700'} style={styles.result}>
        {remaining > 0.005
          ? `لسه فاضل ${formatMoney(remaining, currency)}، اختار صندوق تاني.`
          : 'هيتغطى المبلغ بالكامل.'}
      </AppText>
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  currency: { marginBottom: space.md },
  summary: { gap: space.xs, backgroundColor: colors.dangerSurface, borderColor: colors.dangerSurface },
  hint: { marginTop: space.lg, marginBottom: space.sm },
  result: { marginTop: space.lg, fontWeight: weight.semibold },
});
