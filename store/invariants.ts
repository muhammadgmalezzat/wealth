import { accountBalance, accountReserved, receivableCollected, reservation } from './selectors';
import type { FinanceState, Transaction } from './types';

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

type InvariantState = Pick<FinanceState, 'accounts' | 'transactions' | 'reservationMovements'> &
  // Data before v9 has none.
  Partial<Pick<FinanceState, 'receivables'>>;

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

// INV-9…11 (docs/architecture/RECEIVABLES_DESIGN.md §2), after every committed operation:
//   INV-9   0 ≤ collected ≤ amount, per receivable (collected = Σ its incomes, in its currency).
//   INV-10  a transaction's receivableId points at an existing receivable, the transaction is an income, and it is
//           in the receivable's currency.
//   INV-11  a salary receivable has a valid forMonth; a linked income carries its receivable's forMonth.
export type ReceivableViolationCode =
  | 'OVER_COLLECTED'
  | 'UNKNOWN_RECEIVABLE'
  | 'NOT_INCOME'
  | 'CURRENCY_MISMATCH'
  | 'FOR_MONTH_MISMATCH'
  | 'FOR_MONTH_INVALID';

export interface ReceivableViolation {
  code: ReceivableViolationCode;
  receivableId: string;
  transactionId?: string;
  // OVER_COLLECTED: what was collected, and the most it may be.
  amount?: number;
  limit?: number;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function receivableViolations(state: Pick<InvariantState, 'transactions' | 'receivables'>): ReceivableViolation[] {
  const receivables = state.receivables ?? [];
  const violations: ReceivableViolation[] = [];
  const byId = new Map(receivables.map((r) => [r.id, r]));
  for (const r of receivables) {
    if (r.kind === 'salary' ? !MONTH.test(r.forMonth ?? '') : r.forMonth !== undefined && !MONTH.test(r.forMonth)) {
      violations.push({ code: 'FOR_MONTH_INVALID', receivableId: r.id });
    }
    const collected = receivableCollected(state, r);
    if (collected > r.amount + EPSILON || collected < -EPSILON) {
      violations.push({ code: 'OVER_COLLECTED', receivableId: r.id, amount: collected, limit: r.amount });
    }
  }
  for (const tx of state.transactions as (Transaction & { receivableId?: string; forMonth?: string })[]) {
    if (tx.receivableId === undefined) continue;
    const r = byId.get(tx.receivableId);
    if (!r) {
      violations.push({ code: 'UNKNOWN_RECEIVABLE', receivableId: tx.receivableId, transactionId: tx.id });
      continue;
    }
    if (tx.type !== 'income') {
      violations.push({ code: 'NOT_INCOME', receivableId: r.id, transactionId: tx.id });
      continue;
    }
    if (tx.currency !== r.currency) violations.push({ code: 'CURRENCY_MISMATCH', receivableId: r.id, transactionId: tx.id });
    if (tx.forMonth !== r.forMonth) violations.push({ code: 'FOR_MONTH_MISMATCH', receivableId: r.id, transactionId: tx.id });
  }
  return violations;
}

export type AnyViolation = InvariantViolation | ReceivableViolation;

const describe = (v: AnyViolation) =>
  'accountId' in v
    ? `${v.code}(${v.accountId}${v.fundId ? `/${v.fundId}` : ''}=${v.amount})`
    : `${v.code}(${v.receivableId}${v.transactionId ? `/${v.transactionId}` : ''}${v.amount !== undefined ? `=${v.amount}` : ''})`;

export class InvariantError extends Error {
  override name = 'InvariantError';
  readonly violations: AnyViolation[];

  constructor(violations: AnyViolation[]) {
    super(`Invariant broken: ${violations.map(describe).join(', ')}`);
    this.violations = violations;
  }
}

// INV-5 and INV-9…11.
export function assertInvariants(state: InvariantState): void {
  const violations: AnyViolation[] = [...invariantViolations(state), ...receivableViolations(state)];
  if (violations.length > 0) throw new InvariantError(violations);
}

// INV-9…11 only (the v9 migration and backup restore).
export function assertReceivableInvariants(state: Pick<InvariantState, 'transactions' | 'receivables'>): void {
  const violations = receivableViolations(state);
  if (violations.length > 0) throw new InvariantError(violations);
}
