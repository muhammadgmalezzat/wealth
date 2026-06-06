import type { Asset, ExchangeRates } from '@/store/types';
import { toEGP } from './currency';

// Returns current gold value in EGP given a live price per gram (24k EGP).
export function goldValueEGP(asset: Asset, pricePerGram24kEGP: number): number {
  if (asset.type !== 'gold' || !asset.weightGrams || !asset.karat) return 0;
  const purity = asset.karat === 24 ? 1 : 21 / 24;
  return asset.weightGrams * purity * pricePerGram24kEGP;
}

// Returns profit/loss vs purchase price in EGP.
export function goldPnlEGP(
  asset: Asset,
  pricePerGram24kEGP: number,
  rates: ExchangeRates
): number {
  if (asset.type !== 'gold' || !asset.purchasePrice) return 0;
  const currentValue = goldValueEGP(asset, pricePerGram24kEGP);
  const costEGP = toEGP(asset.purchasePrice, asset.currency, rates);
  return currentValue - costEGP;
}
