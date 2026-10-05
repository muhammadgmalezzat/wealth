import { formatMoney } from '@/components/ui/formatMoney';
import type { Account, Holding, Location } from '@/store/types';

// Pure UI helpers for the Assets screen (no React Native; unit-tested).

export const LOCATION_LABELS: Record<Location, string> = { EG: 'مصر', SA: 'السعودية' };

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

// Active accounts grouped by location (Egypt first), then archived ones.
export function groupAccounts(accounts: Account[]): { EG: Account[]; SA: Account[]; archived: Account[] } {
  return {
    EG: accounts.filter((a) => !a.archived && a.location === 'EG'),
    SA: accounts.filter((a) => !a.archived && a.location === 'SA'),
    archived: accounts.filter((a) => a.archived),
  };
}
