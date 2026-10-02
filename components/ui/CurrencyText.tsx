import { Text, TextStyle } from 'react-native';
import type { CurrencyCode } from '@/store/types';
import { formatCurrency } from '@/utils/formatters';

interface CurrencyTextProps {
  amount: number;
  currency: CurrencyCode;
  style?: TextStyle;
}

export function CurrencyText({ amount, currency, style }: CurrencyTextProps) {
  return <Text style={style}>{formatCurrency(amount, currency)}</Text>;
}
