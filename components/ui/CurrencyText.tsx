import { Text, TextStyle } from 'react-native';
import { formatCurrency } from '@/utils/formatters';

interface CurrencyTextProps {
  amount: number;
  currency: 'EGP' | 'SAR' | 'USD';
  style?: TextStyle;
}

export function CurrencyText({ amount, currency, style }: CurrencyTextProps) {
  return <Text style={style}>{formatCurrency(amount, currency)}</Text>;
}
