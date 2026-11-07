import { currencySymbol } from '@/utils/formatters';

// Pure helpers of the exchange form (no React Native; unit-tested).
//
// The received amount of an exchange is what the user actually got. The market rate is only a labelled
// suggestion beside it: it never fills the field by itself and is never saved.

// A rate further than this from the market's (either way) gets a soft warning. Never blocks saving.
export const RATE_WARNING_PCT = 0.05;

// Units of the received currency per unit sent; null when either amount is missing or not positive.
export function impliedRate(sent: number | null, received: number | null): number | null {
  if (sent === null || received === null || !(sent > 0) || !(received > 0)) return null;
  return received / sent;
}

// How far the implied rate is from the market's, as a fraction of the market's (0.08 = 8% higher).
export function rateDeviation(implied: number, market: number): number | null {
  return market > 0 && implied > 0 ? implied / market - 1 : null;
}

export function isFarFromMarket(implied: number, market: number): boolean {
  const deviation = rateDeviation(implied, market);
  return deviation !== null && Math.abs(deviation) > RATE_WARNING_PCT;
}

// 12.4 · 0.0803 · 1,250.5: five significant digits, no trailing zeros.
export function formatRate(rate: number): string {
  return String(Number(rate.toPrecision(5)));
}

// "1 ر.س = 12.4 ج.م"
export function rateLine(fromCurrency: string, toCurrency: string, rate: number): string {
  return `1 ${currencySymbol(fromCurrency)} = ${formatRate(rate)} ${currencySymbol(toCurrency)}`;
}
