import { GOLD_PRICE_24K } from '@/constants/market';
import { toEGP } from '@/utils/currency';
import { goldValueEGP } from '@/utils/gold';
import type { Asset, FinanceState } from './types';

// Single source of truth for every derived financial figure shown in the UI.
// All functions are pure: same state in, same number out.

type ValuationState = Pick<FinanceState, 'assets' | 'exchangeRates'>;

export function isLiquid(asset: Asset): boolean {
  return asset.type === 'cash' || asset.type === 'bank';
}

export function isGold(asset: Asset): boolean {
  return asset.type === 'gold';
}

export function liquidTotalEGP(state: ValuationState): number {
  return state.assets
    .filter(isLiquid)
    .reduce((sum, a) => sum + toEGP(a.amount, a.currency, state.exchangeRates), 0);
}

export function goldMarketValueEGP(state: ValuationState): number {
  return state.assets
    .filter(isGold)
    .reduce((sum, a) => sum + goldValueEGP(a, GOLD_PRICE_24K), 0);
}

export function netWorthEGP(state: ValuationState): number {
  return liquidTotalEGP(state) + goldMarketValueEGP(state);
}
