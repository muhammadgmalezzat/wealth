import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AmountInput } from '@/components/ui/AmountInput';
import { AppText } from '@/components/ui/AppText';
import { FormField } from '@/components/ui/FormField';
import { FormInput, FormSheet } from '@/components/ui/FormSheet';
import { formatMoney } from '@/components/ui/formatMoney';
import { Segment } from '@/components/ui/Segment';
import { CURRENCIES, CURRENCY_NAMES_AR } from '@/constants/currencies';
import { space } from '@/constants/theme';
import { fundCashByCurrency, unassignedByCurrency } from '@/store/selectors';
import type { CurrencyCode, Fund } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { convertCurrency } from '@/utils/currency';
import { parseAmount } from '@/utils/parseAmount';
import { runAction } from '@/utils/runAction';

type Mode = 'allocate' | 'withdraw';

interface MoveMoneySheetProps {
  fund: Fund;
  // The side the sheet opens on; the segment can switch it.
  mode: Mode;
  onClose: () => void;
}

// Sets unassigned money aside for a fund ("إضافة") or returns fund cash to unassigned ("سحب").
// The money has a currency: 1000 SAR stays 1000 SAR whatever the rates do, and the fund counts
// it at today's rate. Adding defaults to the fund's currency; withdrawing offers the currencies
// the fund actually holds.
export function MoveMoneySheet({ fund, mode: initialMode, onClose }: MoveMoneySheetProps) {
  const state = useFinanceStore();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [picked, setPicked] = useState<CurrencyCode>(fund.currency);
  const [amountText, setAmountText] = useState('');
  const [note, setNote] = useState('');

  const cash = fundCashByCurrency(state, fund.id);
  const held = CURRENCIES.filter((c) => cash[c] > 0.005);
  // Withdrawing is only possible in a currency the fund holds.
  const options: readonly CurrencyCode[] = mode === 'allocate' ? CURRENCIES : held.length > 0 ? held : [fund.currency];
  const currency = options.includes(picked) ? picked : options[0];

  const available =
    mode === 'allocate' ? Math.max(0, unassignedByCurrency(state)[currency]) : Math.max(0, cash[currency]);
  const amount = parseAmount(amountText);
  const foreign = currency !== fund.currency;

  const handleSave = () => {
    const value = amount ?? NaN;
    const trimmed = note.trim() || undefined;
    const saved = runAction('تعذّر الحفظ', () =>
      mode === 'allocate'
        ? // allocateMany enforces that the money is actually unassigned, in this currency.
          state.allocateMany([{ fundId: fund.id, amount: value, currency }], trimmed)
        : state.withdrawFromFund(fund.id, value, trimmed, currency)
    );
    if (saved) onClose();
  };

  return (
    <FormSheet visible title={fund.name} onCancel={onClose} onSave={handleSave}>
      <Segment<Mode>
        options={[
          { label: 'إضافة', value: 'allocate' },
          { label: 'سحب', value: 'withdraw' },
        ]}
        value={mode}
        onChange={setMode}
      />
      {options.length > 1 && (
        <View style={styles.currency}>
          <Segment<CurrencyCode>
            options={options.map((c) => ({ label: CURRENCY_NAMES_AR[c], value: c }))}
            value={currency}
            onChange={setPicked}
          />
        </View>
      )}
      <AmountInput
        value={amountText}
        onChangeText={setAmountText}
        currency={currency}
        autoFocus
        hint={{
          tone: 'neutral',
          text: `${mode === 'allocate' ? 'المتاح للتخطيط' : 'في الصندوق نقداً'}: ${formatMoney(available, currency)}`,
        }}
      />
      {foreign && amount !== null && (
        <AppText variant="caption" color="textSecondary" align="center">
          بسعر النهارده ≈ {formatMoney(convertCurrency(amount, currency, fund.currency, state.settings.exchangeRates), fund.currency)} في الصندوق
        </AppText>
      )}
      <View style={styles.note}>
        <FormField label="ملاحظة (اختياري)">
          <FormInput value={note} onChangeText={setNote} />
        </FormField>
      </View>
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  currency: { marginTop: space.md },
  note: { marginTop: space.sm },
});
