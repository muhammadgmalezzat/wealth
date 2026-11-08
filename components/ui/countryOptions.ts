import { countryCodes, countryName } from '@/constants/countries';

// Segment options for choosing a country, straight from the country registry.
export const COUNTRY_OPTIONS: { label: string; value: string }[] = countryCodes().map((code) => ({
  label: countryName(code),
  value: code,
}));

// The country a new account / holding starts on (the registry's first).
export const DEFAULT_COUNTRY: string = countryCodes()[0];
