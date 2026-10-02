import type { CurrencyCode, ExchangeRates } from '@/store/types';

// How many EGP one unit of `currency` is worth at the given rates.
export function rateToEGP(currency: CurrencyCode, rates: ExchangeRates): number {
  switch (currency) {
    case 'EGP':
      return 1;
    case 'SAR':
      return rates.SAR_EGP;
    case 'USD':
      return rates.USD_EGP;
  }
}

export function toEGP(amount: number, currency: CurrencyCode, rates: ExchangeRates): number {
  return amount * rateToEGP(currency, rates);
}

export function fromEGP(
  amountEGP: number,
  targetCurrency: CurrencyCode,
  rates: ExchangeRates
): number {
  return amountEGP / rateToEGP(targetCurrency, rates);
}
