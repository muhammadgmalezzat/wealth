import type { MigrationContext } from './migrations';
import type { FinanceState as FinanceStateV7, NetWorthBreakdown as NetWorthBreakdownV7 } from './legacy/types.v7';
import type { FinanceState, Holding, NetWorthBreakdown, NetWorthSnapshot } from './types';

// v7 → v8 (docs/architecture/CURRENCY_AND_FUNDS_DESIGN.md §F). Pure and deterministic; reads a v7 state
// (frozen types) and returns a v8 one. Built up step by step during Phase B; each step below is one
// dimension of the change. Nothing here may change a native amount.

// v7 read a missing holding location as Egypt, and subtracted every liability from Egypt's net worth.
// The migration makes both explicit so every v7 number stays the same.
const V7_DEFAULT_COUNTRY = 'EG';

// F4 — locations become ISO country codes. `EG` / `SA` already are ISO 3166-1 codes.
function breakdownV8(b: NetWorthBreakdownV7): NetWorthBreakdown {
  return {
    EG: { ...b.EG, liabilitiesEGP: b.liabilitiesEGP },
    SA: { ...b.SA, liabilitiesEGP: 0 },
  };
}

export function migrateV7toV8(v7: FinanceStateV7, _ctx: MigrationContext): FinanceState {
  const accounts = v7.accounts.map(({ location, ...rest }) => ({ ...rest, country: location }));
  const holdings = v7.holdings.map(({ location, ...rest }) => ({
    ...rest,
    country: location ?? V7_DEFAULT_COUNTRY,
  })) as Holding[];
  const liabilities = v7.liabilities.map((l) => ({ ...l, country: V7_DEFAULT_COUNTRY }));
  const netWorthSnapshots = v7.netWorthSnapshots.map(({ breakdown, ...rest }) => ({
    ...rest,
    ...(breakdown ? { breakdown: breakdownV8(breakdown) } : {}),
  })) as NetWorthSnapshot[];
  return { ...v7, accounts, holdings, liabilities, netWorthSnapshots };
}
