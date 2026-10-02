// Pure-logic tests for the finance model. Run with: npm run test:logic
// TypeScript 6 no longer auto-includes @types packages, so opt in to Node types here.
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GOLD_PRICE_24K } from '@/constants/market';
import { CATEGORY_IDS, DEFAULT_CATEGORIES } from '@/store/defaultCategories';
import { FinanceValidationError } from '@/store/errors';
import { migratePersistedState, type FinanceStateV1 } from '@/store/migrations';
import * as ops from '@/store/operations';
import {
  accountBalance,
  fundAllocated,
  fundCurrent,
  fundProgress,
  fundRequiredMonthly,
  fundStatus,
  groupTransactionsByDay,
  holdingsTotalEGP,
  liabilitiesTotalEGP,
  liquidTotalEGP,
  monthSummary,
  netWorthEGP,
  openingBalanceForCurrentBalance,
  safeToSpend,
  stateSummary,
  suggestedEmergencyTarget,
  transactionsForMonth,
  unassignedEGP,
  unassignedEGPWithFundCash,
} from '@/store/selectors';
import type { FinanceStateV2, Fund } from '@/store/types';
import { errorMessage } from '@/utils/errorMessages';
import { formatDayLabel } from '@/utils/formatters';
import { parseAmount } from '@/utils/parseAmount';

// --- Fixtures ---------------------------------------------------------------

const RATES = { SAR_EGP: 12.5, USD_EGP: 50, lastUpdated: '2026-10-01T00:00:00.000Z' };
const NOW = new Date(2026, 9, 15, 12); // 15 Oct 2026, local time
const MIGRATION_CTX = { now: '2026-10-15T09:00:00.000Z' };

function makeCtx(): ops.OpContext {
  let seq = 0;
  return { newId: () => `id-${++seq}`, now: () => NOW };
}

function emptyState(): FinanceStateV2 {
  return {
    accounts: [],
    categories: DEFAULT_CATEGORIES,
    transactions: [],
    funds: [],
    fundMovements: [],
    holdings: [],
    liabilities: [],
    recurringRules: [],
    monthlyPlans: [],
    settings: { exchangeRates: RATES, goldPrice24kEGP: 6000, goldPriceUpdatedAt: '2026-10-01T00:00:00.000Z' },
  };
}

const apply = (state: FinanceStateV2, patch: Partial<FinanceStateV2>): FinanceStateV2 => ({
  ...state,
  ...patch,
});

const approx = (actual: number | null, expected: number) => {
  assert.notEqual(actual, null);
  assert.ok(Math.abs((actual as number) - expected) < 1e-6, `expected ${expected}, got ${actual}`);
};

const account = (id: string, currency: 'EGP' | 'SAR' | 'USD', openingBalance: number) => ({
  id,
  name: id,
  type: 'bank' as const,
  currency,
  openingBalance,
  createdAt: '2026-01-01T00:00:00.000Z',
});

