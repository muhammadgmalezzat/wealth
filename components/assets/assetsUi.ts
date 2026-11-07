import { formatMoney } from '@/components/ui/formatMoney';
import { countriesInUse } from '@/store/selectors';
import type { Account, CountryCode, Holding } from '@/store/types';

// Pure UI helpers for the Assets screen (no React Native; unit-tested).

export const ACCOUNT_TYPE_ICONS: Record<Account['type'], 'account-balance' | 'payments' | 'account-balance-wallet'> = {
  bank: 'account-balance',
  cash: 'payments',
  wallet: 'account-balance-wallet',
};

// "سبيكة 5 جم — عيار 24"; currency holdings keep their name.
export function holdingTitle(holding: Holding): string {
  if (holding.type !== 'gold') return holding.name;
  const name = holding.name.trim() || `${holding.weightGrams} جم`;
  return `${name} — عيار ${holding.karat}`;
}

// The value difference as plain text with a sign: "+ج.م 1,200" / "−ج.م 300". Never colored.
export function signedDifference(amountEGP: number): string {
  return formatMoney(amountEGP, 'EGP', true);
}

// Active accounts grouped by country (registry order first), then archived ones. Countries without
// an active account are left out.
export function groupAccounts(accounts: Account[]): {
  byCountry: { country: CountryCode; accounts: Account[] }[];
  archived: Account[];
} {
  const active = accounts.filter((a) => !a.archived);
  return {
    byCountry: countriesInUse({ accounts, holdings: [], liabilities: [] })
      .map((country) => ({ country, accounts: active.filter((a) => a.country === country) }))
      .filter((group) => group.accounts.length > 0),
    archived: accounts.filter((a) => a.archived),
  };
}
