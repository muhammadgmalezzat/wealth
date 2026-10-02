import type { CurrencyCode, ExchangeRates } from '@/store/types';

export function toEGP(
  amount: number,
  currency: CurrencyCode,
  rates: ExchangeRates
): number {
  switch (currency) {
    case 'EGP':
      return amount;
    case 'SAR':
      return amount * rates.SAR_EGP;
    case 'USD':
      return amount * rates.USD_EGP;
  }
}

export function fromEGP(
  amountEGP: number,
  targetCurrency: CurrencyCode,
  rates: ExchangeRates
): number {
  switch (targetCurrency) {
    case 'EGP':
      return amountEGP;
    case 'SAR':
      return amountEGP / rates.SAR_EGP;
    case 'USD':
      return amountEGP / rates.USD_EGP;
  }
}
