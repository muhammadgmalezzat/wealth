import { roundIn, splitTo, decimalsFor } from '@/utils/money';

import { FinanceValidationError } from './errors';
import { accountBalance, accountReserved, reservation } from './selectors';
import type { CurrencyCode, FinanceState } from './types';

// Cover and follow rules (design C2–C5, D2). Pure.
//
// INV-5: for every account, everything reserved on it fits in max(0, balance). An operation that would break it
// does not fail silently and does not apply: it needs a COVER (reserved money released to pay for it) chosen by the
// user, applied in the SAME atomic patch. Without one the operation throws NeedsCoverError, which carries what the
// cover sheet needs (the account, the shortfall and a default selection). Nothing is partially applied.

// Money released from fund `fundId`'s reservation on `accountId` to cover spending; `amount` is in the account's
// currency and > 0.
export interface CoverSelection {
  fundId: string;
  accountId: string;
  amount: number;
}

// What the user decided about an operation that touches reserved money or an overdraft.
export interface OpOptions {
  // Reservations released to cover the shortfall of each account (exactly the shortfall).
  cover?: CoverSelection[];
  // Reserved money that travels with a transfer or exchange: per fund, in the SOURCE account's currency, adding up
  // to what must leave. Default: proportional to each fund's reservation on the source account.
  follow?: { fundId: string; amount: number }[];
  confirm?: {
    // An exchange that converts reserved money (D2 #2).
    conversion?: boolean;
    // An account without allowNegative going below zero (D2 #4, Q1).
    negative?: boolean;
  };
}

// 'cover': reserved money is needed to pay for it. 'conversion': an exchange would convert reserved money.
// 'negative': the balance would go below zero on an account that does not allow it.
export type ShortfallKind = 'cover' | 'conversion' | 'negative';

export interface Shortfall {
  kind: ShortfallKind;
  accountId: string;
  currency: CurrencyCode;
  // In the account's currency: what must be covered / converted / the amount below zero.
  amount: number;
  // A default way to do it (lowest-priority fund first for a cover; proportional for a conversion). Empty for
  // 'negative'.
  suggested: { fundId: string; amount: number }[];
}

// Thrown instead of applying. NOT a FinanceValidationError: callers must open the cover flow for it, never show it
// as an error message (utils/runAction does). processDue catches it and leaves the occurrence due, flagged.
export class NeedsCoverError extends Error {
  override name = 'NeedsCoverError';
  readonly shortfalls: Shortfall[];

  constructor(shortfalls: Shortfall[]) {
    super(`Needs cover: ${shortfalls.map((s) => `${s.kind} ${s.amount} ${s.currency} on ${s.accountId}`).join('; ')}`);
    this.shortfalls = shortfalls;
  }
}

const EPSILON = 0.005;

type RoomState = Pick<FinanceState, 'accounts' | 'transactions' | 'reservationMovements'>;

// How far an account's reservations exceed what it holds (0 when INV-5 holds).
export function overReserved(state: RoomState, accountId: string): number {
  const currency = state.accounts.find((a) => a.id === accountId)?.currency;
  if (!currency) return 0;
  return roundIn(Math.max(0, accountReserved(state, accountId) - Math.max(0, accountBalance(state, accountId))), currency);
}

// The funds' reservations on an account, lowest priority first (the first to give money back), with their sizes.
export function reservationsOn(
  state: Pick<FinanceState, 'accounts' | 'funds' | 'reservationMovements'>,
  accountId: string
): { fundId: string; amount: number }[] {
  return state.funds
    .map((f) => ({ fundId: f.id, amount: reservation(state, f.id, accountId), priority: f.priority }))
    .filter((r) => r.amount > EPSILON)
    .sort((a, b) => b.priority - a.priority || (a.fundId < b.fundId ? -1 : 1))
    .map(({ fundId, amount }) => ({ fundId, amount }));
}

// Takes `amount` from the funds in order (lowest priority first), each up to its reservation.
export function suggestCover(
  state: Pick<FinanceState, 'accounts' | 'funds' | 'reservationMovements'>,
  accountId: string,
  amount: number
): { fundId: string; amount: number }[] {
  const currency = state.accounts.find((a) => a.id === accountId)?.currency;
  if (!currency) return [];
  const picks: { fundId: string; amount: number }[] = [];
  let left = amount;
  for (const r of reservationsOn(state, accountId)) {
    if (left <= EPSILON) break;
    const take = Math.min(left, r.amount);
    picks.push({ fundId: r.fundId, amount: roundIn(take, currency) });
    left = roundIn(left - take, currency);
  }
  return picks;
}