const fund = (overrides: Partial<Fund> & Pick<Fund, 'id'>): Fund => ({
  name: overrides.id,
  type: 'goal',
  targetAmount: 100000,
  currency: 'EGP',
  priority: 1,
  linkedHoldingIds: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const LEGACY_V1: FinanceStateV1 = {
  transactions: [
    { id: 'tx-1', amount: 500, currency: 'SAR', type: 'income', category: 'Bonus', date: '2026-09-02T10:00:00.000Z' },
    { id: 'tx-2', amount: 200, currency: 'USD', type: 'expense', category: 'Food', date: '2026-09-03' },
  ],
  assets: [
    { id: 'a-cash', type: 'cash', name: 'Cash SAR', amount: 1000, currency: 'SAR' },
    { id: 'a-bank', type: 'bank', name: 'Bank EGP', amount: 20000, currency: 'EGP' },
    { id: 'a-gold', type: 'gold', name: 'Gold 10g 21k', amount: 0, currency: 'SAR', weightGrams: 10, karat: 21, purchasePrice: 4000 },
  ],
  goals: [
    { id: 'g-big', name: 'Big goal', targetAmount: 200000, currentAmount: 100000, deadline: '2027-06-30', currency: 'EGP' },
    { id: 'g-small', name: 'Small goal', targetAmount: 50000, currentAmount: 30000, currency: 'EGP' },
  ],
  exchangeRates: RATES,
};

// --- Migration --------------------------------------------------------------

describe('migration', () => {
  const goldMarket = 10 * (21 / 24) * GOLD_PRICE_24K; // 56,875 EGP
  // openingBalance = v1 amount, and the migrated v1 transactions flow through the
  // accounts: +500 SAR income, −200 USD expense.
  const liquid = 1000 * 12.5 + 20000 + 500 * 12.5 - 200 * 50; // 28,750 EGP

  it('upgrades v1 data to v2 without losing anything', () => {
    const { state: v2 } = migratePersistedState(LEGACY_V1, 1, MIGRATION_CTX);

    assert.deepEqual(
      v2.accounts.map((a) => [a.id, a.type, a.currency, a.openingBalance]),
      [
        ['a-cash', 'cash', 'SAR', 1000],
        ['a-bank', 'bank', 'EGP', 20000],
        // created for the USD legacy transaction (no USD account existed)
        ['acct-legacy-usd', 'cash', 'USD', 0],
      ]
    );

    assert.equal(v2.holdings.length, 1);
    const gold = v2.holdings[0];
    assert.equal(gold.type, 'gold');
    assert.equal(gold.id, 'a-gold');
    approx(gold.purchaseCostEGP, 4000 * 12.5); // SAR cost converted to EGP

    // Gold backs only the first goal.
    assert.deepEqual(v2.funds.map((f) => [f.id, f.type, f.priority, f.linkedHoldingIds]), [
      ['g-big', 'goal', 1, ['a-gold']],
      ['g-small', 'goal', 2, []],
    ]);

    const [income, expense] = v2.transactions;
    assert.equal(income.type, 'income');
    if (income.type === 'income') {
      assert.equal(income.accountId, 'a-cash');
      assert.equal(income.categoryId, CATEGORY_IDS.otherIncome);
      assert.equal(income.rateToEGP, 12.5);
      assert.equal(income.date, '2026-09-02');
      assert.equal(income.note, 'Bonus');
    }
    if (expense.type === 'expense') {
      assert.equal(expense.accountId, 'acct-legacy-usd');
      assert.equal(expense.categoryId, CATEGORY_IDS.groceries);
    }

    assert.equal(v2.categories.length, DEFAULT_CATEGORIES.length);
    assert.deepEqual(v2.settings.exchangeRates, RATES);
    assert.equal(v2.settings.goldPrice24kEGP, GOLD_PRICE_24K);
  });

  it('clamps opening allocations to available cash so unassigned never starts negative', () => {
    const { state: v2, clampedBy } = migratePersistedState(LEGACY_V1, 1, MIGRATION_CTX);
    // g-big wants 100,000 − 56,875 = 43,125 but only 28,750 cash exists;
    // g-small wants 30,000 and nothing is left.
    assert.equal(v2.fundMovements.length, 1);
    assert.equal(v2.fundMovements[0].fundId, 'g-big');
    approx(v2.fundMovements[0].amount, liquid);
    approx(clampedBy, 43125 - liquid + 30000);
    approx(unassignedEGP(v2), 0);
    approx(fundCurrent(v2, 'g-big'), goldMarket + liquid);
    approx(fundCurrent(v2, 'g-small'), 0);
  });

  it('does not clamp when cash covers the goals', () => {
    const rich: FinanceStateV1 = {
      ...LEGACY_V1,
      transactions: [],
      assets: LEGACY_V1.assets.map((a) => (a.id === 'a-bank' ? { ...a, amount: 200000 } : a)),
    };
    const { state: v2, clampedBy } = migratePersistedState(rich, 1, MIGRATION_CTX);
    assert.equal(clampedBy, 0);
    assert.deepEqual(
      v2.fundMovements.map((m) => [m.fundId, Math.round(m.amount)]),
      [
        ['g-big', 100000 - goldMarket],
        ['g-small', 30000],
      ]
    );
    approx(fundCurrent(v2, 'g-big'), 100000);
    approx(unassignedEGP(v2), 1000 * 12.5 + 200000 - (100000 - goldMarket) - 30000);
  });

  it('chains v0 (pre-Zustand bare JSON) through v1 to v2', () => {
    assert.deepEqual(
      migratePersistedState(LEGACY_V1, 0, MIGRATION_CTX),
      migratePersistedState(LEGACY_V1, 1, MIGRATION_CTX)
    );
  });

  it('tolerates missing collections', () => {
    const { state: v2 } = migratePersistedState({}, 1, MIGRATION_CTX);
    assert.equal(v2.accounts.length, 0);
    assert.equal(v2.categories.length, DEFAULT_CATEGORIES.length);
    assert.equal(netWorthEGP(v2), 0);
  });

  it('leaves v2 data untouched', () => {
    const state = emptyState();
    const result = migratePersistedState(state, 2, MIGRATION_CTX);
    assert.equal(result.state, state);
    assert.equal(result.clampedBy, 0);
  });

  it('summarises the migrated state', () => {
    const summary = stateSummary(migratePersistedState(LEGACY_V1, 1, MIGRATION_CTX).state);
    assert.deepEqual(summary, {
      accounts: 3,
      holdings: 1,
      funds: 2,
      netWorthEGP: liquid + goldMarket,
      unassignedEGP: 0,
    });
  });
});

// --- Net worth --------------------------------------------------------------

describe('netWorthEGP', () => {
  it('= liquid + holdings at market − remaining liabilities', () => {
    const ctx = makeCtx();
    let s = emptyState();
    s.accounts = [account('egp', 'EGP', 10000), account('sar', 'SAR', 1000)];
    s.holdings = [
      { id: 'gold', type: 'gold', name: 'Gold', weightGrams: 10, karat: 24, purchaseCostEGP: 50000 },
      { id: 'usd', type: 'currency', name: 'USD', currency: 'USD', quantity: 100, purchaseCostEGP: 4800 },
    ];
    s = apply(s, ops.addLiability(s, { name: 'Car', principal: 20000, currency: 'EGP', startDate: '2026-01-01' }, ctx));
    const liabilityId = s.liabilities[0].id;
    s = apply(
      s,
      ops.addTransaction(
        s,
        {
          type: 'expense',
          amount: 5000,
          currency: 'EGP',
          accountId: 'egp',
          categoryId: 'cat-essentials-bills',
          date: '2026-10-01',
          liabilityId,
        },
        ctx
      )
    );

    approx(liquidTotalEGP(s), 5000 + 1000 * 12.5);
    approx(holdingsTotalEGP(s), 10 * 6000 + 100 * 50);
    approx(liabilitiesTotalEGP(s), 15000);
    approx(netWorthEGP(s), 17500 + 65000 - 15000);
  });
});

// --- Funds ------------------------------------------------------------------

describe('funds', () => {
  const withGold = (): FinanceStateV2 => ({
    ...emptyState(),
    holdings: [{ id: 'gold', type: 'gold', name: 'Gold', weightGrams: 10, karat: 24, purchaseCostEGP: 50000 }],
  });

  it('fundCurrent = cash movements + market value of linked gold (in fund currency)', () => {
    const s = withGold();
    s.funds = [
      fund({ id: 'egp', linkedHoldingIds: ['gold'] }),
      fund({ id: 'sar', currency: 'SAR', targetAmount: 10000, linkedHoldingIds: ['gold'] }),
    ];
    s.fundMovements = [
      { id: 'm1', fundId: 'egp', amount: 10000, date: '2026-09-01' },
      { id: 'm2', fundId: 'sar', amount: 200, date: '2026-09-01' },
    ];
    approx(fundCurrent(s, 'egp'), 60000 + 10000);
    approx(fundProgress(s, 'egp'), 0.7);
    approx(fundCurrent(s, 'sar'), 60000 / 12.5 + 200);
  });

  it('fundRequiredMonthly spreads the remainder over the months left', () => {
    const s = withGold();
    s.funds = [
      fund({ id: 'dated', deadline: '2026-12-31', linkedHoldingIds: ['gold'] }),
      fund({ id: 'open' }),
      fund({ id: 'overdue', deadline: '2026-01-31' }),
    ];
    s.fundMovements = [{ id: 'm1', fundId: 'dated', amount: 10000, date: '2026-09-01' }];
    approx(fundRequiredMonthly(s, 'dated', NOW), (100000 - 70000) / 3); // Oct, Nov, Dec
    assert.equal(fundRequiredMonthly(s, 'open', NOW), null);
    approx(fundRequiredMonthly(s, 'overdue', NOW), 100000); // everything due now
  });

  it('fundStatus compares this month’s allocations with the requirement', () => {
    const ctx = makeCtx();
    const base = withGold();
    base.funds = [fund({ id: 'f', deadline: '2026-12-31', linkedHoldingIds: ['gold'] }), fund({ id: 'open' })];
    base.fundMovements = [{ id: 'm1', fundId: 'f', amount: 10000, date: '2026-09-01' }];
    // At month start: 70,000 of 100,000 → 10,000/month required.
    const allocate = (amount: number) => apply(base, ops.allocateToFund(base, 'f', amount, undefined, ctx));

    assert.equal(fundStatus(base, 'f', NOW), 'behind');
    assert.equal(fundStatus(allocate(5000), 'f', NOW), 'behind');
    assert.equal(fundStatus(allocate(10000), 'f', NOW), 'on_track');
    assert.equal(fundStatus(allocate(12000), 'f', NOW), 'ahead');
    assert.equal(fundStatus(base, 'open', NOW), 'no_deadline');
  });

  it('withdrawals cannot exceed the fund’s cash', () => {
    const ctx = makeCtx();
    const s = withGold();
    s.funds = [fund({ id: 'f', linkedHoldingIds: ['gold'] })];
    s.fundMovements = [{ id: 'm1', fundId: 'f', amount: 1000, date: '2026-09-01' }];
    assert.throws(() => ops.withdrawFromFund(s, 'f', 1500, undefined, ctx), ops.FinanceValidationError);
    const after = apply(s, ops.withdrawFromFund(s, 'f', 400, 'repair', ctx));
    approx(fundCurrent(after, 'f'), 60000 + 600);
  });
});

describe('unassignedEGP', () => {
  it('= liquid − cash allocated to funds (linked holdings excluded)', () => {
    const s = emptyState();
    s.accounts = [account('egp', 'EGP', 50000), account('sar', 'SAR', 2000)];
    s.holdings = [{ id: 'gold', type: 'gold', name: 'Gold', weightGrams: 10, karat: 24, purchaseCostEGP: 0 }];
    s.funds = [fund({ id: 'egp-fund', linkedHoldingIds: ['gold'] }), fund({ id: 'sar-fund', currency: 'SAR' })];
    s.fundMovements = [
      { id: 'm1', fundId: 'egp-fund', amount: 30000, date: '2026-09-01' },
      { id: 'm2', fundId: 'sar-fund', amount: 400, date: '2026-09-01' },
    ];
    approx(unassignedEGP(s), 50000 + 2000 * 12.5 - 30000 - 400 * 12.5);
  });
});

// --- Cash flow --------------------------------------------------------------

describe('monthSummary', () => {
  it('converts each transaction with its own snapshotted rate', () => {
    const ctx = makeCtx();
    let s = emptyState();
    s.accounts = [account('egp', 'EGP', 0), account('sar', 'SAR', 0)];
    const add = (input: ops.NewIncomeExpense) => {
      s = apply(s, ops.addTransaction(s, input, ctx));
    };
    add({ type: 'income', amount: 10000, currency: 'SAR', accountId: 'sar', categoryId: 'cat-income-salary', date: '2026-10-01', rateToEGP: 12 });
    add({ type: 'expense', amount: 20000, currency: 'EGP', accountId: 'egp', categoryId: 'cat-essentials-rent', date: '2026-10-02' });
    add({ type: 'expense', amount: 100, currency: 'SAR', accountId: 'sar', categoryId: 'cat-lifestyle-dining', date: '2026-10-03', rateToEGP: 13 });
    // No explicit rate → snapshot of the current SAR rate (12.5).
    add({ type: 'expense', amount: 80, currency: 'SAR', accountId: 'sar', categoryId: 'cat-giving-sadaqah', date: '2026-10-04' });
    // Other month and transfers are excluded.
    add({ type: 'expense', amount: 999, currency: 'EGP', accountId: 'egp', categoryId: 'cat-essentials-rent', date: '2026-09-30' });
    s = apply(s, ops.addTransfer(s, { fromAccountId: 'sar', toAccountId: 'egp', amount: 100, date: '2026-10-05' }, ctx));

    // Later rate changes must not rewrite history.
    s = apply(s, ops.updateRates(s, { ...RATES, SAR_EGP: 20 }));

    const summary = monthSummary(s, '2026-10');
    approx(summary.incomeEGP, 120000);
    approx(summary.expenseEGP, 20000 + 1300 + 1000);
    approx(summary.expenseByBucket.essentials, 20000);
    approx(summary.expenseByBucket.lifestyle, 1300);
    approx(summary.expenseByBucket.giving, 1000);
    approx(summary.netCashFlow, 120000 - 22300);
    approx(summary.savingsRate, (120000 - 22300) / 120000);
    assert.equal(monthSummary(s, '2026-08').savingsRate, null);

    s = apply(s, ops.setMonthlyPlan(s, { month: '2026-10', expectedIncomeEGP: 120000, bucketLimitsEGP: { lifestyle: 5000 } }));
    approx(safeToSpend(s, '2026-10'), 5000 - 1300);
    assert.equal(safeToSpend(s, '2026-11'), null);
  });

  it('suggestedEmergencyTarget averages essentials over the last 3 full months', () => {
    const ctx = makeCtx();
    let s = emptyState();
    s.accounts = [account('egp', 'EGP', 0)];
    for (const [date, amount] of [['2026-07-10', 9000], ['2026-08-10', 12000], ['2026-09-10', 15000], ['2026-10-10', 99999]] as const) {
      s = apply(s, ops.addTransaction(s, { type: 'expense', amount, currency: 'EGP', accountId: 'egp', categoryId: 'cat-essentials-rent', date }, ctx));
    }
    approx(suggestedEmergencyTarget(s, 3, NOW), 12000 * 3);
    approx(suggestedEmergencyTarget(s, 6, NOW), 12000 * 6);
  });
});

// --- Transfers & validation -------------------------------------------------

describe('transfers', () => {
  const twoAccounts = (): FinanceStateV2 => ({
    ...emptyState(),
    accounts: [account('sar', 'SAR', 1000), account('egp', 'EGP', 0)],
  });

  it('moves SAR out and EGP in, converting at current rates by default', () => {
    let s = twoAccounts();
    const before = liquidTotalEGP(s);
    s = apply(s, ops.addTransfer(s, { fromAccountId: 'sar', toAccountId: 'egp', amount: 400, date: '2026-10-05' }, makeCtx()));
    approx(accountBalance(s, 'sar'), 600);
    approx(accountBalance(s, 'egp'), 5000);
    approx(liquidTotalEGP(s), before);
    const [tx] = s.transactions;
    assert.equal(tx.type, 'transfer');
    assert.equal(tx.rateToEGP, 12.5);
  });

  it('records the actual received amount when given (e.g. after fees)', () => {
    let s = twoAccounts();
    s = apply(s, ops.addTransfer(s, { fromAccountId: 'sar', toAccountId: 'egp', amount: 400, toAmount: 4900, date: '2026-10-05' }, makeCtx()));
    approx(accountBalance(s, 'egp'), 4900);
  });

  it('rejects invalid transfers', () => {
    const s = twoAccounts();
    const ctx = makeCtx();
    const transfer = (input: Partial<ops.NewTransfer>) =>
      ops.addTransfer(s, { fromAccountId: 'sar', toAccountId: 'egp', amount: 100, date: '2026-10-05', ...input }, ctx);
    assert.throws(() => transfer({ amount: 0 }), ops.FinanceValidationError);
    assert.throws(() => transfer({ toAccountId: 'missing' }), ops.FinanceValidationError);
    assert.throws(() => transfer({ toAccountId: 'sar' }), ops.FinanceValidationError);
  });
});

describe('action validation', () => {
  it('rejects bad amounts and unknown or mismatched references', () => {
    const s: FinanceStateV2 = { ...emptyState(), accounts: [account('egp', 'EGP', 0)] };
    const ctx = makeCtx();
    const expense = (input: Partial<ops.NewIncomeExpense>) =>
      ops.addTransaction(
        s,
        { type: 'expense', amount: 10, currency: 'EGP', accountId: 'egp', categoryId: 'cat-essentials-rent', date: '2026-10-01', ...input } as ops.NewIncomeExpense,
        ctx
      );
    assert.doesNotThrow(() => expense({}));
    assert.throws(() => expense({ amount: -5 }), { code: 'NOT_POSITIVE', details: { field: 'amount' } });
    assert.throws(() => expense({ accountId: 'nope' }), { code: 'NOT_FOUND', details: { entity: 'account', id: 'nope' } });
    assert.throws(() => expense({ categoryId: 'nope' }), { code: 'NOT_FOUND' });
    assert.throws(() => expense({ categoryId: 'cat-income-salary' }), { code: 'CATEGORY_KIND_MISMATCH' });
    assert.throws(() => expense({ currency: 'SAR' }), { code: 'CURRENCY_MISMATCH' });
    assert.throws(() => ops.allocateToFund(s, 'nope', 10, undefined, ctx), { code: 'NOT_FOUND' });
  });

  it('refuses to delete an account that has transactions', () => {
    const ctx = makeCtx();
    let s: FinanceStateV2 = { ...emptyState(), accounts: [account('egp', 'EGP', 0)] };
    s = apply(s, ops.addTransaction(s, { type: 'income', amount: 10, currency: 'EGP', accountId: 'egp', categoryId: 'cat-income-salary', date: '2026-10-01' }, ctx));
    assert.throws(() => ops.deleteAccount(s, 'egp'), { code: 'ACCOUNT_IN_USE' });
  });

  it('maps every error to an Arabic message', () => {
    const arabic = /[؀-ۿ]/;
    const error = new FinanceValidationError('NOT_POSITIVE', { field: 'weightGrams' });
    assert.equal(errorMessage(error), 'الوزن يجب أن يكون أكبر من صفر');
    assert.match(errorMessage(new FinanceValidationError('INSUFFICIENT_UNASSIGNED')), arabic);
    assert.match(errorMessage(new Error('boom')), arabic);
  });
});

// --- Follow-up rules --------------------------------------------------------

describe('one fund per holding', () => {
  const state = (): FinanceStateV2 => ({
    ...emptyState(),
    holdings: [
      { id: 'gold', type: 'gold', name: 'Gold', weightGrams: 10, karat: 24, purchaseCostEGP: 0 },
      { id: 'usd', type: 'currency', name: 'USD', currency: 'USD', quantity: 100, purchaseCostEGP: 0 },
    ],
    funds: [fund({ id: 'a', linkedHoldingIds: ['gold'] })],
  });

  it('rejects linking a holding that already backs another fund', () => {
    const s = state();
    const input: ops.NewFund = { name: 'B', type: 'sinking', targetAmount: 1000, currency: 'EGP', priority: 2 };
    assert.throws(() => ops.addFund(s, { ...input, linkedHoldingIds: ['gold'] }, makeCtx()), {
      code: 'HOLDING_ALREADY_LINKED',
    });
    assert.doesNotThrow(() => ops.addFund(s, { ...input, linkedHoldingIds: ['usd'] }, makeCtx()));
    assert.throws(() => ops.updateFund(s, { ...s.funds[0], linkedHoldingIds: ['usd', 'usd'] }), {
      code: 'HOLDING_ALREADY_LINKED',
    });
  });

  it('lets a fund keep its own links when it is updated', () => {
    const s = state();
    assert.doesNotThrow(() => ops.updateFund(s, { ...s.funds[0], name: 'Renamed', linkedHoldingIds: ['gold', 'usd'] }));
  });
});

describe('set current balance', () => {
  it('solves openingBalance so the derived balance equals the entered one', () => {
    const ctx = makeCtx();
    let s: FinanceStateV2 = { ...emptyState(), accounts: [account('egp', 'EGP', 1000), account('sar', 'SAR', 0)] };
    s = apply(s, ops.addTransaction(s, { type: 'income', amount: 500, currency: 'EGP', accountId: 'egp', categoryId: 'cat-income-salary', date: '2026-10-01' }, ctx));
    s = apply(s, ops.addTransaction(s, { type: 'expense', amount: 200, currency: 'EGP', accountId: 'egp', categoryId: 'cat-essentials-rent', date: '2026-10-02' }, ctx));
    s = apply(s, ops.addTransfer(s, { fromAccountId: 'egp', toAccountId: 'sar', amount: 100, date: '2026-10-03' }, ctx));
    approx(accountBalance(s, 'egp'), 1200);

    const egp = s.accounts[0];
    s = apply(
      s,
      ops.updateAccount(s, { ...egp, name: 'Main', openingBalance: openingBalanceForCurrentBalance(s, 'egp', 5000) })
    );
    approx(accountBalance(s, 'egp'), 5000);
    assert.equal(s.accounts[0].openingBalance, 4800);
    assert.equal(s.accounts[0].name, 'Main');
  });
});

describe('editFund', () => {
  // 50,000 liquid; 30,000 already allocated → 20,000 unassigned.
  const state = (): FinanceStateV2 => ({
    ...emptyState(),
    accounts: [account('egp', 'EGP', 50000)],
    funds: [fund({ id: 'f', deadline: '2026-12-31' })],
    fundMovements: [{ id: 'm1', fundId: 'f', amount: 30000, date: '2026-09-01' }],
  });
  const edit = (cashAllocation: number): ops.FundEdit => ({
    name: ' Wedding ',
    targetAmount: 120000,
    cashAllocation,
  });

  it('updates details and adds one adjustment movement for the difference', () => {
    const s = apply(state(), ops.editFund(state(), 'f', edit(45000), makeCtx()));
    const f = s.funds[0];
    assert.equal(f.name, 'Wedding');
    assert.equal(f.targetAmount, 120000);
    assert.equal(f.deadline, undefined); // cleared
    assert.equal(s.fundMovements.length, 2);
    assert.equal(s.fundMovements[1].amount, 15000);
    approx(fundAllocated(s, 'f'), 45000);
    approx(unassignedEGP(s), 5000);
  });

  it('previews and enforces unassigned money', () => {
    const s = state();
    approx(unassignedEGPWithFundCash(s, 'f', 60000), -10000);
    assert.throws(() => ops.editFund(s, 'f', edit(60000), makeCtx()), { code: 'INSUFFICIENT_UNASSIGNED' });
    assert.throws(() => ops.editFund(s, 'f', edit(-1), makeCtx()), { code: 'NEGATIVE' });
  });

  it('always allows reducing an allocation, even when unassigned is already negative', () => {
    const s: FinanceStateV2 = { ...state(), accounts: [account('egp', 'EGP', 10000)] }; // unassigned −20,000
    const after = apply(s, ops.editFund(s, 'f', edit(25000), makeCtx()));
    approx(unassignedEGP(after), -15000);
  });

  it('adds no movement when the allocation is unchanged', () => {
    const s = apply(state(), ops.editFund(state(), 'f', edit(30000), makeCtx()));
    assert.equal(s.fundMovements.length, 1);
  });
});

// --- Transactions feature ---------------------------------------------------

describe('parseAmount', () => {
  it('accepts Western/Arabic digits, thousands separators and decimals', () => {
    assert.equal(parseAmount('1,250.5'), 1250.5);
    assert.equal(parseAmount('١٢٥٠'), 1250);
    assert.equal(parseAmount('٣٥٠٠٫٧٥'), 3500.75);
    assert.equal(parseAmount('١٬٢٥٠'), 1250);
    assert.equal(parseAmount(' 42 '), 42);
    assert.equal(parseAmount('.5'), 0.5);
  });

  it('rejects empty, non-numeric, zero and negative input', () => {
    assert.equal(parseAmount(''), null);
    assert.equal(parseAmount('   '), null);
    assert.equal(parseAmount('abc'), null);
    assert.equal(parseAmount('12abc'), null);
    assert.equal(parseAmount('1.2.3'), null);
    assert.equal(parseAmount('0'), null);
    assert.equal(parseAmount('-5'), null);
    assert.equal(parseAmount('−5'), null);
  });
});

describe('transaction lists', () => {
  // Two accounts, a mix of types, currencies and days.
  const build = () => {
    const ctx = makeCtx();
    let s: FinanceStateV2 = { ...emptyState(), accounts: [account('egp', 'EGP', 0), account('sar', 'SAR', 1000)] };
    const add = (input: ops.NewIncomeExpense) => {
      s = apply(s, ops.addTransaction(s, input, ctx));
    };
    add({ type: 'income', amount: 1000, currency: 'SAR', accountId: 'sar', categoryId: 'cat-income-salary', date: '2026-10-01', rateToEGP: 12 });
    add({ type: 'expense', amount: 300, currency: 'EGP', accountId: 'egp', categoryId: 'cat-essentials-rent', date: '2026-10-01' });
    add({ type: 'expense', amount: 10, currency: 'SAR', accountId: 'sar', categoryId: 'cat-lifestyle-dining', date: '2026-10-03', rateToEGP: 13 });
    add({ type: 'expense', amount: 50, currency: 'EGP', accountId: 'egp', categoryId: 'cat-essentials-rent', date: '2026-09-30' });
    s = apply(s, ops.addTransfer(s, { fromAccountId: 'sar', toAccountId: 'egp', amount: 100, date: '2026-10-03' }, ctx));
    return s;
  };

  it('transactionsForMonth filters by month and type, newest first', () => {
    const s = build();
    const all = transactionsForMonth(s, '2026-10');
    assert.equal(all.length, 4);
    assert.deepEqual(all.map((t) => t.date), ['2026-10-03', '2026-10-03', '2026-10-01', '2026-10-01']);
    assert.equal(transactionsForMonth(s, '2026-10', 'expense').length, 2);
    assert.equal(transactionsForMonth(s, '2026-10', 'income').length, 1);
    assert.equal(transactionsForMonth(s, '2026-10', 'transfer').length, 1);
    assert.equal(transactionsForMonth(s, '2026-09').length, 1);
    assert.equal(transactionsForMonth(s, '2026-11').length, 0);
  });

  it('groupTransactionsByDay orders days and nets each day in EGP at stored rates', () => {
    const groups = groupTransactionsByDay(transactionsForMonth(build(), '2026-10'));
    assert.deepEqual(groups.map((g) => [g.date, g.transactions.length]), [
      ['2026-10-03', 2],
      ['2026-10-01', 2],
    ]);
    approx(groups[0].netEGP, -10 * 13); // the transfer is neutral
    approx(groups[1].netEGP, 1000 * 12 - 300);
    // Within a day, the later-created transaction comes first.
    assert.equal(groups[0].transactions[0].type, 'transfer');
  });

  it('remembers the last account and category per type', () => {
    assert.deepEqual(build().settings.lastUsed, {
      income: { accountId: 'sar', categoryId: 'cat-income-salary' },
      expense: { accountId: 'egp', categoryId: 'cat-essentials-rent' },
      transfer: { fromAccountId: 'sar', toAccountId: 'egp' },
    });
  });
});

describe('editing transactions', () => {
  const setup = () => {
    let s: FinanceStateV2 = {
      ...emptyState(),
      accounts: [account('sar', 'SAR', 0), account('sar2', 'SAR', 0), account('egp', 'EGP', 0)],
    };
    s = apply(
      s,
      ops.addTransaction(s, { type: 'expense', amount: 100, currency: 'SAR', accountId: 'sar', categoryId: 'cat-lifestyle-dining', date: '2026-10-02', rateToEGP: 11 }, makeCtx())
    );
    // Rates move after the transaction was recorded.
    return apply(s, ops.updateRates(s, { ...RATES, SAR_EGP: 14 }));
  };

  const expenseOf = (s: FinanceStateV2) => {
    const tx = s.transactions[0];
    if (tx.type !== 'expense') throw new Error('expected an expense');
    return tx;
  };

  it('keeps the snapshotted rate and createdAt when the currency is unchanged', () => {
    const s = setup();
    const tx = expenseOf(s);
    const after = apply(
      s,
      ops.updateTransaction(s, { ...tx, amount: 150, accountId: 'sar2', rateToEGP: 999, createdAt: 'tampered' })
    );
    const updated = after.transactions[0];
    assert.equal(updated.amount, 150);
    assert.equal(updated.rateToEGP, 11);
    assert.equal(updated.createdAt, tx.createdAt);
  });

  it('re-snapshots the rate when moved to an account in another currency', () => {
    const s = setup();
    const tx = expenseOf(s);
    const after = apply(s, ops.updateTransaction(s, { ...tx, accountId: 'egp', currency: 'EGP', amount: 1500 }));
    assert.equal(after.transactions[0].rateToEGP, 1);
    // ...and still validates the currency against the account, like add does.
    assert.throws(() => ops.updateTransaction(s, { ...tx, accountId: 'egp' }), { code: 'CURRENCY_MISMATCH' });
  });

  it('can turn an expense into a transfer', () => {
    const s = setup();
    const tx = s.transactions[0];
    const after = apply(
      s,
      ops.updateTransaction(s, {
        id: tx.id,
        type: 'transfer',
        fromAccountId: 'sar',
        toAccountId: 'egp',
        amount: 100,
        toAmount: 1400,
        date: tx.date,
        rateToEGP: tx.rateToEGP,
        createdAt: tx.createdAt,
      })
    );
    approx(accountBalance(after, 'egp'), 1400);
    approx(accountBalance(after, 'sar'), -100);
    assert.equal(after.transactions[0].rateToEGP, 11); // still SAR-denominated
  });

  it('deleting a transaction restores the account balance', () => {
    const s = setup();
    approx(accountBalance(s, 'sar'), -100);
    const after = apply(s, ops.deleteTransaction(s, s.transactions[0].id));
    approx(accountBalance(after, 'sar'), 0);
    assert.throws(() => ops.deleteTransaction(after, 'missing'), { code: 'NOT_FOUND' });
  });
});

describe('formatDayLabel', () => {
  it('names today and yesterday', () => {
    assert.equal(formatDayLabel('2026-10-15', NOW), 'النهارده');
    assert.equal(formatDayLabel('2026-10-14', NOW), 'امبارح');
    assert.match(formatDayLabel('2026-10-13', NOW), /أكتوبر/);
  });
});
