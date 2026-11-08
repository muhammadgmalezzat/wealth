import { accountBalance, accountReserved, reservation } from './selectors';
import type { FinanceState } from './types';

// INV-5, checkable. For every account, after every committed operation: each fund's reservation on it is not
// negative, and everything reserved on it fits in what it holds (max(0, balance)). Pure; used by the migration
// (fail closed) and by tests after every operation.

export type InvariantViolationCode = 'NEGATIVE_RESERVATION' | 'OVER_RESERVED' | 'UNKNOWN_ACCOUNT';

export interface InvariantViolation {
  code: InvariantViolationCode;
  accountId: string;
  fundId?: string;
  // The offending reservation, or the total reserved on the account.
  amount: number;
  // The most it may be (what the account holds) when the code is OVER_RESERVED.
  limit?: number;
}

type InvariantState = Pick<FinanceState, 'accounts' | 'transactions' | 'reservationMovements'>;

// Float noise is not a violation.
const EPSILON = 0.005;

export function invariantViolations(state: InvariantState): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const known = new Set(state.accounts.map((a) => a.id));
  for (const m of state.reservationMovements) {
    if (!known.has(m.accountId)) violations.push({ code: 'UNKNOWN_ACCOUNT', accountId: m.accountId, fundId: m.fundId, amount: m.amount });
  }
  for (const account of state.accounts) {
    const funds = [...new Set(state.reservationMovements.filter((m) => m.accountId === account.id).map((m) => m.fundId))];
    for (const fundId of funds) {
      const amount = reservation(state, fundId, account.id);
      if (amount < -EPSILON) violations.push({ code: 'NEGATIVE_RESERVATION', accountId: account.id, fundId, amount });
    }
    const reserved = accountReserved(state, account.id);
    const limit = Math.max(0, accountBalance(state, account.id));
    if (reserved > limit + EPSILON) violations.push({ code: 'OVER_RESERVED', accountId: account.id, amount: reserved, limit });
  }
  return violations;
}

export class InvariantError extends Error {
  override name = 'InvariantError';
  readonly violations: InvariantViolation[];

  constructor(violations: InvariantViolation[]) {
    super(`Reservation invariant broken: ${violations.map((v) => `${v.code}(${v.accountId}${v.fundId ? `/${v.fundId}` : ''}=${v.amount})`).join(', ')}`);
    this.violations = violations;
  }
}

export function assertInvariants(state: InvariantState): void {
  const violations = invariantViolations(state);
  if (violations.length > 0) throw new InvariantError(violations);
}
