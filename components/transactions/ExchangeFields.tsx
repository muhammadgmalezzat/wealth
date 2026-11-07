import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { FormInput } from '@/components/ui/FormSheet';
import { formatMoney } from '@/components/ui/formatMoney';
import { colors, radius, space } from '@/constants/theme';
import type { CurrencyCode } from '@/store/types';
import { currencySymbol } from '@/utils/formatters';

import { formatRate, impliedRate, isFarFromMarket, rateLine } from './exchangeUi';

interface ExchangeFieldsProps {
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  // The amount sent (null while empty or invalid).
  sent: number | null;
  receivedText: string;
  onReceivedText: (text: string) => void;
  // How much of the received currency one unit sent is worth today (a suggestion only).
  marketRate: number;
  // The market value of the amount sent, in the received currency, rounded to its decimals.
  suggestedReceived: number | null;
  receivedValue: number | null;
}

// What arrived in an exchange: required, typed by the user. Under it: the rate it implies, and the market
// rate as a labelled suggestion (tap to use it) with a soft warning when the two differ by more than 5%.
export function ExchangeFields({
  fromCurrency,
  toCurrency,
  sent,
  receivedText,
  onReceivedText,
  marketRate,
  suggestedReceived,
  receivedValue,
}: ExchangeFieldsProps) {
  const implied = impliedRate(sent, receivedValue);
  const far = implied !== null && isFarFromMarket(implied, marketRate);
  return (
    <View style={styles.wrap}>
      <FormField label={`المبلغ المستلم (${currencySymbol(toCurrency)})`} helper="اكتب المبلغ اللي وصلك فعلاً بعد التحويل.">
        <FormInput value={receivedText} onChangeText={onReceivedText} placeholder="0" keyboardType="decimal-pad" />
      </FormField>
      {implied !== null && (
        <AppText variant="caption" color="textSecondary" style={styles.line}>
          سعر الصرف الفعلي: {rateLine(fromCurrency, toCurrency, implied)}
        </AppText>
      )}
      {far && (
        <View style={styles.warning}>
          <AppText variant="caption" color="warning">
            السعر ده بعيد عن سعر السوق الحالي ({formatRate(marketRate)}) بأكتر من ٥٪. راجع المبلغ المستلم.
          </AppText>
        </View>
      )}
      <View style={styles.suggestion}>
        <AppText variant="caption" color="textSecondary" style={styles.line}>
          اقتراح بسعر السوق الحالي ({rateLine(fromCurrency, toCurrency, marketRate)}) — مش بيتحفظ لوحده
        </AppText>
        {suggestedReceived !== null && (
          <Button
            label={`استخدم ${formatMoney(suggestedReceived, toCurrency)}`}
            variant="tertiary"
            onPress={() => onReceivedText(String(suggestedReceived))}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  line: { textAlign: 'right' },
  warning: { backgroundColor: colors.warningSurface, borderRadius: radius.md, padding: space.sm },
  suggestion: { gap: space.xxs, alignItems: 'flex-end' },
});