// `total` of `currency` split across the funds in proportion to their reservations (largest remainder: the parts add
// up to the total exactly, the last fund takes the remainder). Funds that would get nothing are left out.
export function proportionalSplit(
  reservations: { fundId: string; amount: number }[],
  total: number,
  currency: CurrencyCode
): { fundId: string; amount: number }[] {
  const parts = splitTo(
    total,
    reservations.map((r) => r.amount),
    decimalsFor(currency)
  );
  return reservations.map((r, i) => ({ fundId: r.fundId, amount: parts[i] })).filter((p) => p.amount > EPSILON);
}

// Every account whose over-reservation or negative balance gets WORSE from \`before\` to \`after\` (an account that
// already was over-reserved is not blamed on an operation that does not make it worse).
export function shortfallsBetween(
  before: Pick<FinanceState, 'accounts' | 'transactions' | 'reservationMovements' | 'funds'>,
  after: Pick<FinanceState, 'accounts' | 'transactions' | 'reservationMovements' | 'funds'>
): Shortfall[] {
  const found: Shortfall[] = [];
  for (const account of after.accounts) {
    const was = before.accounts.some((a) => a.id === account.id);
    const over = overReserved(after, account.id);
    const wasOver = was ? overReserved(before, account.id) : 0;
    if (over > wasOver + EPSILON) {
      found.push({
        kind: 'cover',
        accountId: account.id,
        currency: account.currency,
        amount: over,
        suggested: suggestCover(after, account.id, over),
      });
    }
    const balance = accountBalance(after, account.id);
    const wasBalance = was ? accountBalance(before, account.id) : balance;
    if (balance < -EPSILON && balance < wasBalance - EPSILON && !account.allowNegative) {
      found.push({ kind: 'negative', accountId: account.id, currency: account.currency, amount: roundIn(-balance, account.currency), suggested: [] });
    }
  }
  return found;
}

// The options that accept everything a NeedsCoverError proposes: the default cover (lowest priority first), the
// proportional split of an exchange, and the confirmations. This is what the cover sheet starts from; the user can
// change it before saving.
export function proposedOptions(error: NeedsCoverError): OpOptions {
  const cover = error.shortfalls
    .filter((s) => s.kind === 'cover')
    .flatMap((s) => s.suggested.map((x) => ({ fundId: x.fundId, accountId: s.accountId, amount: x.amount })));
  const conversion = error.shortfalls.find((s) => s.kind === 'conversion');
  return {
    ...(cover.length > 0 ? { cover } : {}),
    ...(conversion ? { follow: conversion.suggested } : {}),
    confirm: {
      ...(conversion ? { conversion: true } : {}),
      ...(error.shortfalls.some((s) => s.kind === 'negative') ? { negative: true } : {}),
    },
  };
}

// Options of an earlier attempt combined with what the user decided since (later wins per part).
export function mergeOptions(a: OpOptions | undefined, b: OpOptions | undefined): OpOptions {
  return {
    ...(a ?? {}),
    ...(b ?? {}),
    confirm: { ...(a?.confirm ?? {}), ...(b?.confirm ?? {}) },
  };
}

// --- Which account? (the default rules, D1) -------------------------------------------------------------------
//
// Whenever an account is chosen automatically (reserving, releasing, paying a sinking fund) the sheet SHOWS the choice
// (these plans) and lets the user pick another before saving. The operations use the same functions, so what the sheet
// showed is what is saved.

export interface AccountShare {
  accountId: string;
  // In the account's currency, > 0.
  amount: number;
}

// Deterministic order: the account with the most of something first, then the oldest account, then the id.
const byAmountDesc =
  (amountOf: (accountId: string) => number) =>
  (a: { id: string; createdAt: string }, b: { id: string; createdAt: string }): number =>
    amountOf(b.id) - amountOf(a.id) || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1);

type PlanState = Pick<FinanceState, 'accounts' | 'transactions' | 'reservationMovements'>;

// Reserve `amount` of `currency`: on `accountId` when given, otherwise on the active accounts of that currency with
// the most available money, split across them when one cannot hold it all. Throws NO_ACCOUNT_IN_CURRENCY /
// RESERVE_EXCEEDS_AVAILABLE (Q13: never beyond what is available).
export function planReserve(state: PlanState, fundId: string, amount: number, currency: CurrencyCode, accountId?: string): AccountShare[] {
  const candidates = state.accounts.filter((a) => a.currency === currency && !a.archived && (!accountId || a.id === accountId));
  if (candidates.length === 0) throw new FinanceValidationError('NO_ACCOUNT_IN_CURRENCY');
  const available = (id: string) => Math.max(0, roundIn(accountBalance(state, id) - accountReserved(state, id), currency));
  candidates.sort(byAmountDesc(available));
  const shares: AccountShare[] = [];
  let left = amount;
  for (const account of candidates) {
    if (left <= 0) break;
    const take = Math.min(left, available(account.id));
    if (take <= 0) continue;
    shares.push({ accountId: account.id, amount: take });
    left = roundIn(left - take, currency);
  }
  if (left > 0) throw new FinanceValidationError('RESERVE_EXCEEDS_AVAILABLE', { id: fundId });
  return shares;
}

