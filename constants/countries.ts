// The country registry: DATA, not code. Countries are ISO 3166-1 alpha-2 codes; an account, holding or
// liability sits in one. Adding a country = adding an entry here.

export interface CountryMeta {
  code: string;
  nameAr: string;
  // The currency usually held there (a hint for new accounts; never enforced).
  defaultCurrency?: string;
}

export type CountryRegistry = Readonly<Record<string, CountryMeta>>;

export const COUNTRY_REGISTRY: CountryRegistry = {
  EG: { code: 'EG', nameAr: 'مصر', defaultCurrency: 'EGP' },
  SA: { code: 'SA', nameAr: 'السعودية', defaultCurrency: 'SAR' },
};

export const isKnownCountry = (code: string, registry: CountryRegistry = COUNTRY_REGISTRY): boolean =>
  Object.prototype.hasOwnProperty.call(registry, code);

// Registry order (Egypt first), for lists.
export const countryCodes = (registry: CountryRegistry = COUNTRY_REGISTRY): string[] => Object.keys(registry);

// The Arabic name; an unknown code shows as itself, so data from a newer registry never crashes a screen.
export const countryName = (code: string, registry: CountryRegistry = COUNTRY_REGISTRY): string =>
  registry[code]?.nameAr ?? code;
