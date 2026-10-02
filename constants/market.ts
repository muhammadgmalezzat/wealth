// Placeholder until a live gold-price feed is wired up.
// Derived from seed purchase prices (~6,102 EGP/g); set slightly higher to show demo PnL.
export const GOLD_PRICE_24K = 6_500; // EGP per gram of 24k gold
// Default 21k price when none was set: 24k scaled by purity.
export const GOLD_PRICE_21K = (GOLD_PRICE_24K * 21) / 24;

// Default start of cash-flow tracking (the user's opening position).
export const DEFAULT_TRACKING_START_DATE = '2026-08-05';
