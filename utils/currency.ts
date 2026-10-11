import type { CurrencyCode, RatesSnapshot } from '@/store/types';

// Conversion rule (see "Currency" in docs/TECHNICAL.md): amounts that already happened are
// converted with rates from their own moment and never move when settings rates change; only
// CURRENT valuations (balances, gold, net worth) and amounts being entered now use today's rates.

// How many EGP one unit of `currency` is worth at the given rates.
export function rateToEGP(currency: CurrencyCode, rates: RatesSnapshot): number {
  switch (currency) {
    case 'EGP':
      return 1;
    case 'SAR':
      return rates.SAR_EGP;
    case 'USD':
      return rates.USD_EGP;
  }
}

export function toEGP(amount: number, currency: CurrencyCode, rates: RatesSnapshot): number {
  return amount * rateToEGP(currency, rates);
}

export function fromEGP(
  amountEGP: number,
  targetCurrency: CurrencyCode,
  rates: RatesSnapshot
): number {
  return amountEGP / rateToEGP(targetCurrency, rates);
}

// `amount` from one currency to another with both legs at the same `rates`. The same currency
// comes back untouched (no rate is involved, so not even float noise).
export function convertCurrency(amount: number, from: CurrencyCode, to: CurrencyCode, rates: RatesSnapshot): number {
  return from === to ? amount : fromEGP(toEGP(amount, from, rates), to, rates);
}

// The rates worth keeping with a record made now.
export function snapshotRates(rates: RatesSnapshot): RatesSnapshot {
  return { SAR_EGP: rates.SAR_EGP, USD_EGP: rates.USD_EGP };
}

// An amount that already happened, in another currency. Same currency: unchanged. Otherwise the
// source leg uses `sourceRateToEGP` (the record's own rate) and the target leg the record's
// `snapshot`. Records made before snapshots existed fall back to `currentRates` for the target
// leg — a known approximation: those amounts still move with today's rates.
export function historicalAmountIn(
  amount: number,
  from: CurrencyCode,
  to: CurrencyCode,
  sourceRateToEGP: number,
  snapshot: RatesSnapshot | undefined,
  currentRates: RatesSnapshot
): number {
  return from === to ? amount : fromEGP(amount * sourceRateToEGP, to, snapshot ?? currentRates);
}
