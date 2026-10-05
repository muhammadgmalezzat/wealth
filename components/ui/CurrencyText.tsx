import type { StyleProp, TextStyle } from 'react-native';

import { colors } from '@/constants/theme';
import type { CurrencyCode } from '@/store/types';

import { AppText } from './AppText';
import { formatMoney } from './Money';

interface CurrencyTextProps {
  amount: number;
  currency: CurrencyCode;
  style?: StyleProp<TextStyle>;
}

/** Plain formatted amount (prefer `Money`). */
export function CurrencyText({ amount, currency, style }: CurrencyTextProps) {
  return (
    <AppText variant="moneyRow" style={[{ color: colors.text, fontVariant: ['tabular-nums'] }, style]}>
      {formatMoney(amount, currency)}
    </AppText>
  );
}
