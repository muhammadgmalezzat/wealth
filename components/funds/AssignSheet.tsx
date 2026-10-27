import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormInput, FormSheet } from '@/components/ui/FormSheet';
import { formatMoney } from '@/components/ui/formatMoney';
import { ListGroup, ListRow } from '@/components/ui/ListRow';
import { Segment } from '@/components/ui/Segment';
import { CURRENCY_NAMES_AR } from '@/constants/currencies';
import { space } from '@/constants/theme';
import {
  fundsByPriority,
  fundSuggestedMonthly,
  suggestAllocationIn,
  unassignedSummary,
  type FundAmount,
} from '@/store/selectors';
import type { CurrencyCode } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { convertCurrency, toEGP } from '@/utils/currency';
import { parseAmount } from '@/utils/parseAmount';
import { runAction } from '@/utils/runAction';

interface AssignSheetProps {
  onClose: () => void;
}

// "وزّعها": split unassigned money across funds in one atomic save. The money is in one
// currency at a time (the ones that have some left); each fund counts it at today's rate.
export function AssignSheet({ onClose }: AssignSheetProps) {
  const state = useFinanceStore();
  const rates = state.settings.exchangeRates;
  const funds = fundsByPriority(state);
  const unassigned = unassignedSummary(state);
  // Currencies with money left, the biggest first; EGP when there is none (nothing to split).
  const options: CurrencyCode[] = unassigned.surpluses
    .slice()
    .sort((a, b) => toEGP(b.amount, b.currency, rates) - toEGP(a.amount, a.currency, rates))
    .map((s) => s.currency);
  if (options.length === 0) options.push('EGP');

  const [picked, setPicked] = useState<CurrencyCode | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const currency = picked && options.includes(picked) ? picked : options[0];
  const available = Math.max(0, unassigned.byCurrency[currency]);

  // Non-empty inputs only; unparseable ones become NaN so the store reports them in Arabic.
  const entries: FundAmount[] = funds
    .filter((f) => amounts[f.id]?.trim())
    .map((f) => ({ fundId: f.id, amount: parseAmount(amounts[f.id]) ?? NaN, currency }));
  const assigning = entries.reduce((total, e) => total + (Number.isFinite(e.amount) ? e.amount : 0), 0);
  const remaining = available - assigning;

  const changeCurrency = (next: CurrencyCode) => {
    setPicked(next);
    // Amounts typed for one currency mean nothing in another.
    setAmounts({});
  };

  const fillSuggested = () => {
    const next: Record<string, string> = {};
    for (const { fundId, amount } of suggestAllocationIn(state, currency, available)) {
      next[fundId] = String(amount);
    }
    setAmounts(next);
  };

  const handleSave = () => {
    if (runAction('تعذّر التوزيع', () => state.allocateMany(entries, 'توزيع'))) onClose();
  };

  return (
    <FormSheet visible title="وزّع الفلوس" onCancel={onClose} onSave={handleSave}>
      {options.length > 1 && (
        <View style={styles.currency}>
          <Segment<CurrencyCode>
            options={options.map((c) => ({ label: CURRENCY_NAMES_AR[c], value: c }))}
            value={currency}
            onChange={changeCurrency}
          />
        </View>
      )}
      <Card variant="subtle" style={styles.summary}>
        <AppText variant="secondary" color="textSecondary">
          هتوزّع {formatMoney(assigning, currency)} من {formatMoney(available, currency)}
        </AppText>
        <AppText variant="caption" color={remaining < -0.005 ? 'danger' : 'textSecondary'}>
          {remaining < -0.005
            ? `أكتر من المتاح بـ ${formatMoney(-remaining, currency)}`
            : `هيفضل متاح للتخطيط: ${formatMoney(remaining, currency)}`}
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
                subtitle={`المقترح: ${formatMoney(
                  convertCurrency(fundSuggestedMonthly(state, fund.id), fund.currency, currency, rates),
                  currency
                )}`}
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
  currency: { marginBottom: space.md },
  summary: { gap: space.xs },
  hint: { marginTop: space.md },
  suggest: { marginVertical: space.md },
  input: { width: 110 },
});
