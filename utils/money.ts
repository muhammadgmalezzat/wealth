import { decimalsOf, type CurrencyRegistry, CURRENCY_REGISTRY } from '@/constants/currencyRegistry';

// The only way to produce stored or aggregated money (INV-7 in docs/architecture/CURRENCY_AND_FUNDS_DESIGN.md):
// round to the currency's decimals, half away from zero, and add in integer minor units. Amounts stay
// plain JS numbers; these helpers keep binary floating-point noise out of what is stored and shown.

// Moves the decimal point of `n` by `k` places using its decimal text, so it is exact where
// `n * 10 ** k` is not (1.005 * 100 = 100.49999999999999). Handles exponent notation (1e-7, 1e21).
function shiftDecimal(n: number, k: number): number {
  const [mantissa, exponent = '0'] = n.toString().split('e');
  return Number(`${mantissa}e${Number(exponent) + k}`);
}

// Rounds to `decimals` places, half away from zero (1.005 → 1.01, −1.005 → −1.01). Never returns −0.
export function roundTo(x: number, decimals: number): number {
  if (!Number.isFinite(x)) return x;
  const rounded = shiftDecimal(Math.round(shiftDecimal(Math.abs(x), decimals)), -decimals);
  return x < 0 && rounded !== 0 ? -rounded : rounded;
}

export const roundMoney = (x: number, currency: string, registry: CurrencyRegistry = CURRENCY_REGISTRY): number =>
  roundTo(x, decimalsOf(currency, registry));

// Whole minor units (cents, fils, yen) of an amount.
export function toMinor(x: number, decimals: number): number {
  const minor = Math.round(shiftDecimal(Math.abs(x), decimals));
  return x < 0 && minor !== 0 ? -minor : minor;
}

export const fromMinor = (minor: number, decimals: number): number => shiftDecimal(minor, -decimals);

// The sum of the amounts, each rounded first, added as integers: exact to `decimals` places.
export function sumTo(values: readonly number[], decimals: number): number {
  let minor = 0;
  for (const v of values) minor += toMinor(v, decimals);
  return fromMinor(minor, decimals);
}

export const sumMoney = (values: readonly number[], currency: string, registry: CurrencyRegistry = CURRENCY_REGISTRY): number =>
  sumTo(values, decimalsOf(currency, registry));

// Splits `total` in proportion to `weights` with the largest-remainder method, so the parts add up to
// the (rounded) total exactly. Ties go to the later entry (the last part takes the remainder). Zero or negative total weight → all to the first.
export function splitTo(total: number, weights: readonly number[], decimals: number): number[] {
  if (weights.length === 0) return [];
  const totalMinor = toMinor(total, decimals);
  const sign = totalMinor < 0 ? -1 : 1;
  const absTotal = Math.abs(totalMinor);
  const weightSum = weights.reduce((a, w) => a + Math.max(0, w), 0);
  if (weightSum <= 0) return weights.map((_, i) => fromMinor(i === 0 ? totalMinor : 0, decimals));
  const exact = weights.map((w) => (absTotal * Math.max(0, w)) / weightSum);
  const parts = exact.map(Math.floor);
  let left = absTotal - parts.reduce((a, p) => a + p, 0);
  const order = exact.map((e, i) => ({ i, frac: e - Math.floor(e) })).sort((a, b) => b.frac - a.frac || b.i - a.i);
  for (const { i } of order) {
    if (left <= 0) break;
    parts[i] += 1;
    left -= 1;
  }
  return parts.map((p) => fromMinor(sign * p, decimals));
}

export const splitMoney = (
  total: number,
  weights: readonly number[],
  currency: string,
  registry: CurrencyRegistry = CURRENCY_REGISTRY
): number[] => splitTo(total, weights, decimalsOf(currency, registry));
