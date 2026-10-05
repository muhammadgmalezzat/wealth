import type { CurrencyCode } from '@/store/types';
import { currencySymbol, formatCurrency } from '@/utils/formatters';

// Pure money formatting shared by <Money> and plain-text messages (no React Native imports, so
// node tests can use it).

// Visual order "ر.س −1,250" in any surrounding text:
// - LRI … PDI isolates the amount, so neighbouring Arabic words can't reorder it;
// - LRM before the sign makes "−1,250" resolve left-to-right. Without it, digits that follow the
//   Arabic symbol are treated as Arabic numbers and the minus ends up on their right ("1,250−").
const LRI = '\u2066';
const PDI = '\u2069';
const LRM = '\u200e';

export function formatMoney(amount: number, currency: CurrencyCode, showSign = false): string {
  const negative = amount < 0 && Math.abs(amount) >= 0.005;
  const sign = showSign ? (Math.abs(amount) < 0.005 ? '' : amount > 0 ? '+' : '−') : negative ? '−' : '';
  const symbol = currencySymbol(currency);
  // formatCurrency gives "<symbol> <number>"; keep its number formatting.
  const number = formatCurrency(Math.abs(amount), currency).slice(symbol.length + 1);
  return `${LRI}${symbol} ${LRM}${sign}${number}${PDI}`;
}
