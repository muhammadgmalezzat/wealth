// The currency registry: DATA, not code. Adding a currency = adding an entry here (and enabling it in
// settings). `decimals` is the ISO 4217 minor-unit exponent and drives rounding, parsing and display.

export interface CurrencyMeta {
  code: string;
  symbol: string;
  nameAr: string;
  nameEn: string;
  decimals: number;
}

export type CurrencyRegistry = Readonly<Record<string, CurrencyMeta>>;

export const CURRENCY_REGISTRY: CurrencyRegistry = {
  EGP: { code: 'EGP', symbol: 'ج.م', nameAr: 'جنيه', nameEn: 'Egyptian Pound', decimals: 2 },
  SAR: { code: 'SAR', symbol: 'ر.س', nameAr: 'ريال', nameEn: 'Saudi Riyal', decimals: 2 },
  USD: { code: 'USD', symbol: '$', nameAr: 'دولار', nameEn: 'US Dollar', decimals: 2 },
};

export class UnknownCurrencyError extends Error {
  override name = 'UnknownCurrencyError';
  readonly code: string;

  constructor(code: string) {
    super(`Unknown currency "${code}": add it to the currency registry`);
    this.code = code;
  }
}

export const isKnownCurrency = (code: string, registry: CurrencyRegistry = CURRENCY_REGISTRY): boolean =>
  Object.prototype.hasOwnProperty.call(registry, code);

export function currencyMeta(code: string, registry: CurrencyRegistry = CURRENCY_REGISTRY): CurrencyMeta {
  if (!isKnownCurrency(code, registry)) throw new UnknownCurrencyError(code);
  return registry[code];
}

export const decimalsOf = (code: string, registry: CurrencyRegistry = CURRENCY_REGISTRY): number =>
  currencyMeta(code, registry).decimals;