// Release `amount` of `currency` from the fund: from `accountId` when given, otherwise the accounts where it is
// over-reserved first, then the largest reservation. Throws WITHDRAW_EXCEEDS_FUND beyond what it holds.
export function planRelease(state: PlanState, fundId: string, amount: number, currency: CurrencyCode, accountId?: string): AccountShare[] {
  const held = state.accounts.filter((a) => a.currency === currency && (!accountId || a.id === accountId) && reservation(state, fundId, a.id) > 0);
  const over = (id: string) => (accountReserved(state, id) > Math.max(0, accountBalance(state, id)) ? 1 : 0);
  held.sort((a, b) => over(b.id) - over(a.id) || byAmountDesc((id) => reservation(state, fundId, id))(a, b));
  const shares: AccountShare[] = [];
  let left = amount;
  for (const account of held) {
    if (left <= 0) break;
    const take = Math.min(left, reservation(state, fundId, account.id));
    if (take <= 0) continue;
    shares.push({ accountId: account.id, amount: take });
    left = roundIn(left - take, currency);
  }
  if (left > 0) throw new FinanceValidationError('WITHDRAW_EXCEEDS_FUND', { id: fundId });
  return shares;
}

// Where a sinking-fund bill is paid from by default: the account holding the fund's largest reservation (so that
// reservation is what gets spent), otherwise the account of the last expense, otherwise the first active account.
export function defaultSinkingAccountId(
  state: Pick<FinanceState, 'accounts' | 'reservationMovements' | 'settings'>,
  fundId: string
): string | undefined {
  const active = state.accounts.filter((a) => !a.archived);
  const best = active
    .map((a) => ({ id: a.id, amount: reservation(state, fundId, a.id), createdAt: a.createdAt }))
    .filter((r) => r.amount > EPSILON)
    .sort((a, b) => b.amount - a.amount || (a.createdAt < b.createdAt ? -1 : 1))[0];
  const last = state.settings.lastUsed?.expense?.accountId;
  return best?.id ?? active.find((a) => a.id === last)?.id ?? active[0]?.id;
}

// --- What travels with a transfer or exchange (the sheet's notice and the operations share it) ---------------------

// Reserved money that has to leave `fromAccountId` WITH a move of `sent` (in its currency): the part above what is
// available after the fees charged to that account, at most what is reserved there. `split` is the default one:
// in proportion to each fund's reservation, the lowest-priority fund last (it takes the rounding remainder).
export function followPreview(
  state: Pick<FinanceState, 'accounts' | 'funds' | 'transactions' | 'reservationMovements'>,
  fromAccountId: string,
  sent: number,
  feeOnSource = 0
): { need: number; currency: CurrencyCode; split: { fundId: string; amount: number }[] } | null {
  const from = state.accounts.find((a) => a.id === fromAccountId);
  if (!from) return null;
  const available = Math.max(0, roundIn(accountBalance(state, from.id) - accountReserved(state, from.id), from.currency));
  const reserved = reservationsOn(state, from.id).reverse();
  const need = Math.min(roundIn(sent - Math.max(0, available - feeOnSource), from.currency), roundIn(reserved.reduce((s, r) => s + r.amount, 0), from.currency));
  if (!(need > EPSILON)) return { need: 0, currency: from.currency, split: [] };
  return { need, currency: from.currency, split: proportionalSplit(reserved, need, from.currency) };
}

// What covering a transaction took from the funds (Q4): per fund and account, net of any re-reservation of it.
// After that transaction is deleted this is what the one-tap "رجّع للصناديق" offer gives back.
export function coversOf(
  state: Pick<FinanceState, 'reservationMovements'>,
  sourceTransactionId: string
): CoverSelection[] {
  const net = new Map<string, CoverSelection>();
  for (const m of state.reservationMovements) {
    if (m.sourceTransactionId !== sourceTransactionId || (m.kind !== 'cover' && m.kind !== 'reserve')) continue;
    const key = `${m.fundId}|${m.accountId}`;
    const entry = net.get(key) ?? { fundId: m.fundId, accountId: m.accountId, amount: 0 };
    // A cover is negative (taken), a re-reservation positive (given back).
    entry.amount = Math.round((entry.amount - m.amount) * 100) / 100;
    net.set(key, entry);
  }
  return [...net.values()].filter((c) => c.amount > EPSILON);
}
