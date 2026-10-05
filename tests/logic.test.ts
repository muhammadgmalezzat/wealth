// Pure-logic tests for the finance model. Run with: npm run test:logic
// TypeScript 6 no longer auto-includes @types packages, so opt in to Node types here.
/// <reference types="node" />
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';

import * as home from '@/components/dashboard/homeInsights';
import * as planUi from '@/components/plan/planUi';
import * as txUi from '@/components/transactions/transactionUi';
import { GOLD_PRICE_24K } from '@/constants/market';
import { CATEGORY_IDS, DEFAULT_CATEGORIES } from '@/store/defaultCategories';
import { FinanceValidationError } from '@/store/errors';
import {
  BackupError,
  backupFileName,
  backupPreview,
  createBackup,
  openBackup,
  parseBackup,
  PBKDF2_ITERATIONS,
  serializeBackup,
  utf8Decode,
  utf8Encode,
  type BackupFile,
  type EncryptedPayload,
} from '@/store/backup';
import {
  CURRENT_VERSION,
  migratePersistedState,
  migrateV2toV3,
  migrateV3toV4,
  migrateV4toV5,
  migrateV5toV6,
  type FinanceStateV1,
} from '@/store/migrations';
import * as planning from '@/store/planning';
import * as recurring from '@/store/recurring';
import * as ops from '@/store/operations';
import {
  accountBalance,
  defaultCoverFundId,
  fundAllocated,
  fundCurrent,
  fundProgress,
  fundRequiredMonthly,
  fundStatus,
  goldTotals,
  groupTransactionsByDay,
  holdingsTotalEGP,
  liabilitiesTotalEGP,
  liquidByCurrency,
  liquidTotalEGP,
  monthSummary,
  netWorthByLocation,
  netWorthEGP,
  openingBalanceForCurrentBalance,
  pickerCategories,
  planCover,
  sinkingMonthlySuggestion,
  stateSummary,
  suggestAllocation,
  suggestedEmergencyTarget,
  transactionsForMonth,
  unassignedEGP,
  unassignedEGPWithFundCash,
} from '@/store/selectors';
import type { FinanceState, Fund, RecurringRule, Transaction } from '@/store/types';
import { addMonthsToDate } from '@/utils/dates';
import { errorMessage } from '@/utils/errorMessages';
import { formatDayLabel } from '@/utils/formatters';
import { parseAmount } from '@/utils/parseAmount';

// --- Fixtures ---------------------------------------------------------------

const RATES = { SAR_EGP: 12.5, USD_EGP: 50, lastUpdated: '2026-10-01T00:00:00.000Z' };
const NOW = new Date(2026, 9, 15, 12); // 15 Oct 2026, local time
const MIGRATION_CTX = { now: '2026-10-15T09:00:00.000Z', newId: () => 'migrated-device' };
// updatedAt for hand-built fixtures.
const T0 = '2026-01-01T00:00:00.000Z';

function makeCtx(): ops.OpContext {
  let seq = 0;
  return { newId: () => `id-${++seq}`, now: () => NOW };
}

function emptyState(): FinanceState {
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
    settings: {
      exchangeRates: RATES,
      goldPrice24kEGP: 6000,
      goldPrice21kEGP: 6000 * (21 / 24),
      goldPriceUpdatedAt: '2026-10-01T00:00:00.000Z',
      // Early enough that every fixture month counts.
      trackingStartDate: '2026-01-01',
      deviceId: 'test-device',
    },
    tombstones: [],
  };
}

const apply = (state: FinanceState, patch: Partial<FinanceState>): FinanceState => ({
  ...state,
  ...patch,
});

const approx = (actual: number | null, expected: number) => {
  assert.notEqual(actual, null);
  assert.ok(Math.abs((actual as number) - expected) < 1e-6, `expected ${expected}, got ${actual}`);
};

const account = (
  id: string,
  currency: 'EGP' | 'SAR' | 'USD',
  openingBalance: number,
  location: 'EG' | 'SA' = 'EG'
) => ({
  id,
  name: id,
  type: 'bank' as const,
  currency,
  openingBalance,
  location,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: T0,
});

const fund = (overrides: Partial<Fund> & Pick<Fund, 'id'>): Fund => ({
  name: overrides.id,
  type: 'goal',
  targetAmount: 100000,
  currency: 'EGP',
  priority: 1,
  linkedHoldingIds: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: T0,
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

  it('leaves current-version data untouched', () => {
    const state = emptyState();
    const result = migratePersistedState(state, CURRENT_VERSION, MIGRATION_CTX);
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
      { id: 'gold', updatedAt: T0, type: 'gold', name: 'Gold', weightGrams: 10, karat: 24, purchaseCostEGP: 50000 },
      { id: 'usd', updatedAt: T0, type: 'currency', name: 'USD', currency: 'USD', quantity: 100, purchaseCostEGP: 4800 },
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
  const withGold = (): FinanceState => ({
    ...emptyState(),
    holdings: [{ id: 'gold', updatedAt: T0, type: 'gold', name: 'Gold', weightGrams: 10, karat: 24, purchaseCostEGP: 50000 }],
  });

  it('fundCurrent = cash movements + market value of linked gold (in fund currency)', () => {
    const s = withGold();
    s.funds = [
      fund({ id: 'egp', linkedHoldingIds: ['gold'] }),
      fund({ id: 'sar', currency: 'SAR', targetAmount: 10000, linkedHoldingIds: ['gold'] }),
    ];
    s.fundMovements = [
      { id: 'm1', updatedAt: T0, fundId: 'egp', amount: 10000, date: '2026-09-01' },
      { id: 'm2', updatedAt: T0, fundId: 'sar', amount: 200, date: '2026-09-01' },
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
    s.fundMovements = [{ id: 'm1', updatedAt: T0, fundId: 'dated', amount: 10000, date: '2026-09-01' }];
    approx(fundRequiredMonthly(s, 'dated', NOW), (100000 - 70000) / 3); // Oct, Nov, Dec
    assert.equal(fundRequiredMonthly(s, 'open', NOW), null);
    approx(fundRequiredMonthly(s, 'overdue', NOW), 100000); // everything due now
  });

  it('fundStatus compares this month’s allocations with the requirement', () => {
    const ctx = makeCtx();
    const base = withGold();
    base.funds = [fund({ id: 'f', deadline: '2026-12-31', linkedHoldingIds: ['gold'] }), fund({ id: 'open' })];
    base.fundMovements = [{ id: 'm1', updatedAt: T0, fundId: 'f', amount: 10000, date: '2026-09-01' }];
    // At month start: 70,000 of 100,000 → 10,000/month required.
    const allocate = (amount: number) => apply(base, ops.allocateToFund(base, 'f', amount, undefined, ctx));

    // NOW = 15 Oct (17 days left): not done yet, but there's still time → pending.
    assert.equal(fundStatus(base, 'f', NOW), 'pending');
    assert.equal(fundStatus(allocate(5000), 'f', NOW), 'pending');
    // 26 Oct (6 days left): the same shortfall is now behind. The fixture fund was created in
    // January, so the "created this month" rule doesn't apply.
    const OCT_26 = new Date(2026, 9, 26, 12);
    assert.equal(fundStatus(base, 'f', OCT_26), 'behind');
    assert.equal(fundStatus(allocate(5000), 'f', OCT_26), 'behind');
    assert.equal(fundStatus(allocate(10000), 'f', NOW), 'on_track');
    assert.equal(fundStatus(allocate(12000), 'f', NOW), 'ahead');
    assert.equal(fundStatus(base, 'open', NOW), 'no_deadline');
  });

  it('withdrawals cannot exceed the fund’s cash', () => {
    const ctx = makeCtx();
    const s = withGold();
    s.funds = [fund({ id: 'f', linkedHoldingIds: ['gold'] })];
    s.fundMovements = [{ id: 'm1', updatedAt: T0, fundId: 'f', amount: 1000, date: '2026-09-01' }];
    assert.throws(() => ops.withdrawFromFund(s, 'f', 1500, undefined, ctx), ops.FinanceValidationError);
    const after = apply(s, ops.withdrawFromFund(s, 'f', 400, 'repair', ctx));
    approx(fundCurrent(after, 'f'), 60000 + 600);
  });
});

describe('unassignedEGP', () => {
  it('= liquid − cash allocated to funds (linked holdings excluded)', () => {
    const s = emptyState();
    s.accounts = [account('egp', 'EGP', 50000), account('sar', 'SAR', 2000)];
    s.holdings = [{ id: 'gold', updatedAt: T0, type: 'gold', name: 'Gold', weightGrams: 10, karat: 24, purchaseCostEGP: 0 }];
    s.funds = [fund({ id: 'egp-fund', linkedHoldingIds: ['gold'] }), fund({ id: 'sar-fund', currency: 'SAR' })];
    s.fundMovements = [
      { id: 'm1', updatedAt: T0, fundId: 'egp-fund', amount: 30000, date: '2026-09-01' },
      { id: 'm2', updatedAt: T0, fundId: 'sar-fund', amount: 400, date: '2026-09-01' },
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
  const twoAccounts = (): FinanceState => ({
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
    const s: FinanceState = { ...emptyState(), accounts: [account('egp', 'EGP', 0)] };
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
    let s: FinanceState = { ...emptyState(), accounts: [account('egp', 'EGP', 0)] };
    s = apply(s, ops.addTransaction(s, { type: 'income', amount: 10, currency: 'EGP', accountId: 'egp', categoryId: 'cat-income-salary', date: '2026-10-01' }, ctx));
    assert.throws(() => ops.deleteAccount(s, 'egp', makeCtx()), { code: 'ACCOUNT_IN_USE' });
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
  const state = (): FinanceState => ({
    ...emptyState(),
    holdings: [
      { id: 'gold', updatedAt: T0, type: 'gold', name: 'Gold', weightGrams: 10, karat: 24, purchaseCostEGP: 0 },
      { id: 'usd', updatedAt: T0, type: 'currency', name: 'USD', currency: 'USD', quantity: 100, purchaseCostEGP: 0 },
    ],
    funds: [fund({ id: 'a', linkedHoldingIds: ['gold'] })],
  });

  it('rejects linking a holding that already backs another fund', () => {
    const s = state();
    const input: ops.NewFund = { name: 'B', type: 'goal', targetAmount: 1000, currency: 'EGP', priority: 2 };
    assert.throws(() => ops.addFund(s, { ...input, linkedHoldingIds: ['gold'] }, makeCtx()), {
      code: 'HOLDING_ALREADY_LINKED',
    });
    assert.doesNotThrow(() => ops.addFund(s, { ...input, linkedHoldingIds: ['usd'] }, makeCtx()));
    assert.throws(() => ops.updateFund(s, { ...s.funds[0], linkedHoldingIds: ['usd', 'usd'] }, makeCtx()), {
      code: 'HOLDING_ALREADY_LINKED',
    });
  });

  it('lets a fund keep its own links when it is updated', () => {
    const s = state();
    assert.doesNotThrow(() => ops.updateFund(s, { ...s.funds[0], name: 'Renamed', linkedHoldingIds: ['gold', 'usd'] }, makeCtx()));
  });
});

describe('set current balance', () => {
  it('solves openingBalance so the derived balance equals the entered one', () => {
    const ctx = makeCtx();
    let s: FinanceState = { ...emptyState(), accounts: [account('egp', 'EGP', 1000), account('sar', 'SAR', 0)] };
    s = apply(s, ops.addTransaction(s, { type: 'income', amount: 500, currency: 'EGP', accountId: 'egp', categoryId: 'cat-income-salary', date: '2026-10-01' }, ctx));
    s = apply(s, ops.addTransaction(s, { type: 'expense', amount: 200, currency: 'EGP', accountId: 'egp', categoryId: 'cat-essentials-rent', date: '2026-10-02' }, ctx));
    s = apply(s, ops.addTransfer(s, { fromAccountId: 'egp', toAccountId: 'sar', amount: 100, date: '2026-10-03' }, ctx));
    approx(accountBalance(s, 'egp'), 1200);

    const egp = s.accounts[0];
    s = apply(
      s,
      ops.updateAccount(s, { ...egp, name: 'Main', openingBalance: openingBalanceForCurrentBalance(s, 'egp', 5000) }, makeCtx())
    );
    approx(accountBalance(s, 'egp'), 5000);
    assert.equal(s.accounts[0].openingBalance, 4800);
    assert.equal(s.accounts[0].name, 'Main');
  });
});

describe('editFund', () => {
  // 50,000 liquid; 30,000 already allocated → 20,000 unassigned.
  const state = (): FinanceState => ({
    ...emptyState(),
    accounts: [account('egp', 'EGP', 50000)],
    funds: [fund({ id: 'f', deadline: '2026-12-31' })],
    fundMovements: [{ id: 'm1', updatedAt: T0, fundId: 'f', amount: 30000, date: '2026-09-01' }],
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
    const s: FinanceState = { ...state(), accounts: [account('egp', 'EGP', 10000)] }; // unassigned −20,000
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
    let s: FinanceState = { ...emptyState(), accounts: [account('egp', 'EGP', 0), account('sar', 'SAR', 1000)] };
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
    let s: FinanceState = {
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

  const expenseOf = (s: FinanceState) => {
    const tx = s.transactions[0];
    if (tx.type !== 'expense') throw new Error('expected an expense');
    return tx;
  };

  it('keeps the snapshotted rate and createdAt when the currency is unchanged', () => {
    const s = setup();
    const tx = expenseOf(s);
    const after = apply(
      s,
      ops.updateTransaction(s, { ...tx, amount: 150, accountId: 'sar2', rateToEGP: 999, createdAt: 'tampered' }, makeCtx())
    );
    const updated = after.transactions[0];
    assert.equal(updated.amount, 150);
    assert.equal(updated.rateToEGP, 11);
    assert.equal(updated.createdAt, tx.createdAt);
  });

  it('re-snapshots the rate when moved to an account in another currency', () => {
    const s = setup();
    const tx = expenseOf(s);
    const after = apply(s, ops.updateTransaction(s, { ...tx, accountId: 'egp', currency: 'EGP', amount: 1500 }, makeCtx()));
    assert.equal(after.transactions[0].rateToEGP, 1);
    // ...and still validates the currency against the account, like add does.
    assert.throws(() => ops.updateTransaction(s, { ...tx, accountId: 'egp' }, makeCtx()), { code: 'CURRENCY_MISMATCH' });
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
      }, makeCtx())
    );
    approx(accountBalance(after, 'egp'), 1400);
    approx(accountBalance(after, 'sar'), -100);
    assert.equal(after.transactions[0].rateToEGP, 11); // still SAR-denominated
  });

  it('deleting a transaction restores the account balance', () => {
    const s = setup();
    approx(accountBalance(s, 'sar'), -100);
    const after = apply(s, ops.deleteTransaction(s, s.transactions[0].id, makeCtx()));
    approx(accountBalance(after, 'sar'), 0);
    assert.throws(() => ops.deleteTransaction(after, 'missing', makeCtx()), { code: 'NOT_FOUND' });
  });
});

describe('formatDayLabel', () => {
  it('names today and yesterday', () => {
    assert.equal(formatDayLabel('2026-10-15', NOW), 'النهارده');
    assert.equal(formatDayLabel('2026-10-14', NOW), 'امبارح');
    assert.match(formatDayLabel('2026-10-13', NOW), /أكتوبر/);
  });
});

// --- Funds feature ----------------------------------------------------------

describe('fund allocation', () => {
  // 100,000 EGP liquid; F already holds 900 cash → 99,100 unassigned.
  const state = (): FinanceState => ({
    ...emptyState(),
    accounts: [account('egp', 'EGP', 100000)],
    funds: [
      fund({ id: 'A', type: 'emergency', priority: 1, targetAmount: 30000, monthlyContribution: 5000 }),
      fund({ id: 'B', priority: 2, targetAmount: 12000, deadline: '2026-12-31' }), // 3 months → 4,000
      fund({ id: 'C', type: 'sinking', priority: 3, targetAmount: 2400, frequency: 'yearly', nextDueDate: '2027-09-30' }), // 12 months → 200
      fund({ id: 'D', priority: 4, targetAmount: 50000 }), // no deadline, no plan → nothing suggested
      fund({ id: 'F', priority: 5, targetAmount: 1000, monthlyContribution: 500 }), // only 100 left to reach
    ],
    fundMovements: [{ id: 'm1', updatedAt: T0, fundId: 'F', amount: 900, date: '2026-09-01' }],
  });

  it('suggestAllocation follows priority and caps each fund', () => {
    const s = state();
    assert.deepEqual(suggestAllocation(s, unassignedEGP(s), NOW), [
      { fundId: 'A', amount: 5000 },
      { fundId: 'B', amount: 4000 },
      { fundId: 'C', amount: 200 },
      { fundId: 'F', amount: 100 },
    ]);
    // Money runs out part-way through B.
    assert.deepEqual(suggestAllocation(s, 7000, NOW), [
      { fundId: 'A', amount: 5000 },
      { fundId: 'B', amount: 2000 },
    ]);
    assert.deepEqual(suggestAllocation(s, 0, NOW), []);
  });

  it('allocateMany applies everything or nothing, never beyond unassigned money', () => {
    const s = state();
    const ctx = makeCtx();
    assert.throws(
      () => ops.allocateMany(s, [{ fundId: 'A', amount: 60000 }, { fundId: 'B', amount: 40000 }], undefined, ctx),
      { code: 'INSUFFICIENT_UNASSIGNED' }
    );
    assert.throws(() => ops.allocateMany(s, [{ fundId: 'A', amount: 10 }, { fundId: 'B', amount: -1 }], undefined, ctx), {
      code: 'NOT_POSITIVE',
    });
    assert.throws(() => ops.allocateMany(s, [], undefined, ctx), { code: 'NOTHING_SELECTED' });

    const after = apply(s, ops.allocateMany(s, suggestAllocation(s, unassignedEGP(s), NOW), 'توزيع', ctx));
    assert.equal(after.fundMovements.length, 1 + 4);
    approx(unassignedEGP(after), 99100 - 9300);
  });

  it('sinkingMonthlySuggestion spreads the cycle amount until it is due', () => {
    approx(sinkingMonthlySuggestion({ type: 'sinking', targetAmount: 2400, nextDueDate: '2027-09-30' }, NOW), 200);
    assert.equal(sinkingMonthlySuggestion({ type: 'goal', targetAmount: 2400 }, NOW), null);
    assert.equal(sinkingMonthlySuggestion({ type: 'sinking', targetAmount: 2400 }, NOW), null);
  });

  it('sinking funds need a schedule and drop the goal deadline', () => {
    const s = state();
    const base: ops.NewFund = { name: 'Car insurance', type: 'sinking', targetAmount: 6000, currency: 'EGP', priority: 6 };
    assert.throws(() => ops.addFund(s, base, makeCtx()), { code: 'SINKING_SCHEDULE_REQUIRED' });
    const after = apply(
      s,
      ops.addFund(s, { ...base, frequency: 'semiannual', nextDueDate: '2027-01-31', deadline: '2027-05-01' }, makeCtx())
    );
    const created = after.funds[after.funds.length - 1];
    assert.equal(created.deadline, undefined);
    assert.equal(created.nextDueDate, '2027-01-31');
    assert.equal(fundRequiredMonthly(after, created.id, NOW), 6000 / 4); // Oct → Jan
  });
});

describe('covering overspent fund money', () => {
  // 10,000 liquid, 9,000 allocated; then a 5,000 expense → unassigned −4,000.
  const state = (): FinanceState => {
    let s: FinanceState = {
      ...emptyState(),
      accounts: [account('egp', 'EGP', 10000)],
      funds: [fund({ id: 'A', priority: 1 }), fund({ id: 'B', priority: 2 })],
      fundMovements: [
        { id: 'm1', updatedAt: T0, fundId: 'A', amount: 6000, date: '2026-09-01' },
        { id: 'm2', updatedAt: T0, fundId: 'B', amount: 3000, date: '2026-09-01' },
      ],
    };
    s = apply(s, ops.addTransaction(s, { type: 'expense', amount: 5000, currency: 'EGP', accountId: 'egp', categoryId: 'cat-essentials-bills', date: '2026-10-10' }, makeCtx()));
    return s;
  };

  it('defaults to the lowest-priority fund with cash and reports what is left', () => {
    const s = state();
    approx(unassignedEGP(s), -4000);
    assert.equal(defaultCoverFundId(s), 'B');
    const plan = planCover(s, ['B']);
    assert.deepEqual(plan.withdrawals, [{ fundId: 'B', amount: 3000 }]);
    approx(plan.remainingEGP, 1000);
  });

  it('brings unassigned money back to zero when enough funds are chosen', () => {
    const s = state();
    const plan = planCover(s, ['A', 'B']);
    assert.deepEqual(plan.withdrawals, [
      { fundId: 'B', amount: 3000 },
      { fundId: 'A', amount: 1000 },
    ]);
    assert.equal(plan.remainingEGP, 0);
    const after = apply(s, ops.withdrawMany(s, plan.withdrawals, 'تغطية مصروف', makeCtx()));
    assert.ok(unassignedEGP(after) >= 0);
    approx(fundAllocated(after, 'A'), 5000);
    approx(fundAllocated(after, 'B'), 0);
  });

  it('withdrawMany rejects taking more than a fund holds', () => {
    const s = state();
    assert.throws(
      () => ops.withdrawMany(s, [{ fundId: 'B', amount: 2000 }, { fundId: 'B', amount: 1500 }], undefined, makeCtx()),
      { code: 'WITHDRAW_EXCEEDS_FUND' }
    );
  });

  it('deleting a fund returns its cash to unassigned money', () => {
    const s = state();
    const after = apply(s, ops.deleteFund(s, 'A', makeCtx()));
    approx(unassignedEGP(after), unassignedEGP(s) + 6000);
    assert.equal(after.fundMovements.some((m) => m.fundId === 'A'), false);
  });
});

describe('paySinkingFund', () => {
  const state = (): FinanceState => ({
    ...emptyState(),
    accounts: [account('egp', 'EGP', 10000), account('sar', 'SAR', 1000)],
    funds: [
      fund({ id: 'S', type: 'sinking', targetAmount: 2400, frequency: 'yearly', nextDueDate: '2026-10-20' }),
      fund({ id: 'G', priority: 2 }),
    ],
    fundMovements: [{ id: 'm1', updatedAt: T0, fundId: 'S', amount: 2000, date: '2026-09-01' }],
  });
  const payment = (overrides: Partial<ops.SinkingPayment> = {}): ops.SinkingPayment => ({
    fundId: 'S',
    accountId: 'egp',
    categoryId: 'cat-essentials-bills',
    amount: 1500,
    date: '2026-10-15',
    ...overrides,
  });

  it('records the expense, withdraws from the fund and advances the due date', () => {
    const s = state();
    const after = apply(s, ops.paySinkingFund(s, payment(), makeCtx()));
    approx(accountBalance(after, 'egp'), 8500);
    approx(fundAllocated(after, 'S'), 500);
    assert.equal(after.funds.find((f) => f.id === 'S')?.nextDueDate, '2027-10-20');
    const [tx] = after.transactions;
    assert.equal(tx.type, 'expense');
    assert.equal(tx.amount, 1500);
    // The fund paid for it, so unassigned money is untouched.
    approx(unassignedEGP(after), unassignedEGP(s));
  });

  it('takes only the cash the fund holds; the rest comes from unassigned money', () => {
    const s = state();
    const after = apply(s, ops.paySinkingFund(s, payment({ amount: 2400 }), makeCtx()));
    approx(fundAllocated(after, 'S'), 0);
    approx(unassignedEGP(after), unassignedEGP(s) - 400);
  });

  it('converts when paying from an account in another currency', () => {
    const s = state();
    const after = apply(s, ops.paySinkingFund(s, payment({ accountId: 'sar', amount: 100 }), makeCtx()));
    approx(accountBalance(after, 'sar'), 900);
    approx(fundAllocated(after, 'S'), 2000 - 100 * 12.5);
  });

  it('is all-or-nothing on failure', () => {
    const s = state();
    const snapshot = JSON.stringify(s);
    assert.throws(() => ops.paySinkingFund(s, payment({ categoryId: 'cat-income-salary' }), makeCtx()), {
      code: 'CATEGORY_KIND_MISMATCH',
    });
    assert.throws(() => ops.paySinkingFund(s, payment({ amount: 0 }), makeCtx()), { code: 'NOT_POSITIVE' });
    assert.throws(() => ops.paySinkingFund(s, payment({ fundId: 'G' }), makeCtx()), { code: 'NOT_A_SINKING_FUND' });
    assert.equal(JSON.stringify(s), snapshot);
  });
});

describe('emergency fund suggestion', () => {
  it('is null without essentials history', () => {
    const s: FinanceState = { ...emptyState(), accounts: [account('egp', 'EGP', 0)] };
    assert.equal(suggestedEmergencyTarget(s, 3, NOW), null);
    // Spending this month (not a full month yet) doesn't count.
    const after = apply(s, ops.addTransaction(s, { type: 'expense', amount: 9000, currency: 'EGP', accountId: 'egp', categoryId: 'cat-essentials-rent', date: '2026-10-05' }, makeCtx()));
    assert.equal(suggestedEmergencyTarget(after, 6, NOW), null);
  });

  it('averages only the months that have essentials', () => {
    let s: FinanceState = { ...emptyState(), accounts: [account('egp', 'EGP', 0)] };
    s = apply(s, ops.addTransaction(s, { type: 'expense', amount: 8000, currency: 'EGP', accountId: 'egp', categoryId: 'cat-essentials-rent', date: '2026-09-05' }, makeCtx()));
    approx(suggestedEmergencyTarget(s, 3, NOW), 24000);
    approx(suggestedEmergencyTarget(s, 6, NOW), 48000);
  });
});

describe('addMonthsToDate', () => {
  it('keeps the day and clamps to the month end', () => {
    assert.equal(addMonthsToDate('2026-10-20', 12), '2027-10-20');
    assert.equal(addMonthsToDate('2027-01-31', 1), '2027-02-28');
    assert.equal(addMonthsToDate('2026-11-30', 3), '2027-02-28');
    assert.equal(addMonthsToDate('2027-08-31', 6), '2028-02-29');
  });
});

// --- v3: opening position, gold purchases, locations ------------------------

// The personal seed is git-ignored; its tests are skipped where it doesn't exist.
const LOCAL_SEED: FinanceState | undefined = (() => {
  try {
    return require('../store/seed.local').SEED_STATE as FinanceState;
  } catch {
    return undefined;
  }
})();
const noSeed = LOCAL_SEED ? false : 'store/seed.local.ts not present';

describe('opening data import', { skip: noSeed }, () => {
  const imported = () => {
    const current = emptyState(); // SAR 12.5 — the importer keeps current rates
    return apply(current, ops.replaceWithSeed(current, LOCAL_SEED!, makeCtx()));
  };
  const balanceOf = (s: FinanceState, name: string) => {
    const acct = s.accounts.find((a) => a.name === name);
    assert.ok(acct, `account ${name}`);
    return accountBalance(s, acct.id);
  };
  const seedRate = () => LOCAL_SEED!.transactions[0].rateToEGP;

  it('ends with the expected account balances', () => {
    const s = imported();
    approx(balanceOf(s, 'كاش السعودية'), 8000);
    approx(balanceOf(s, 'كاش مصر - ريال'), 12000);
    approx(balanceOf(s, 'كاش مصر - جنيه'), 14000);
    assert.deepEqual(liquidByCurrency(s), { EGP: 14000, SAR: 20000, USD: 0 });
  });

  it('holds 50g of gold costing 305,900', () => {
    const totals = goldTotals(imported());
    assert.equal(totals.totalGrams, 50);
    assert.deepEqual(totals.gramsByKarat, { 18: 0, 21: 30, 24: 20 });
    approx(totals.totalCostEGP, 305900);
    assert.equal(imported().transactions.some((t) => t.type === 'asset_purchase'), false);
  });

  it('keeps current market inputs but takes the seed tracking start', () => {
    const s = imported();
    assert.deepEqual(s.settings.exchangeRates, RATES);
    assert.equal(s.settings.trackingStartDate, '2026-08-05');
    assert.equal(s.settings.lastUsed, undefined);
  });

  it('summarises August and September', () => {
    const s = imported();
    const r = seedRate();
    const aug = monthSummary(s, '2026-08');
    approx(aug.incomeEGP, 2700 * r);
    approx(aug.expenseEGP, 1595 * r);
    approx(aug.expenseByBucket.essentials, 1505 * r);
    approx(aug.expenseByBucket.lifestyle, 90 * r);
    const sep = monthSummary(s, '2026-09');
    approx(sep.incomeEGP, 3800 * r);
    approx(sep.expenseEGP, 1105 * r);
    approx(sep.expenseByBucket.essentials, 975 * r);
    approx(sep.expenseByBucket.lifestyle, 130 * r);
    approx(sep.savingsRate, (3800 - 1105) / 3800);
  });

  it('leaves one-time expenses out of the emergency average', () => {
    // Aug essentials 1,505 − one-time 310 (home setup 160 + health 150) = 1,195; Sep 975.
    const r = seedRate();
    approx(suggestedEmergencyTarget(imported(), 3, NOW), ((1195 + 975) / 2) * r * 3);
  });

  it('splits net worth by location', () => {
    const s = imported();
    const byLocation = netWorthByLocation(s);
    approx(byLocation.SA, 8000 * 12.5);
    approx(byLocation.EG + byLocation.SA, netWorthEGP(s));
  });
});

describe('buyGold', () => {
  const setup = (): FinanceState => ({
    ...emptyState(),
    accounts: [account('egp', 'EGP', 100000), account('sar', 'SAR', 5000, 'SA')],
    funds: [fund({ id: 'f' })],
  });
  const purchase = (overrides: Partial<ops.GoldPurchase> = {}): ops.GoldPurchase => ({
    accountId: 'egp',
    amount: 60000,
    date: '2026-10-10',
    holding: { name: 'Bar 10g', weightGrams: 10, karat: 24, location: 'EG' },
    ...overrides,
  });

  it('moves cash into gold at cost without changing net worth', () => {
    const s = setup();
    const after = apply(s, ops.buyGold(s, purchase(), makeCtx()));
    approx(accountBalance(after, 'egp'), 40000);
    const holding = after.holdings[0];
    assert.equal(holding.type, 'gold');
    approx(holding.purchaseCostEGP, 60000);
    assert.equal(holding.purchaseDate, '2026-10-10');
    // Bought at the market price (10g × 6,000), so net worth is unchanged.
    approx(netWorthEGP(after), netWorthEGP(s));
    // Not spending.
    const october = monthSummary(after, '2026-10');
    assert.equal(october.expenseEGP, 0);
    assert.equal(october.savingsRate, null);
    assert.equal(transactionsForMonth(after, '2026-10', 'asset_purchase').length, 1);
  });

  it('costs SAR purchases at the snapshotted rate', () => {
    const s = setup();
    const after = apply(s, ops.buyGold(s, purchase({ accountId: 'sar', amount: 4000 }), makeCtx()));
    approx(after.holdings[0].purchaseCostEGP, 4000 * 12.5);
    approx(accountBalance(after, 'sar'), 1000);
  });

  it('rejects bad input without changing anything', () => {
    const s = setup();
    assert.throws(() => ops.buyGold(s, purchase({ amount: 0 }), makeCtx()), { code: 'NOT_POSITIVE' });
    assert.throws(
      () => ops.buyGold(s, purchase({ holding: { name: 'x', weightGrams: 0, karat: 24 } }), makeCtx()),
      { code: 'NOT_POSITIVE', details: { field: 'weightGrams' } }
    );
    assert.throws(() => ops.buyGold(s, purchase({ accountId: 'nope' }), makeCtx()), { code: 'NOT_FOUND' });
  });

  it('deleting the purchase also removes the holding (and its fund link), atomically', () => {
    let s = setup();
    s = apply(s, ops.buyGold(s, purchase(), makeCtx()));
    const holdingId = s.holdings[0].id;
    s = apply(s, ops.updateFund(s, { ...s.funds[0], linkedHoldingIds: [holdingId] }, makeCtx()));
    const txId = s.transactions[0].id;

    assert.throws(() => ops.deleteHolding(s, holdingId, makeCtx()), { code: 'HOLDING_HAS_PURCHASE' });
    const after = apply(s, ops.deleteTransaction(s, txId, makeCtx()));
    assert.equal(after.holdings.length, 0);
    assert.equal(after.transactions.length, 0);
    assert.deepEqual(after.funds[0].linkedHoldingIds, []);
    approx(accountBalance(after, 'egp'), 100000);
  });

  it('editing a purchase keeps the holding cost in sync and the type locked', () => {
    let s = setup();
    s = apply(s, ops.buyGold(s, purchase(), makeCtx()));
    const tx = s.transactions[0];
    s = apply(
      s,
      ops.updateGoldPurchase(s, tx.id, purchase({ amount: 61000, holding: { name: 'Bar', weightGrams: 10, karat: 21 } }), makeCtx())
    );
    const holding = s.holdings[0];
    approx(holding.purchaseCostEGP, 61000);
    assert.equal(holding.type === 'gold' && holding.karat, 21);
    approx(accountBalance(s, 'egp'), 39000);
    assert.throws(
      () =>
        ops.updateTransaction(s, {
          id: tx.id,
          type: 'expense',
          amount: 1,
          currency: 'EGP',
          accountId: 'egp',
          categoryId: 'cat-essentials-rent',
          date: tx.date,
          rateToEGP: 1,
          createdAt: tx.createdAt,
        }, makeCtx()),
      { code: 'ASSET_PURCHASE_TYPE_LOCKED' }
    );
  });
});

describe('cash-flow rules', () => {
  it('monthSummary ignores transactions before trackingStartDate', () => {
    let s: FinanceState = { ...emptyState(), accounts: [account('egp', 'EGP', 0)] };
    const add = (date: string, amount: number) => {
      s = apply(s, ops.addTransaction(s, { type: 'expense', amount, currency: 'EGP', accountId: 'egp', categoryId: 'cat-essentials-rent', date }, makeCtx()));
    };
    add('2026-08-04', 999);
    add('2026-08-05', 100);
    s = apply(s, ops.updateSettings(s, { trackingStartDate: '2026-08-05' }, makeCtx()));
    approx(monthSummary(s, '2026-08').expenseEGP, 100);
    // Balances still include everything.
    approx(accountBalance(s, 'egp'), -1099);
  });

  it('one-time expenses count as spending but not in averages', () => {
    let s: FinanceState = { ...emptyState(), accounts: [account('egp', 'EGP', 0)] };
    s = apply(s, ops.addTransaction(s, { type: 'expense', amount: 1000, currency: 'EGP', accountId: 'egp', categoryId: 'cat-essentials-rent', date: '2026-09-02' }, makeCtx()));
    s = apply(s, ops.addTransaction(s, { type: 'expense', amount: 5000, currency: 'EGP', accountId: 'egp', categoryId: 'cat-essentials-home-setup', date: '2026-09-03', oneTime: true }, makeCtx()));
    approx(monthSummary(s, '2026-09').expenseEGP, 6000);
    approx(monthSummary(s, '2026-09', { excludeOneTime: true }).expenseEGP, 1000);
    approx(suggestedEmergencyTarget(s, 3, NOW), 3000);
  });
});

describe('settings & gold prices', () => {
  it('values each karat at its own price (18k from 24k)', () => {
    const s = emptyState();
    s.settings = { ...s.settings, goldPrice24kEGP: 6000, goldPrice21kEGP: 5300 };
    s.holdings = [
      { id: 'a', updatedAt: T0, type: 'gold', name: 'a', weightGrams: 1, karat: 24, purchaseCostEGP: 0 },
      { id: 'b', updatedAt: T0, type: 'gold', name: 'b', weightGrams: 1, karat: 21, purchaseCostEGP: 0 },
      { id: 'c', updatedAt: T0, type: 'gold', name: 'c', weightGrams: 1, karat: 18, purchaseCostEGP: 0, location: 'SA' },
    ];
    approx(holdingsTotalEGP(s), 6000 + 5300 + 4500);
    approx(netWorthByLocation(s).SA, 4500);
  });

  it('updateSettings validates and stamps changed market inputs', () => {
    const s = emptyState();
    const after = apply(
      s,
      ops.updateSettings(s, { exchangeRates: { SAR_EGP: 13, USD_EGP: 50 }, goldPrice21kEGP: 5400 }, makeCtx())
    );
    assert.equal(after.settings.exchangeRates.SAR_EGP, 13);
    assert.equal(after.settings.exchangeRates.lastUpdated, NOW.toISOString());
    assert.equal(after.settings.goldPrice21kEGP, 5400);
    assert.equal(after.settings.goldPriceUpdatedAt, NOW.toISOString());
    assert.throws(() => ops.updateSettings(s, { goldPrice24kEGP: 0 }, makeCtx()), { code: 'NOT_POSITIVE' });
    assert.throws(() => ops.updateSettings(s, { trackingStartDate: '5 Aug' }, makeCtx()), { code: 'INVALID_DATE' });
  });
});

describe('migration v2 → v3', () => {
  // A v2 payload: no account location, no 21k price or tracking start, old category list
  // (with one default the user renamed).
  const v2 = () => {
    const base = emptyState();
    const { goldPrice21kEGP: _p21, trackingStartDate: _start, ...settingsV2 } = base.settings;
    return {
      ...base,
      accounts: [{ id: 'a', name: 'Bank', type: 'bank', currency: 'EGP', openingBalance: 10, createdAt: 'x' }],
      categories: [
        ...DEFAULT_CATEGORIES.filter((c) => !['cat-essentials-health', 'cat-lifestyle-misc'].includes(c.id) && c.id !== 'cat-essentials-rent'),
        { id: 'cat-essentials-rent', name: 'سكن', kind: 'expense', bucket: 'essentials', isDefault: true },
      ],
      settings: settingsV2,
    };
  };

  it('fills new fields with defaults and adds missing categories', () => {
    const { state } = migratePersistedState(v2(), 2, MIGRATION_CTX);
    assert.equal(state.accounts[0].location, 'EG');
    approx(state.settings.goldPrice21kEGP, 6000 * (21 / 24));
    assert.equal(state.settings.trackingStartDate, '2026-08-05');
    const ids = state.categories.map((c) => c.id);
    for (const id of ['cat-essentials-health', 'cat-essentials-household', 'cat-essentials-home-setup', 'cat-lifestyle-misc']) {
      assert.ok(ids.includes(id), id);
    }
    assert.equal(new Set(ids).size, ids.length); // no duplicates
    assert.equal(state.categories.find((c) => c.id === 'cat-essentials-rent')?.name, 'سكن'); // renamed default kept
  });

  it('is idempotent', () => {
    const once = migrateV2toV3(v2());
    assert.deepEqual(migrateV2toV3(once), once);
  });

  it('chains all the way from v0', () => {
    const { state } = migratePersistedState(LEGACY_V1, 0, MIGRATION_CTX);
    assert.ok(state.accounts.every((a) => a.location === 'EG'));
    assert.equal(state.settings.trackingStartDate, '2026-08-05');
  });
});

// --- v4: sync bookkeeping, backups ------------------------------------------

// A context whose clock can be moved forward, to tell creates and updates apart.
function makeClock(start = new Date('2026-10-15T09:00:00.000Z')) {
  let current = start;
  let seq = 0;
  const ctx: ops.OpContext = { newId: () => `c-${++seq}`, now: () => current };
  return { ctx, advance: (minutes = 1) => (current = new Date(current.getTime() + minutes * 60_000)), iso: () => current.toISOString() };
}

const nodeCrypto = { randomBytes: (n: number) => new Uint8Array(randomBytes(n)) };

// A small but varied v4 state: accounts, categories, a transfer, a gold purchase linked to a
// fund with cash, and one deletion (so the tombstone log isn't empty).
function richState(): FinanceState {
  const clock = makeClock();
  let s: FinanceState = {
    ...emptyState(),
    accounts: [account('egp', 'EGP', 100000), account('sar', 'SAR', 5000, 'SA')],
  };
  const step = (patch: Partial<FinanceState>) => {
    s = apply(s, patch);
    clock.advance();
  };
  step(ops.addTransaction(s, { type: 'expense', amount: 250, currency: 'SAR', accountId: 'sar', categoryId: 'cat-essentials-rent', date: '2026-10-02', note: 'إيجار ✓' }, clock.ctx));
  step(ops.addTransfer(s, { fromAccountId: 'sar', toAccountId: 'egp', amount: 100, date: '2026-10-03' }, clock.ctx));
  step(ops.buyGold(s, { accountId: 'egp', amount: 6000, date: '2026-10-04', holding: { name: 'سبيكة 1 جم', weightGrams: 1, karat: 24 } }, clock.ctx));
  step(ops.addFund(s, { name: 'Wedding', type: 'goal', targetAmount: 50000, currency: 'EGP', priority: 1, linkedHoldingIds: [s.holdings[0].id] }, clock.ctx));
  step(ops.allocateToFund(s, s.funds[0].id, 1000, 'first', clock.ctx));
  step(ops.addTransaction(s, { type: 'income', amount: 10, currency: 'EGP', accountId: 'egp', categoryId: 'cat-income-other', date: '2026-10-05' }, clock.ctx));
  step(ops.deleteTransaction(s, s.transactions[0].id, clock.ctx));
  return s;
}

describe('sync bookkeeping', () => {
  it('every create and update sets updatedAt to now', () => {
    const { ctx, advance, iso } = makeClock();
    let s: FinanceState = emptyState();
    s = apply(s, ops.addAccount(s, { name: 'Bank', type: 'bank', currency: 'EGP', openingBalance: 100, location: 'EG' }, ctx));
    const created = iso();
    assert.equal(s.accounts[0].updatedAt, created);
    assert.equal(s.accounts[0].createdAt, created);

    advance(5);
    s = apply(s, ops.updateAccount(s, { ...s.accounts[0], name: 'Main bank' }, ctx));
    assert.equal(s.accounts[0].updatedAt, iso());
    assert.equal(s.accounts[0].createdAt, created);

    advance();
    s = apply(s, ops.addTransaction(s, { type: 'expense', amount: 10, currency: 'EGP', accountId: s.accounts[0].id, categoryId: 'cat-essentials-rent', date: '2026-10-01' }, ctx));
    const tx = s.transactions[0];
    advance();
    s = apply(s, ops.updateTransaction(s, { ...tx, amount: 20, updatedAt: 'ignored' }, ctx));
    assert.equal(s.transactions[0].updatedAt, iso());

    advance();
    s = apply(s, ops.savePlan(s, { month: '2026-10', currency: 'SAR', expectedIncome: 1, lines: [], fundContributions: [] }, ctx));
    assert.equal(s.monthlyPlans[0].updatedAt, iso());

    advance();
    s = apply(s, ops.addFund(s, { name: 'F', type: 'goal', targetAmount: 100, currency: 'EGP', priority: 1 }, ctx));
    advance();
    s = apply(s, ops.allocateToFund(s, s.funds[0].id, 50, undefined, ctx));
    assert.equal(s.fundMovements[0].updatedAt, iso());
    advance();
    s = apply(s, ops.editFund(s, s.funds[0].id, { name: 'F2', targetAmount: 200, cashAllocation: 50 }, ctx));
    assert.equal(s.funds[0].updatedAt, iso());
  });

  it('every delete, including cascades, logs a tombstone', () => {
    const { ctx, iso } = makeClock();
    let s = richState();
    const before = s.tombstones.length;
    const fundId = s.funds[0].id;
    const movementIds = s.fundMovements.map((m) => m.id);

    // Fund + its movements.
    s = apply(s, ops.deleteFund(s, fundId, ctx));
    assert.deepEqual(
      s.tombstones.slice(before).map((t) => [t.entity, t.id]),
      [['fund', fundId], ...movementIds.map((id) => ['fundMovement', id])]
    );
    assert.ok(s.tombstones.slice(before).every((t) => t.deletedAt === iso()));

    // Gold purchase → transaction + holding.
    const purchase = s.transactions.find((t) => t.type === 'asset_purchase')!;
    const holdingId = purchase.type === 'asset_purchase' ? purchase.holdingId : '';
    const mark = s.tombstones.length;
    s = apply(s, ops.deleteTransaction(s, purchase.id, ctx));
    assert.deepEqual(
      s.tombstones.slice(mark).map((t) => [t.entity, t.id]).sort(),
      [['holding', holdingId], ['transaction', purchase.id]].sort()
    );

    // Monthly plans have month-derived ids.
    s = apply(s, ops.savePlan(s, { month: '2026-11', currency: 'SAR', expectedIncome: 0, lines: [], fundContributions: [] }, ctx));
    s = apply(s, ops.deletePlan(s, '2026-11', ctx));
    assert.deepEqual(s.tombstones.at(-1), { entity: 'monthlyPlan', id: 'plan-2026-11', deletedAt: iso() });
    // Deleting a month without a plan logs nothing.
    assert.equal(ops.deletePlan(s, '2030-01', ctx).tombstones, undefined);

    // Selectors ignore the log: data is really gone.
    assert.equal(s.funds.length, 0);
    assert.equal(s.holdings.length, 0);
  });

  it('cascaded edits bump updatedAt on the entities they touch', () => {
    const clock = makeClock();
    let s = richState();
    const fund = s.funds[0];
    const purchase = s.transactions.find((t) => t.type === 'asset_purchase')!;
    clock.advance(60);
    // Deleting the purchase unlinks its holding from the fund → the fund changed too.
    s = apply(s, ops.deleteTransaction(s, purchase.id, clock.ctx));
    const after = s.funds.find((f) => f.id === fund.id)!;
    assert.deepEqual(after.linkedHoldingIds, []);
    assert.equal(after.updatedAt, clock.iso());
  });
});

describe('migration v3 → v4', () => {
  // v3 data: no updatedAt, no tombstones, no device id.
  const v3 = () => {
    const s = richState();
    const strip = <T extends object>(items: T[]) => items.map(({ updatedAt: _u, ...rest }: any) => rest);
    const { deviceId: _d, ...settings } = s.settings;
    return {
      accounts: strip(s.accounts),
      categories: strip(s.categories),
      transactions: strip(s.transactions),
      funds: strip(s.funds),
      fundMovements: strip(s.fundMovements),
      holdings: strip(s.holdings),
      liabilities: [],
      recurringRules: [],
      monthlyPlans: [],
      settings,
    };
  };

  it('stamps updatedAt from createdAt (or now), starts the log and creates the device id', () => {
    const migrated = migrateV3toV4(v3(), MIGRATION_CTX);
    const source = v3();
    migrated.accounts.forEach((a, i) => assert.equal(a.updatedAt, source.accounts[i].createdAt));
    migrated.transactions.forEach((t, i) => assert.equal(t.updatedAt, source.transactions[i].createdAt));
    // No createdAt on movements/holdings/categories → migration time.
    assert.ok(migrated.fundMovements.every((m) => m.updatedAt === MIGRATION_CTX.now));
    assert.ok(migrated.holdings.every((h) => h.updatedAt === MIGRATION_CTX.now));
    assert.ok(migrated.categories.every((c) => c.updatedAt === MIGRATION_CTX.now));
    assert.deepEqual(migrated.tombstones, []);
    assert.equal(migrated.settings.deviceId, 'migrated-device');
  });

  it('is idempotent', () => {
    const once = migrateV3toV4(v3(), MIGRATION_CTX);
    const twice = migrateV3toV4(once, { now: '2030-01-01T00:00:00.000Z', newId: () => 'other-device' });
    assert.deepEqual(twice, once);
  });
});

describe('backup export / import', () => {
  const NOW_EXPORT = new Date('2026-10-20T08:30:00.000Z');
  const open = (file: BackupFile, password?: string) =>
    openBackup(parseBackup(serializeBackup(file)), { password, now: NOW, newId: () => 'unused' });

  it('round-trips a plain backup to identical state', async () => {
    const state = richState();
    const file = await createBackup(state, { now: NOW_EXPORT, crypto: nodeCrypto });
    assert.equal(file.encrypted, false);
    assert.equal(file.schemaVersion, CURRENT_VERSION);
    assert.equal(file.deviceId, 'test-device');
    const opened = await open(file);
    assert.deepEqual(opened.state, state);
    assert.equal(opened.exportedAt, NOW_EXPORT.toISOString());
  });

  it('round-trips an encrypted backup (real 200k-iteration key) to identical state', async () => {
    const state = richState();
    const file = await createBackup(state, { password: 'كلمة سر 123', now: NOW_EXPORT, crypto: nodeCrypto });
    assert.equal(file.encrypted, true);
    const payload = file.payload as EncryptedPayload;
    assert.equal(payload.iterations, PBKDF2_ITERATIONS);
    assert.equal(payload.salt.length, 32); // 16 bytes
    assert.equal(payload.nonce.length, 24); // 12 bytes
    const text = serializeBackup(file);
    assert.ok(!text.includes('Wedding') && !text.includes('إيجار'), 'no plaintext in the file');
    assert.ok(!text.includes('كلمة سر'), 'password not stored');

    const opened = await open(file, 'كلمة سر 123');
    assert.deepEqual(opened.state, state);
  });

  it('a wrong password fails without changing state', async () => {
    const current = richState();
    const snapshot = JSON.stringify(current);
    const file = await createBackup(emptyState(), { password: 'right-pass', now: NOW_EXPORT, crypto: { ...nodeCrypto, iterations: 1000 } });
    await assert.rejects(open(file, 'wrong-pass'), (e: unknown) => e instanceof BackupError && e.code === 'WRONG_PASSWORD');
    await assert.rejects(open(file), (e: unknown) => e instanceof BackupError && e.code === 'PASSWORD_REQUIRED');
    assert.equal(JSON.stringify(current), snapshot);
    assert.equal(errorMessage(new BackupError('WRONG_PASSWORD')), 'كلمة السر غلط');
  });

  it('detects tampering with the ciphertext or the header', async () => {
    const file = await createBackup(emptyState(), { password: 'pw-123456', now: NOW_EXPORT, crypto: { ...nodeCrypto, iterations: 1000 } });
    const payload = file.payload as EncryptedPayload;
    const flipped = payload.ciphertext.replace(/^./, (c) => (c === '0' ? '1' : '0'));
    await assert.rejects(open({ ...file, payload: { ...payload, ciphertext: flipped } }, 'pw-123456'), { code: 'WRONG_PASSWORD' });
    await assert.rejects(open({ ...file, exportedAt: '2020-01-01T00:00:00.000Z' }, 'pw-123456'), { code: 'WRONG_PASSWORD' });
  });

  it('rejects files that are not Wealth backups', () => {
    assert.throws(() => parseBackup('not json'), { code: 'INVALID_FILE' });
    assert.throws(() => parseBackup(JSON.stringify({ app: 'other', schemaVersion: 4 })), { code: 'INVALID_FILE' });
    assert.throws(
      () => parseBackup(JSON.stringify({ app: 'wealth', schemaVersion: 99, exportedAt: 'x', encrypted: false, payload: {} })),
      { code: 'UNSUPPORTED_VERSION' }
    );
    assert.throws(
      () => parseBackup(JSON.stringify({ app: 'wealth', schemaVersion: 4, exportedAt: 'x', encrypted: true, payload: { kdf: 'none' } })),
      { code: 'INVALID_FILE' }
    );
  });

  it('migrates v1, v2 and v3 exports to v4', async () => {
    const legacyFile = (schemaVersion: number, payload: unknown): BackupFile => ({
      app: 'wealth',
      schemaVersion,
      exportedAt: NOW_EXPORT.toISOString(),
      deviceId: 'old-phone',
      encrypted: false,
      payload,
    });
    const isV4 = (s: FinanceState) => {
      assert.ok(Array.isArray(s.tombstones));
      assert.ok(s.settings.deviceId);
      assert.ok(s.accounts.every((a) => a.location && a.updatedAt));
      assert.ok(s.categories.some((c) => c.id === 'cat-lifestyle-misc'));
    };

    const fromV1 = await open(legacyFile(1, LEGACY_V1));
    isV4(fromV1.state);
    assert.equal(fromV1.state.accounts.length, 3);

    const v3Payload = (() => {
      const { state } = migratePersistedState(LEGACY_V1, 1, MIGRATION_CTX);
      const strip = <T extends object>(items: T[]) => items.map(({ updatedAt: _u, ...rest }: any) => rest);
      const { deviceId: _d, ...settings } = state.settings;
      return { ...state, accounts: strip(state.accounts), transactions: strip(state.transactions), settings, tombstones: undefined };
    })();
    const fromV3 = await open(legacyFile(3, v3Payload));
    isV4(fromV3.state);

    const { goldPrice21kEGP: _p, trackingStartDate: _t, ...settingsV2 } = v3Payload.settings;
    const v2Payload = { ...v3Payload, accounts: v3Payload.accounts.map(({ location: _l, ...a }: any) => a), settings: settingsV2 };
    const fromV2 = await open(legacyFile(2, v2Payload));
    isV4(fromV2.state);
    assert.equal(fromV2.state.settings.trackingStartDate, '2026-08-05');

    // Same data whichever version it was exported from.
    assert.deepEqual(fromV2.state.accounts.map((a) => a.id), fromV1.state.accounts.map((a) => a.id));
  });

  it('builds a preview and file name', async () => {
    const state = richState();
    const opened = await open(await createBackup(state, { now: NOW_EXPORT, crypto: nodeCrypto }));
    const preview = backupPreview(opened);
    assert.deepEqual(
      [preview.accounts, preview.transactions, preview.holdings, preview.funds],
      [state.accounts.length, state.transactions.length, state.holdings.length, state.funds.length]
    );
    approx(preview.netWorthEGP, netWorthEGP(state));
    assert.equal(backupFileName(new Date(2026, 9, 3, 23, 59)), 'wealth-backup-2026-10-03.json');
  });

  it('UTF-8 codec round-trips Arabic, emoji and ASCII', () => {
    const text = 'ج.م 1,250 — صدقة 🤲 abc';
    assert.equal(utf8Decode(utf8Encode(text)), text);
    assert.deepEqual(Array.from(utf8Encode('é')), [0xc3, 0xa9]);
  });
});

describe('restoring a backup', () => {
  it('replaces the data, keeps this device settings, and logs removed entities', async () => {
    const { ctx } = makeClock(new Date('2026-11-01T00:00:00.000Z'));
    const backupState = richState();
    const file = await createBackup(backupState, { now: NOW, crypto: nodeCrypto });
    const opened = await openBackup(file, { now: NOW, newId: () => 'unused' });

    let current: FinanceState = {
      ...emptyState(),
      accounts: [account('only-here', 'EGP', 1)],
      settings: { ...emptyState().settings, deviceId: 'this-phone', appLockEnabled: true, lastBackupAt: '2026-10-30T00:00:00.000Z' },
    };
    current = apply(current, ops.restoreFromBackup(current, opened.state, ctx));

    assert.deepEqual(current.transactions, backupState.transactions);
    assert.deepEqual(current.accounts, backupState.accounts);
    assert.equal(current.settings.deviceId, 'this-phone');
    assert.equal(current.settings.appLockEnabled, true);
    assert.equal(current.settings.lastBackupAt, '2026-10-30T00:00:00.000Z');
    assert.ok(current.tombstones.some((t) => t.entity === 'account' && t.id === 'only-here'));
    // The backup's own deletion log is kept.
    for (const t of backupState.tombstones) assert.ok(current.tombstones.some((x) => x.id === t.id));
  });

  it('drops tombstones for entities that come back', () => {
    const { ctx } = makeClock();
    const base = emptyState();
    const current: FinanceState = { ...base, tombstones: [{ entity: 'account', id: 'egp', deletedAt: T0 }] };
    const next: FinanceState = { ...base, accounts: [account('egp', 'EGP', 1)] };
    const after = apply(current, ops.restoreFromBackup(current, next, ctx));
    assert.deepEqual(after.tombstones, []);
  });

  it('ensureDeviceId only fills a missing id', () => {
    const { ctx } = makeClock();
    const fresh = { ...emptyState(), settings: { ...emptyState().settings, deviceId: '' } };
    assert.equal(apply(fresh, ops.ensureDeviceId(fresh, ctx)).settings.deviceId, 'c-1');
    assert.deepEqual(ops.ensureDeviceId(emptyState(), ctx), {});
  });
});

// --- v5: monthly plan & safe to spend ---------------------------------------

const {
  amountInCurrency,
  daysLeftInMonth,
  overspentLines,
  planProgress,
  planSuggestion,
  previousPlanMonth,
  safeToSpend,
  safeToSpendToday,
  spendImpact,
  unplannedAmount,
} = planning;

// Tracking from Aug 5 (SAR 12.5). Aug and Sep have history; October is the plan month.
function planningState(): FinanceState {
  const ctx = makeCtx();
  let s: FinanceState = {
    ...emptyState(),
    accounts: [account('sar', 'SAR', 10000, 'SA'), account('egp', 'EGP', 50000)],
    funds: [fund({ id: 'F', targetAmount: 3000, deadline: '2026-12-31' })], // 1,000 EGP/month from Oct
  };
  s.settings = { ...s.settings, trackingStartDate: '2026-08-05' };
  const add = (type: 'income' | 'expense', categoryId: string, amount: number, currency: 'SAR' | 'EGP', date: string, extra: Partial<ops.NewIncomeExpense> = {}) => {
    const accountId = currency === 'SAR' ? 'sar' : 'egp';
    s = apply(s, ops.addTransaction(s, { type, amount, currency, accountId, categoryId, date, ...extra } as ops.NewIncomeExpense, ctx));
  };
  // Before tracking started: ignored.
  add('expense', 'cat-lifestyle-dining', 999, 'SAR', '2026-08-02');
  // August (27 of 31 days tracked)
  add('income', 'cat-income-salary', 2700, 'SAR', '2026-08-10');
  add('expense', 'cat-essentials-rent', 700, 'SAR', '2026-08-06');
  add('expense', 'cat-essentials-telecom', 120, 'SAR', '2026-08-06');
  add('expense', 'cat-lifestyle-dining', 270, 'SAR', '2026-08-10');
  add('expense', 'cat-essentials-home-setup', 500, 'SAR', '2026-08-07', { oneTime: true });
  add('expense', 'cat-essentials-groceries', 1250, 'EGP', '2026-08-20'); // = 100 SAR
  // September
  add('income', 'cat-income-salary', 3800, 'SAR', '2026-09-01');
  add('expense', 'cat-essentials-rent', 700, 'SAR', '2026-09-05');
  add('expense', 'cat-lifestyle-dining', 400, 'SAR', '2026-09-20');
  add('expense', 'cat-essentials-groceries', 2500, 'EGP', '2026-09-28'); // = 200 SAR
  // Buying gold is not spending.
  s = apply(s, ops.buyGold(s, { accountId: 'egp', amount: 6000, date: '2026-09-15', holding: { name: 'gold', weightGrams: 1, karat: 24 } }, ctx));
  return s;
}

describe('plan suggestion', () => {
  it('averages recent spending, scaling the partial first month and skipping one-time spend', () => {
    const suggestion = planSuggestion(planningState(), '2026-10', 'SAR', NOW);
    const trackedMonths = 27 / 31 + 1;
    const line = (id: string) => suggestion.lines.find((l) => l.categoryId === id);

    // Fixed bills: plain monthly average (unscaled).
    assert.deepEqual(line('cat-essentials-rent'), { categoryId: 'cat-essentials-rent', limit: 700, kind: 'fixed' });
    assert.deepEqual(line('cat-essentials-telecom'), { categoryId: 'cat-essentials-telecom', limit: 60, kind: 'fixed' });
    // Flexible: total ÷ months tracked. Dining excludes the pre-tracking 999.
    assert.deepEqual(line('cat-lifestyle-dining'), {
      categoryId: 'cat-lifestyle-dining',
      limit: Math.round((270 + 400) / trackedMonths),
      kind: 'flexible',
    });
    // EGP spending converted into the SAR plan.
    assert.equal(line('cat-essentials-groceries')?.limit, Math.round((100 + 200) / trackedMonths));
    // One-time and asset purchases are excluded.
    assert.equal(line('cat-essentials-home-setup'), undefined);
    assert.equal(suggestion.expectedIncome, (2700 + 3800) / 2);
    // Fund prefilled from its suggested monthly amount (1,000 EGP → 80 SAR).
    assert.deepEqual(suggestion.fundContributions, [{ fundId: 'F', amount: 80 }]);
    assert.equal(suggestion.currency, 'SAR');
  });

  it('suggests nothing without history', () => {
    const s = planningState();
    const early = planSuggestion(s, '2026-08', 'SAR', NOW);
    assert.deepEqual(early.lines, []);
    assert.equal(early.expectedIncome, 0);
  });
});

describe('plan currency conversion', () => {
  it('uses each transaction’s snapshot to EGP, then today’s rate into the plan currency', () => {
    const s = planningState(); // current SAR rate 12.5
    approx(amountInCurrency(s, { amount: 1250, rateToEGP: 1 }, 'SAR'), 100);
    // A SAR expense recorded at 13: 100 SAR → 1,300 EGP → 104 SAR at today's 12.5.
    approx(amountInCurrency(s, { amount: 100, rateToEGP: 13 }, 'SAR'), 104);
    approx(amountInCurrency(s, { amount: 100, rateToEGP: 13 }, 'EGP'), 1300);
  });
});

describe('plan progress & safe to spend', () => {
  const OCTOBER: ops.PlanInput = {
    month: '2026-10',
    currency: 'SAR',
    expectedIncome: 3250,
    lines: [
      { categoryId: 'cat-essentials-rent', limit: 700, kind: 'fixed' },
      { categoryId: 'cat-essentials-groceries', limit: 200, kind: 'flexible' },
      { categoryId: 'cat-lifestyle-dining', limit: 400, kind: 'flexible' },
    ],
    fundContributions: [{ fundId: 'F', amount: 80 }],
  };
  const october = () => {
    const ctx = makeCtx();
    let s = planningState();
    s = apply(s, ops.savePlan(s, OCTOBER, ctx));
    const add = (categoryId: string, amount: number, currency: 'SAR' | 'EGP') => {
      s = apply(s, ops.addTransaction(s, { type: 'expense', amount, currency, accountId: currency === 'SAR' ? 'sar' : 'egp', categoryId, date: '2026-10-05' }, ctx));
    };
    add('cat-essentials-rent', 700, 'SAR');
    add('cat-lifestyle-dining', 450, 'SAR'); // 50 over
    add('cat-essentials-groceries', 1250, 'EGP'); // 100 SAR
    add('cat-lifestyle-clothing', 60, 'SAR'); // no line
    s = apply(s, ops.allocateToFund(s, 'F', 500, undefined, ctx)); // 40 SAR, dated Oct 15
    return s;
  };

  it('reports each line, bucket totals and the whole month', () => {
    const p = planProgress(october(), '2026-10')!;
    const line = (id: string) => p.lines.find((l) => l.categoryId === id)!;
    assert.deepEqual(
      [line('cat-essentials-rent').spent, line('cat-essentials-rent').remaining, line('cat-essentials-rent').pct],
      [700, 0, 1]
    );
    approx(line('cat-lifestyle-dining').remaining, -50);
    approx(line('cat-lifestyle-dining').pct, 450 / 400);
    approx(line('cat-essentials-groceries').spent, 100);
    assert.deepEqual(p.buckets.essentials, { planned: 900, spent: 800 });
    assert.deepEqual(p.buckets.lifestyle, { planned: 400, spent: 450 });
    assert.equal(p.totalPlanned, 1300);
    approx(p.totalSpent, 1310);
    approx(p.unplannedSpent, 60);
    assert.equal(p.unplanned, 3250 - 1300 - 80);
    assert.equal(p.contributions[0].planned, 80);
    approx(p.contributions[0].allocated, 40);
  });

  it('safe to spend counts flexible lines only and never a negative line', () => {
    const s = october();
    // groceries 100 left + dining max(0, −50); rent (fixed) excluded.
    approx(safeToSpend(s, '2026-10'), 100);
    // 15 Oct → 17 days left including today.
    assert.equal(daysLeftInMonth('2026-10', NOW), 17);
    approx(safeToSpendToday(s, '2026-10', NOW), 100 / 17);
    assert.equal(safeToSpend(s, '2026-11'), null);
    assert.equal(daysLeftInMonth('2026-09', NOW), 0);
    assert.equal(daysLeftInMonth('2026-11', NOW), 30);
    assert.deepEqual(overspentLines(s, '2026-10').map((l) => l.categoryId), ['cat-lifestyle-dining']);
  });

  it('unplanned is zero-based', () => {
    assert.equal(unplannedAmount({ expectedIncome: 1000, lines: [{ categoryId: 'x', limit: 600, kind: 'fixed' }], fundContributions: [{ fundId: 'f', amount: 400 }] }), 0);
    assert.equal(unplannedAmount({ expectedIncome: 1000, lines: [], fundContributions: [{ fundId: 'f', amount: 1200 }] }), -200);
  });

  it('spendImpact shows what a new expense leaves, or how far over it goes', () => {
    const s = october();
    const under = spendImpact(s, '2026-10', 'cat-essentials-groceries', 50)!;
    approx(under.remainingAfter, 50);
    assert.equal(under.overBy, 0);
    // 1,875 EGP = 150 SAR → 50 over.
    const over = spendImpact(s, '2026-10', 'cat-essentials-groceries', 1875, 'EGP')!;
    approx(over.remainingAfter, -50);
    approx(over.overBy, 50);
    assert.equal(spendImpact(s, '2026-10', 'cat-giving-gifts', 10), null); // no line
    assert.equal(spendImpact(s, '2026-11', 'cat-essentials-groceries', 10), null); // no plan
  });
});

describe('plan operations', () => {
  const base = (): ops.PlanInput => ({
    month: '2026-10',
    currency: 'SAR',
    expectedIncome: 3000,
    lines: [{ categoryId: 'cat-essentials-rent', limit: 700, kind: 'fixed' }],
    fundContributions: [{ fundId: 'F', amount: 80 }],
  });

  it('copies the previous month’s plan into an unplanned month', () => {
    const clock = makeClock();
    let s = planningState();
    s = apply(s, ops.savePlan(s, base(), clock.ctx));
    s = apply(s, ops.copyPlan(s, '2026-10', '2026-11', clock.ctx));
    const nov = s.monthlyPlans.find((p) => p.month === '2026-11')!;
    assert.equal(nov.id, 'plan-2026-11');
    assert.deepEqual(
      { currency: nov.currency, expectedIncome: nov.expectedIncome, lines: nov.lines, fundContributions: nov.fundContributions },
      { currency: 'SAR', expectedIncome: 3000, lines: base().lines, fundContributions: base().fundContributions }
    );
    assert.equal(previousPlanMonth(s, '2026-12'), '2026-11');
    assert.throws(() => ops.copyPlan(s, '2026-10', '2026-11', clock.ctx), { code: 'PLAN_EXISTS' });
    assert.throws(() => ops.copyPlan(s, '2025-01', '2026-12', clock.ctx), { code: 'NOT_FOUND' });
  });

  it('re-saving keeps id and createdAt, bumps updatedAt', () => {
    const clock = makeClock();
    let s = planningState();
    s = apply(s, ops.savePlan(s, base(), clock.ctx));
    const first = s.monthlyPlans[0];
    clock.advance(10);
    s = apply(s, ops.savePlan(s, { ...base(), expectedIncome: 3500 }, clock.ctx));
    assert.equal(s.monthlyPlans.length, 1);
    assert.equal(s.monthlyPlans[0].id, first.id);
    assert.equal(s.monthlyPlans[0].createdAt, first.createdAt);
    assert.equal(s.monthlyPlans[0].updatedAt, clock.iso());
  });

  it('validates lines and contributions', () => {
    const s = planningState();
    const ctx = makeCtx();
    const rent = base().lines[0];
    assert.throws(() => ops.savePlan(s, { ...base(), lines: [rent, rent] }, ctx), { code: 'DUPLICATE_ENTRY' });
    assert.throws(() => ops.savePlan(s, { ...base(), lines: [{ ...rent, categoryId: 'cat-income-salary' }] }, ctx), { code: 'CATEGORY_KIND_MISMATCH' });
    assert.throws(() => ops.savePlan(s, { ...base(), lines: [{ ...rent, limit: -1 }] }, ctx), { code: 'NEGATIVE' });
    assert.throws(() => ops.savePlan(s, { ...base(), fundContributions: [{ fundId: 'nope', amount: 1 }] }, ctx), { code: 'NOT_FOUND' });
    assert.throws(() => ops.savePlan(s, { ...base(), month: '2026-13' }, ctx), { code: 'INVALID_MONTH' });
  });

  it('keeps plans consistent when categories or funds are deleted', () => {
    const ctx = makeCtx();
    let s = planningState();
    s = apply(s, ops.addCategory(s, { name: 'Gifts 2', kind: 'expense', bucket: 'giving' }, ctx));
    const giftsId = s.categories[s.categories.length - 1].id;
    s = apply(s, ops.savePlan(s, { ...base(), lines: [{ categoryId: giftsId, limit: 50, kind: 'flexible' }] }, ctx));
    assert.throws(() => ops.deleteCategory(s, giftsId, ctx), { code: 'CATEGORY_IN_USE' });
    s = apply(s, ops.deleteFund(s, 'F', ctx));
    assert.deepEqual(s.monthlyPlans[0].fundContributions, []);
  });
});

describe('migration v4 → v5', () => {
  const v4 = () => ({
    ...emptyState(),
    monthlyPlans: [{ month: '2026-09', expectedIncomeEGP: 5000, bucketLimitsEGP: { lifestyle: 100 }, updatedAt: T0 }],
    tombstones: [{ entity: 'monthlyPlan' as const, id: '2026-08', deletedAt: T0 }],
  });

  it('converts legacy plans and re-keys their tombstones', () => {
    const migrated = migrateV4toV5(v4(), MIGRATION_CTX);
    assert.deepEqual(migrated.monthlyPlans, [
      {
        id: 'plan-2026-09',
        month: '2026-09',
        currency: 'EGP',
        expectedIncome: 5000,
        lines: [],
        fundContributions: [],
        createdAt: T0,
        updatedAt: T0,
      },
    ]);
    assert.deepEqual(migrated.tombstones, [{ entity: 'monthlyPlan', id: 'plan-2026-08', deletedAt: T0 }]);
  });

  it('is idempotent', () => {
    const once = migrateV4toV5(v4(), MIGRATION_CTX);
    assert.deepEqual(migrateV4toV5(once, { now: '2031-01-01T00:00:00.000Z', newId: () => 'x' }), once);
  });

  it('runs as part of the chain', () => {
    const { state } = migratePersistedState(v4(), 4, MIGRATION_CTX);
    assert.equal(state.monthlyPlans[0].id, 'plan-2026-09');
    assert.equal(state.monthlyPlans[0].currency, 'EGP');
  });
});

// --- Recurring (v6) -----------------------------------------------------------

const rule = (overrides: Partial<RecurringRule> & Pick<RecurringRule, 'id'>): RecurringRule => ({
  name: overrides.id,
  kind: 'expense',
  amount: 1000,
  currency: 'EGP',
  accountId: 'egp',
  categoryId: 'cat-essentials-rent',
  frequency: 'monthly',
  interval: 1,
  startDate: '2026-08-05',
  nextDate: '',
  mode: 'confirm',
  variableAmount: false,
  active: true,
  skippedDates: [],
  createdAt: T0,
  updatedAt: T0,
  ...overrides,
});

const recurringState = (...rules: RecurringRule[]): FinanceState => ({
  ...emptyState(),
  accounts: [account('egp', 'EGP', 100000), account('sar', 'SAR', 10000, 'SA')],
  recurringRules: rules,
});

describe('recurring schedule', () => {
  it('clamps day 31 to the end of short months', () => {
    const r = rule({ id: 'r', startDate: '2026-01-31', dayOfMonth: 31 });
    assert.deepEqual(recurring.occurrencesBetween(r, '2026-01-01', '2026-05-31'), [
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
    // Leap-year February.
    assert.equal(recurring.occurrenceAt({ ...r, startDate: '2028-01-31' }, 1), '2028-02-29');
  });

  it('honours the interval', () => {
    const r = rule({ id: 'r', startDate: '2026-01-10', dayOfMonth: 10, interval: 3 });
    assert.deepEqual(recurring.occurrencesBetween(r, '2026-01-01', '2026-12-31'), [
      '2026-01-10',
      '2026-04-10',
      '2026-07-10',
      '2026-10-10',
    ]);
  });

  it('repeats yearly, clamping 29 Feb', () => {
    const r = rule({ id: 'r', frequency: 'yearly', startDate: '2028-02-29', dayOfMonth: 29 });
    assert.deepEqual(recurring.occurrencesBetween(r, '2028-01-01', '2030-12-31'), [
      '2028-02-29',
      '2029-02-28',
      '2030-02-28',
    ]);
  });

  it('repeats weekly (and every 2 weeks)', () => {
    const r = rule({ id: 'r', frequency: 'weekly', startDate: '2026-10-01' });
    assert.deepEqual(recurring.occurrencesBetween(r, '2026-10-01', '2026-10-22'), [
      '2026-10-01',
      '2026-10-08',
      '2026-10-15',
      '2026-10-22',
    ]);
    assert.deepEqual(recurring.occurrencesBetween({ ...r, interval: 2 }, '2026-10-01', '2026-10-31'), [
      '2026-10-01',
      '2026-10-15',
      '2026-10-29',
    ]);
  });

  it('stops after endDate (inclusive)', () => {
    const r = rule({ id: 'r', dayOfMonth: 5, endDate: '2026-10-05' });
    assert.deepEqual(recurring.occurrencesBetween(r, '2026-01-01', '2027-12-31'), [
      '2026-08-05',
      '2026-09-05',
      '2026-10-05',
    ]);
    assert.equal(recurring.nextOccurrence(recurringState(r), r, '2026-10-06'), '');
  });
});

describe('recurring processing', () => {
  it('processDue records missed auto occurrences, advances nextDate, and is idempotent', () => {
    const ctx = makeCtx();
    let s = recurringState(rule({ id: 'rent', mode: 'auto', dayOfMonth: 5 }));
    s = apply(s, ops.processDue(s, ctx));
    const recorded = s.transactions.filter((t) => t.recurringRuleId === 'rent');
    assert.deepEqual(recorded.map((t) => t.occurrenceDate).sort(), ['2026-08-05', '2026-09-05', '2026-10-05']);
    assert.equal(s.recurringRules[0].nextDate, '2026-11-05');
    assert.deepEqual(ops.processDue(s, ctx), {});
    assert.equal(accountBalance(s, 'egp'), 100000 - 3000);
  });

  it('processDue ignores confirm rules and skipped dates', () => {
    const ctx = makeCtx();
    let s = recurringState(
      rule({ id: 'auto', mode: 'auto', dayOfMonth: 5, skippedDates: ['2026-09-05'] }),
      rule({ id: 'confirm', mode: 'confirm', dayOfMonth: 5 })
    );
    s = apply(s, ops.processDue(s, ctx));
    assert.deepEqual(s.transactions.map((t) => t.occurrenceDate).sort(), ['2026-08-05', '2026-10-05']);
    assert.ok(s.transactions.every((t) => t.recurringRuleId === 'auto'));
  });

  it('snapshots the current rate on foreign-currency occurrences', () => {
    const ctx = makeCtx();
    let s = recurringState(rule({ id: 'r', mode: 'auto', currency: 'SAR', accountId: 'sar', startDate: '2026-10-05' }));
    s = apply(s, ops.processDue(s, ctx));
    assert.equal(s.transactions[0].rateToEGP, 12.5);
  });

  it('skips paused and ended rules', () => {
    const s = recurringState(
      rule({ id: 'paused', mode: 'auto', active: false }),
      rule({ id: 'ended', mode: 'auto', startDate: '2026-01-05', endDate: '2026-02-01' })
    );
    const due = recurring.dueOccurrences(s, '2026-10-15');
    assert.deepEqual(
      due.map((o) => `${o.rule.id}:${o.date}`),
      ['ended:2026-01-05']
    );
    assert.deepEqual(recurring.upcoming(s, 30, '2026-10-15').items, []);
  });

  it('lists missed confirm occurrences oldest first; confirm and skip handle them', () => {
    const ctx = makeCtx();
    let s = recurringState(rule({ id: 'net', dayOfMonth: 5, variableAmount: true }));
    const due = recurring.dueOccurrences(s, '2026-10-15', 'confirm');
    assert.deepEqual(
      due.map((o) => o.date),
      ['2026-08-05', '2026-09-05', '2026-10-05']
    );

    s = apply(s, ops.confirmOccurrence(s, 'net', '2026-08-05', { amount: 1234, date: '2026-08-07' }, ctx));
    const tx = s.transactions[0];
    assert.equal(tx.amount, 1234);
    assert.equal(tx.date, '2026-08-07');
    assert.equal(tx.occurrenceDate, '2026-08-05');
    s = apply(s, ops.skipOccurrence(s, 'net', '2026-09-05', ctx));
    assert.deepEqual(s.recurringRules[0].skippedDates, ['2026-09-05']);
    assert.deepEqual(
      recurring.dueOccurrences(s, '2026-10-15').map((o) => o.date),
      ['2026-10-05']
    );

    // Handling the same occurrence twice is rejected.
    assert.throws(() => ops.confirmOccurrence(s, 'net', '2026-08-05', {}, ctx), FinanceValidationError);
    assert.throws(() => ops.skipOccurrence(s, 'net', '2026-09-05', ctx), FinanceValidationError);
  });

  it('resuming a paused rule skips what fell due while paused', () => {
    const ctx = makeCtx();
    let s = recurringState(rule({ id: 'r', mode: 'auto', active: false, dayOfMonth: 5 }));
    s = apply(s, ops.setRecurringActive(s, 'r', true, ctx));
    assert.deepEqual(s.recurringRules[0].skippedDates, ['2026-08-05', '2026-09-05', '2026-10-05']);
    assert.deepEqual(ops.processDue(s, ctx), {});
    assert.equal(s.recurringRules[0].nextDate, '2026-11-05');
  });

  it('creating a rule from a transaction links it so it is not due again', () => {
    const ctx = makeCtx();
    let s = recurringState();
    s = apply(
      s,
      ops.addTransaction(
        s,
        { type: 'expense', amount: 500, currency: 'EGP', accountId: 'egp', categoryId: 'cat-essentials-rent', date: '2026-10-03' },
        ctx
      )
    );
    const txId = s.transactions[0].id;
    const { id: _id, updatedAt: _u, createdAt: _c, nextDate: _n, skippedDates: _s, ...input } = rule({
      id: 'x',
      amount: 500,
      startDate: '2026-10-03',
      dayOfMonth: 3,
    });
    s = apply(s, ops.addRecurringRule(s, input, ctx, txId));
    const ruleId = s.recurringRules[0].id;
    assert.equal(s.transactions[0].recurringRuleId, ruleId);
    assert.equal(s.transactions[0].occurrenceDate, '2026-10-03');
    assert.deepEqual(recurring.dueOccurrences(s, '2026-10-15'), []);
    assert.equal(s.recurringRules[0].nextDate, '2026-11-03');
  });

  it('deleting a rule keeps its past transactions, unlinked, and leaves a tombstone', () => {
    const ctx = makeCtx();
    let s = recurringState(rule({ id: 'rent', mode: 'auto', dayOfMonth: 5 }));
    s = apply(s, ops.processDue(s, ctx));
    s = apply(s, ops.deleteRecurringRule(s, 'rent', ctx));
    assert.equal(s.recurringRules.length, 0);
    assert.equal(s.transactions.length, 3);
    assert.ok(s.transactions.every((t) => t.recurringRuleId === undefined && t.occurrenceDate === undefined));
    assert.equal(accountBalance(s, 'egp'), 100000 - 3000);
    assert.ok(s.tombstones.some((t) => t.entity === 'recurringRule' && t.id === 'rent'));
  });
});

describe('recurring in the plan', () => {
  it('monthly equivalent of weekly, yearly and every-N rules', () => {
    approx(recurring.monthlyEquivalent({ amount: 120, frequency: 'weekly', interval: 1 }), 520);
    approx(recurring.monthlyEquivalent({ amount: 1200, frequency: 'yearly', interval: 1 }), 100);
    approx(recurring.monthlyEquivalent({ amount: 300, frequency: 'monthly', interval: 3 }), 100);
  });

  it('expense rules become fixed lines and income rules set expected income, converted SAR/EGP', () => {
    const s = recurringState(
      rule({ id: 'rent', amount: 12500, currency: 'EGP', categoryId: 'cat-essentials-rent' }),
      rule({ id: 'salary', kind: 'income', amount: 10000, currency: 'SAR', accountId: 'sar', categoryId: undefined })
    );
    const plan = planning.planSuggestion(s, '2026-11', 'SAR', NOW);
    assert.equal(plan.expectedIncome, 10000);
    assert.deepEqual(
      plan.lines.find((l) => l.categoryId === 'cat-essentials-rent'),
      { categoryId: 'cat-essentials-rent', limit: 1000, kind: 'fixed' }
    );
    approx(planning.recurringMonthly(s, 'EGP', NOW).income, 125000);
  });

  it('upcoming totals per currency', () => {
    const s = recurringState(
      rule({ id: 'rent', startDate: '2026-10-20' }),
      rule({ id: 'salary', kind: 'income', amount: 9000, currency: 'SAR', accountId: 'sar', startDate: '2026-10-27' })
    );
    const next = recurring.upcoming(s, 30, '2026-10-15');
    assert.equal(next.items.length, 2);
    assert.equal(next.expense.EGP, 1000);
    assert.equal(next.income.SAR, 9000);
  });
});

describe('migration v5 → v6', () => {
  const v5 = () => ({
    ...emptyState(),
    recurringRules: [
      {
        id: 'old',
        name: 'rent',
        type: 'expense' as const,
        amount: 1000,
        currency: 'EGP' as const,
        accountId: 'egp',
        categoryId: 'cat-essentials-rent',
        frequency: 'monthly' as const,
        nextDate: '2026-11-05',
        active: true,
        updatedAt: T0,
      },
    ],
  });

  it('converts legacy rules to confirm mode, interval 1', () => {
    const [r] = migrateV5toV6(v5(), MIGRATION_CTX).recurringRules;
    assert.equal(r.kind, 'expense');
    assert.equal(r.mode, 'confirm');
    assert.equal(r.interval, 1);
    assert.equal(r.dayOfMonth, 5);
    assert.equal(r.startDate, '2026-11-05');
    assert.deepEqual(r.skippedDates, []);
    assert.equal(r.createdAt, T0);
  });

  it('is idempotent and runs in the chain', () => {
    const once = migrateV5toV6(v5(), MIGRATION_CTX);
    assert.deepEqual(migrateV5toV6(once, { now: '2031-01-01T00:00:00.000Z', newId: () => 'x' }), once);
    assert.equal(CURRENT_VERSION, 6);
    const { state } = migratePersistedState(v5(), 5, MIGRATION_CTX);
    assert.equal(state.recurringRules[0].mode, 'confirm');
  });
});

// --- Category management -------------------------------------------------------

describe('category management', () => {
  const custom = (s: FinanceState, name: string, ctx: ops.OpContext, bucket: 'essentials' | 'lifestyle' | 'giving' = 'lifestyle') => {
    const next = apply(s, ops.addCategory(s, { name, kind: 'expense', bucket }, ctx));
    return { s: next, id: next.categories[next.categories.length - 1].id };
  };

  it('rejects duplicate names among active categories (trimmed, any case)', () => {
    const ctx = makeCtx();
    const { s, id } = custom(planningState(), '  Gym ', ctx);
    assert.equal(s.categories.find((c) => c.id === id)?.name, 'Gym');
    assert.equal(s.categories.find((c) => c.id === id)?.isDefault, false);
    assert.throws(() => ops.addCategory(s, { name: 'gym', kind: 'expense', bucket: 'giving' }, ctx), { code: 'CATEGORY_NAME_TAKEN' });
    const rent = s.categories.find((c) => c.id === 'cat-essentials-rent')!;
    assert.throws(() => ops.addCategory(s, { name: rent.name, kind: 'income', bucket: 'income' }, ctx), { code: 'CATEGORY_NAME_TAKEN' });
    assert.throws(() => ops.updateCategory(s, { ...rent, name: 'Gym' }, ctx), { code: 'CATEGORY_NAME_TAKEN' });
    assert.throws(() => ops.addCategory(s, { name: '   ', kind: 'expense', bucket: 'giving' }, ctx), { code: 'NAME_REQUIRED' });
    // Renaming to its own name is fine; an archived category's name is free again.
    ops.updateCategory(s, { ...s.categories.find((c) => c.id === id)!, name: 'GYM' }, ctx);
    const archived = apply(s, ops.archiveCategory(s, id, true, ctx));
    const again = apply(archived, ops.addCategory(archived, { name: 'Gym', kind: 'expense', bucket: 'lifestyle' }, ctx));
    // …but restoring the archived one now clashes.
    assert.throws(() => ops.archiveCategory(again, id, false, ctx), { code: 'CATEGORY_NAME_TAKEN' });
  });

  it('locks the kind and the default flag on update', () => {
    const ctx = makeCtx();
    const s = planningState();
    const rent = s.categories.find((c) => c.id === 'cat-essentials-rent')!;
    assert.throws(() => ops.updateCategory(s, { ...rent, kind: 'income', bucket: 'income' }, ctx), { code: 'CATEGORY_KIND_LOCKED' });
    const moved = apply(s, ops.updateCategory(s, { ...rent, name: 'Rent', bucket: 'lifestyle', isDefault: false }, ctx));
    const after = moved.categories.find((c) => c.id === rent.id)!;
    assert.equal(after.bucket, 'lifestyle');
    assert.equal(after.isDefault, true);
    assert.equal(after.updatedAt, NOW.toISOString());
  });

  it('deletes only unused custom categories; used or default ones are archived instead', () => {
    const ctx = makeCtx();
    let { s, id } = custom(planningState(), 'Gym', ctx);
    // Unused custom → real delete with a tombstone.
    const deleted = apply(s, ops.deleteCategory(s, id, ctx));
    assert.ok(!deleted.categories.some((c) => c.id === id));
    assert.ok(deleted.tombstones.some((t) => t.entity === 'category' && t.id === id));
    // Defaults can't be deleted, even unused.
    assert.equal(ops.categoryInUse(s, 'cat-giving-gifts'), false);
    assert.throws(() => ops.deleteCategory(s, 'cat-giving-gifts', ctx), { code: 'DEFAULT_CATEGORY_DELETE' });
    // Used by a transaction → in use; archiving keeps it.
    s = apply(s, ops.addTransaction(s, { type: 'expense', amount: 100, currency: 'SAR', accountId: 'sar', categoryId: id, date: '2026-10-05' }, ctx));
    assert.equal(ops.categoryInUse(s, id), true);
    assert.throws(() => ops.deleteCategory(s, id, ctx), { code: 'CATEGORY_IN_USE' });
    s = apply(s, ops.archiveCategory(s, id, true, ctx));
    assert.equal(s.categories.find((c) => c.id === id)?.archived, true);
    // Default categories can be archived too.
    s = apply(s, ops.archiveCategory(s, 'cat-giving-gifts', true, ctx));
    assert.equal(s.categories.find((c) => c.id === 'cat-giving-gifts')?.archived, true);
  });

  it('counts recurring rules and plan lines as use', () => {
    const ctx = makeCtx();
    let { s, id } = custom(planningState(), 'Gym', ctx);
    const inPlan = apply(s, ops.savePlan(s, { month: '2026-10', currency: 'SAR', expectedIncome: 0, lines: [{ categoryId: id, limit: 10, kind: 'flexible' }], fundContributions: [] }, ctx));
    assert.throws(() => ops.deleteCategory(inPlan, id, ctx), { code: 'CATEGORY_IN_USE' });
    s = { ...s, recurringRules: [rule({ id: 'r', currency: 'SAR', accountId: 'sar', categoryId: id })] };
    assert.throws(() => ops.deleteCategory(s, id, ctx), { code: 'CATEGORY_IN_USE' });
  });

  it('new categories appear in pickers; archived ones are hidden but still counted', () => {
    const ctx = makeCtx();
    let { s, id } = custom(planningState(), 'Gym', ctx);
    assert.ok(pickerCategories(s.categories, 'expense').some((c) => c.id === id));
    assert.ok(!pickerCategories(s.categories, 'income').some((c) => c.id === id));
    s = apply(s, ops.addTransaction(s, { type: 'expense', amount: 100, currency: 'SAR', accountId: 'sar', categoryId: id, date: '2026-10-05' }, ctx));
    const before = monthSummary(s, '2026-10');
    s = apply(s, ops.archiveCategory(s, id, true, ctx));
    assert.ok(!pickerCategories(s.categories, 'expense').some((c) => c.id === id));
    // Still selectable when editing a transaction that already uses it.
    assert.ok(pickerCategories(s.categories, 'expense', [id]).some((c) => c.id === id));
    const after = monthSummary(s, '2026-10');
    assert.equal(after.expenseEGP, before.expenseEGP);
    assert.equal(after.expenseEGP, 100 * 12.5);
    assert.deepEqual(after.expenseByBucket, before.expenseByBucket);
    // Not suggested in new plans.
    const suggestion = planning.planSuggestion(s, '2026-11', 'SAR', NOW);
    assert.ok(!suggestion.lines.some((l) => l.categoryId === id));
  });

  it('moving a category to another bucket moves its plan totals', () => {
    const ctx = makeCtx();
    let s = planningState();
    s = apply(s, ops.savePlan(s, { month: '2026-10', currency: 'SAR', expectedIncome: 1000, lines: [{ categoryId: 'cat-lifestyle-dining', limit: 400, kind: 'flexible' }], fundContributions: [] }, ctx));
    s = apply(s, ops.addTransaction(s, { type: 'expense', amount: 150, currency: 'SAR', accountId: 'sar', categoryId: 'cat-lifestyle-dining', date: '2026-10-05' }, ctx));
    const before = planning.planProgress(s, '2026-10')!;
    assert.deepEqual(before.buckets.lifestyle, { planned: 400, spent: 150 });
    assert.deepEqual(before.buckets.essentials, { planned: 0, spent: 0 });
    const dining = s.categories.find((c) => c.id === 'cat-lifestyle-dining')!;
    s = apply(s, ops.updateCategory(s, { ...dining, bucket: 'essentials' }, ctx));
    const after = planning.planProgress(s, '2026-10')!;
    assert.deepEqual(after.buckets.essentials, { planned: 400, spent: 150 });
    assert.deepEqual(after.buckets.lifestyle, { planned: 0, spent: 0 });
  });

  it('addCategoryWithPlanLine creates the category and the line atomically', () => {
    const ctx = makeCtx();
    let s = planningState();
    assert.throws(
      () => ops.addCategoryWithPlanLine(s, { name: 'Gym', bucket: 'lifestyle' }, { month: '2026-10', limit: 100, kind: 'flexible' }, ctx),
      { code: 'PLAN_NOT_FOUND' }
    );
    s = apply(s, ops.savePlan(s, { month: '2026-10', currency: 'SAR', expectedIncome: 1000, lines: [], fundContributions: [] }, ctx));
    const createdAt = s.monthlyPlans[0].createdAt;
    s = apply(s, ops.addCategoryWithPlanLine(s, { name: ' Gym ', bucket: 'lifestyle' }, { month: '2026-10', limit: 100, kind: 'fixed' }, ctx));
    const gym = s.categories[s.categories.length - 1];
    assert.deepEqual(
      { name: gym.name, kind: gym.kind, bucket: gym.bucket, isDefault: gym.isDefault },
      { name: 'Gym', kind: 'expense', bucket: 'lifestyle', isDefault: false }
    );
    assert.deepEqual(s.monthlyPlans[0].lines, [{ categoryId: gym.id, limit: 100, kind: 'fixed' }]);
    assert.equal(s.monthlyPlans[0].createdAt, createdAt);
    // A failing step (duplicate name, negative limit) changes nothing.
    assert.throws(
      () => ops.addCategoryWithPlanLine(s, { name: 'gym', bucket: 'giving' }, { month: '2026-10', limit: 5, kind: 'flexible' }, ctx),
      { code: 'CATEGORY_NAME_TAKEN' }
    );
    assert.throws(
      () => ops.addCategoryWithPlanLine(s, { name: 'Pool', bucket: 'giving' }, { month: '2026-10', limit: -5, kind: 'flexible' }, ctx),
      { code: 'NEGATIVE' }
    );
  });
});

// --- Home insights (Calm Wealth phase 2) ---------------------------------------

describe('home: nextBestAction', () => {
  // NOW = 15 Oct 2026. Fund "goal" is behind: deadline next year, nothing allocated this month.
  const behindFund = () => fund({ id: 'goal', name: 'جواز', targetAmount: 12000, deadline: '2027-09-30', priority: 1 });
  const base = (overrides: Partial<FinanceState> = {}): FinanceState => ({
    ...emptyState(),
    accounts: [account('egp', 'EGP', 10000)],
    ...overrides,
  });
  const kind = (s: FinanceState) => home.nextBestAction(s, NOW)?.kind ?? null;

  it('returns null when there is nothing to do', () => {
    assert.equal(home.nextBestAction({ ...emptyState() }, NOW), null);
  });

  it('puts covering spent fund money first', () => {
    const s = base({
      funds: [behindFund()],
      fundMovements: [{ id: 'm', fundId: 'goal', amount: 15000, date: '2026-09-01', updatedAt: T0 }],
      recurringRules: [rule({ id: 'r', startDate: '2026-10-05' })],
    });
    const action = home.nextBestAction(s, NOW)!;
    assert.equal(action.kind, 'cover');
    assert.equal(action.tone, 'danger');
    assert.equal(action.actionLabel, 'غطّي الفرق');
  });

  it('then due confirm items, with Arabic number agreement', () => {
    const one = base({ funds: [behindFund()], recurringRules: [rule({ id: 'r', startDate: '2026-10-05' })] });
    const action = home.nextBestAction(one, NOW)!;
    assert.equal(action.kind, 'due');
    assert.equal(action.message, 'عندك مستحق واحد محتاج مراجعة.');
    const two = base({ recurringRules: [rule({ id: 'r', startDate: '2026-09-05', dayOfMonth: 5 })] });
    assert.equal(home.nextBestAction(two, NOW)!.message, 'عندك مستحقين محتاجين مراجعة.');
    assert.equal(home.dueCountPhrase(3), '3 مستحقات محتاجة مراجعة');
    assert.equal(home.dueCountPhrase(11), '11 مستحق محتاج مراجعة');
    // Auto rules are recorded by the app, so they never ask for review.
    assert.notEqual(kind(base({ recurringRules: [rule({ id: 'r', startDate: '2026-10-05', mode: 'auto' })] })), 'due');
  });

  it('then an item due within 3 days', () => {
    const s = base({ funds: [behindFund()], recurringRules: [rule({ id: 'rent', name: 'إيجار', startDate: '2026-10-17' })] });
    const action = home.nextBestAction(s, NOW)!;
    assert.equal(action.kind, 'upcoming');
    assert.equal(action.message, 'إيجار مستحق خلال يومين.');
    // Four days away is not "soon".
    assert.equal(kind(base({ recurringRules: [rule({ id: 'r', startDate: '2026-10-19' })] })), 'assign');
  });

  it('then a fund that is behind, before assigning money', () => {
    // No recurring rules in this fixture, so nothing due/upcoming can outrank the fund step.
    const s = base({ funds: [behindFund()] });
    const OCT_26 = new Date(2026, 9, 26, 12);
    assert.deepEqual(recurring.dueOccurrences(s, '2026-10-26'), []);
    assert.deepEqual(recurring.upcoming(s, 3, '2026-10-26').items, []);
    const action = home.nextBestAction(s, OCT_26)!;
    assert.equal(action.kind, 'fund');
    assert.equal(action.fundId, 'goal');
    assert.ok(action.message.startsWith('جواز محتاج '));
    // Mid-month (NOW, 17 days left) the fund is only pending: no fund step.
    assert.equal(home.nextBestAction(s, NOW)!.kind, 'assign');
  });

  it('then money without a job', () => {
    const action = home.nextBestAction(base(), NOW)!;
    assert.equal(action.kind, 'assign');
    assert.equal(action.tone, 'ok');
    assert.ok(action.message.includes('10,000'));
  });
});

describe('home: homeFunds', () => {
  it('orders behind funds first, then by nearest due date, then by priority', () => {
    const s: FinanceState = {
      ...emptyState(),
      accounts: [account('egp', 'EGP', 1000000)],
      funds: [
        fund({ id: 'noDue', priority: 1 }),
        fund({ id: 'behindFar', priority: 2, deadline: '2028-01-01' }),
        fund({ id: 'behindNear', priority: 3, deadline: '2027-01-01' }),
        // Fully funded this month → not behind.
        fund({ id: 'okNear', priority: 4, targetAmount: 100, deadline: '2026-12-01' }),
        fund({ id: 'okNoDue', priority: 5 }),
      ],
      fundMovements: [{ id: 'm', fundId: 'okNear', amount: 100, date: '2026-10-02', updatedAt: T0 }],
    };
    assert.deepEqual(
      home.homeFunds(s, NOW, 5).map((f) => f.id),
      ['behindNear', 'behindFar', 'okNear', 'noDue', 'okNoDue']
    );
    assert.deepEqual(
      home.homeFunds(s, NOW).map((f) => f.id),
      ['behindNear', 'behindFar', 'okNear']
    );
  });

  it('upcomingItems lists the next items, soonest first', () => {
    const s: FinanceState = {
      ...emptyState(),
      accounts: [account('egp', 'EGP', 1000)],
      recurringRules: [rule({ id: 'b', startDate: '2026-10-25' }), rule({ id: 'a', startDate: '2026-10-20', frequency: 'weekly' })],
    };
    assert.deepEqual(
      home.upcomingItems(s, NOW).map((o) => `${o.rule.id}:${o.date}`),
      ['a:2026-10-20', 'b:2026-10-25', 'a:2026-10-27']
    );
  });
});

// --- Transactions UI helpers (Calm Wealth phase 3) ------------------------------

describe('transactions UI: quickCategories', () => {
  const cats = (ids: string[]) => ids.map((id) => DEFAULT_CATEGORIES.find((c) => c.id === id)!);
  const expense = DEFAULT_CATEGORIES.filter((c) => c.kind === 'expense');

  it('puts the last-used category first and caps the quick chips at 6', () => {
    const lastUsed = expense[8].id;
    const { visible, hiddenCount } = txUi.quickCategories(expense, { lastUsedId: lastUsed });
    assert.equal(visible.length, 6);
    assert.equal(visible[0].id, lastUsed);
    assert.deepEqual(
      visible.slice(1).map((c) => c.id),
      expense.filter((c) => c.id !== lastUsed).slice(0, 5).map((c) => c.id)
    );
    assert.equal(hiddenCount, expense.length - 6);
  });

  it('always shows the selected category, even past the cap', () => {
    const selected = expense[expense.length - 1].id;
    const { visible, hiddenCount } = txUi.quickCategories(expense, { selectedId: selected });
    assert.equal(visible.length, 7);
    assert.equal(visible[6].id, selected);
    assert.equal(hiddenCount, expense.length - 7);
    // An unknown last-used id (e.g. archived) is ignored.
    assert.deepEqual(txUi.quickCategories(cats([expense[0].id, expense[1].id]), { lastUsedId: 'gone' }).visible.map((c) => c.id), [
      expense[0].id,
      expense[1].id,
    ]);
  });
});

describe('transactions UI: filters and titles', () => {
  const txs = [
    { type: 'expense' },
    { type: 'income' },
    { type: 'transfer' },
    { type: 'asset_purchase' },
    { type: 'expense' },
  ] as unknown as Transaction[];

  it('filters by type (ذهب = asset_purchase) and keeps all for الكل', () => {
    assert.equal(txUi.filterTransactions(txs, 'all').length, 5);
    assert.equal(txUi.filterTransactions(txs, 'expense').length, 2);
    assert.equal(txUi.filterTransactions(txs, 'asset_purchase').length, 1);
    assert.deepEqual(
      txUi.FILTERS.map((f) => f.label),
      ['الكل', 'مصروف', 'دخل', 'تحويل', 'ذهب']
    );
  });

  it('words the empty-filter line per type', () => {
    assert.equal(txUi.emptyFilterMessage('expense'), 'مفيش مصروفات في الشهر ده.');
    assert.equal(txUi.emptyFilterMessage('asset_purchase'), 'مفيش مشتريات ذهب في الشهر ده.');
  });

  it('builds an RTL-safe "from ← to" transfer title', () => {
    const RLM = String.fromCharCode(0x200f);
    assert.equal(txUi.transferTitle('Cash SAR', 'بنك مصر'), `${RLM}Cash SAR${RLM} ← ${RLM}بنك مصر${RLM}`);
  });
});

// --- Plan UI helpers (Calm Wealth phase 4) --------------------------------------

describe('plan UI: lineState', () => {
  const line = (kind: 'fixed' | 'flexible', limit: number, spent: number) => ({
    kind,
    limit,
    spent,
    pct: limit > 0 ? spent / limit : spent > 0 ? 1 : 0,
  });

  it('flexible: normal below 85 %, approaching from 85 % up to the limit, over past it', () => {
    assert.equal(planUi.lineState(line('flexible', 1000, 0)), 'normal');
    assert.equal(planUi.lineState(line('flexible', 1000, 849)), 'normal');
    assert.equal(planUi.lineState(line('flexible', 1000, 850)), 'approaching');
    assert.equal(planUi.lineState(line('flexible', 1000, 1000)), 'approaching');
    assert.equal(planUi.lineState(line('flexible', 1000, 1000.3)), 'over');
    assert.equal(planUi.lineState(line('flexible', 0, 10)), 'over');
    assert.equal(planUi.lineState(line('flexible', 0, 0)), 'normal');
  });

  it('fixed: never "approaching"; paid at the limit (within 0.5); over beyond that', () => {
    assert.equal(planUi.lineState(line('fixed', 7000, 6900)), 'normal');
    assert.equal(planUi.lineState(line('fixed', 7000, 7000)), 'paid');
    assert.equal(planUi.lineState(line('fixed', 7000, 7000.4)), 'paid');
    assert.equal(planUi.lineState(line('fixed', 7000, 7001)), 'over');
    assert.equal(planUi.lineState(line('fixed', 0, 0)), 'normal');
  });

  it('describes a line factually', () => {
    const over = { categoryId: 'c', bucket: 'lifestyle' as const, kind: 'flexible' as const, limit: 500, spent: 620, remaining: -120, pct: 1.24 };
    assert.ok(planUi.lineSentence(over, 'خروجات', 'SAR').startsWith('صرف خروجات عدى الخطة بـ '));
    assert.equal(planUi.lineSentence({ ...over, kind: 'fixed', limit: 620, remaining: 0, pct: 1 }, 'إيجار', 'SAR'), 'اتدفع.');
  });
});

describe('plan UI: statuses and plan inputs', () => {
  it('unplanned status uses a 0.5 tolerance', () => {
    assert.equal(planUi.unplannedStatus(0.4), 'balanced');
    assert.equal(planUi.unplannedStatus(-0.4), 'balanced');
    assert.equal(planUi.unplannedStatus(120), 'under');
    assert.equal(planUi.unplannedStatus(-1), 'over');
  });

  it('a contribution is done once the allocation reaches the plan', () => {
    assert.equal(planUi.contributionDone({ planned: 500, allocated: 499.999 }), true);
    assert.equal(planUi.contributionDone({ planned: 500, allocated: 300 }), false);
    assert.equal(planUi.contributionDone({ planned: 0, allocated: 0 }), false);
  });

  it('builds savePlan input from the saved plan, replacing / appending / removing one line', () => {
    const plan = {
      id: 'plan-2026-10',
      month: '2026-10',
      currency: 'SAR' as const,
      expectedIncome: 3000,
      lines: [
        { categoryId: 'a', limit: 100, kind: 'fixed' as const },
        { categoryId: 'b', limit: 200, kind: 'flexible' as const },
      ],
      fundContributions: [{ fundId: 'f', amount: 50 }],
      createdAt: T0,
      updatedAt: T0,
    };
    const input = planUi.planInputOf(plan);
    assert.deepEqual(Object.keys(input).sort(), ['currency', 'expectedIncome', 'fundContributions', 'lines', 'month']);
    assert.deepEqual(planUi.withLine(plan, { categoryId: 'b', limit: 250, kind: 'fixed' }).lines, [
      { categoryId: 'a', limit: 100, kind: 'fixed' },
      { categoryId: 'b', limit: 250, kind: 'fixed' },
    ]);
    assert.equal(planUi.withLine(plan, { categoryId: 'c', limit: 1, kind: 'flexible' }).lines.length, 3);
    assert.deepEqual(planUi.withoutLine(plan, 'a').lines, [{ categoryId: 'b', limit: 200, kind: 'flexible' }]);
    // The plan object itself is untouched.
    assert.equal(plan.lines.length, 2);
  });
});

// --- Domain fixes (phase 5, Part A) ----------------------------------------------

describe('A1: fundStatus pending vs behind', () => {
  // daysLeftInMonth counts today: in October (31 days) day d leaves 31 − d + 1 days.
  const at = (day: number) => new Date(2026, 9, day, 12);
  const state = (fundOverrides: Partial<Fund> = {}, movements: FinanceState['fundMovements'] = []): FinanceState => ({
    ...emptyState(),
    accounts: [account('egp', 'EGP', 1000000)],
    // 30,000 by 31 Dec → 10,000 required each of Oct, Nov, Dec.
    funds: [fund({ id: 'f', targetAmount: 30000, deadline: '2026-12-31', ...fundOverrides })],
    fundMovements: movements,
  });

  it('day 1 with nothing allocated → pending', () => {
    assert.equal(fundStatus(state(), 'f', at(1)), 'pending');
  });

  it('boundary: 8 days left → pending, exactly 7 days left → behind, 5 days left → behind', () => {
    assert.equal(fundStatus(state(), 'f', at(24)), 'pending'); // 31 − 24 + 1 = 8
    assert.equal(fundStatus(state(), 'f', at(25)), 'behind'); // 7
    assert.equal(fundStatus(state(), 'f', at(27)), 'behind'); // 5
  });

  it('partially allocated with 10 days left → pending', () => {
    const partial = state({}, [{ id: 'm', fundId: 'f', amount: 4000, date: '2026-10-05', updatedAt: T0 }]);
    assert.equal(fundStatus(partial, 'f', at(22)), 'pending'); // 10 days left
  });

  it('a fund created this month is never behind this month', () => {
    const fresh = { createdAt: '2026-10-10T09:00:00.000Z' };
    assert.equal(fundStatus(state(fresh), 'f', at(26)), 'pending');
    assert.equal(fundStatus(state(fresh), 'f', at(29)), 'pending'); // 3 days left
  });

  it('ahead / on_track / no_deadline are unchanged', () => {
    const done = (amount: number) => state({}, [{ id: 'm', fundId: 'f', amount, date: '2026-10-02', updatedAt: T0 }]);
    assert.equal(fundStatus(done(10000), 'f', at(26)), 'on_track');
    assert.equal(fundStatus(done(12000), 'f', at(26)), 'ahead');
    assert.equal(fundStatus(state({ deadline: undefined }), 'f', at(26)), 'no_deadline');
  });

  it('homeFunds orders behind, then pending, then nearest due', () => {
    const s: FinanceState = {
      ...emptyState(),
      accounts: [account('egp', 'EGP', 1000000)],
      funds: [
        fund({ id: 'pendingNear', priority: 1, targetAmount: 30000, deadline: '2026-12-31', createdAt: '2026-10-20T00:00:00.000Z' }),
        fund({ id: 'behind', priority: 2, targetAmount: 30000, deadline: '2027-06-30' }),
        fund({ id: 'okNear', priority: 3, targetAmount: 100, deadline: '2026-11-30' }),
      ],
      fundMovements: [{ id: 'm', fundId: 'okNear', amount: 100, date: '2026-10-02', updatedAt: T0 }],
    };
    assert.deepEqual(
      home.homeFunds(s, at(26), 3).map((f) => f.id),
      ['behind', 'pendingNear', 'okNear']
    );
  });
});

describe('A2: transfer edits re-snapshot the rate when the from-currency changes', () => {
  const setup = (): FinanceState => ({
    ...emptyState(),
    accounts: [account('sar', 'SAR', 10000, 'SA'), account('egp', 'EGP', 100000), account('egp2', 'EGP', 0)],
    transactions: [
      { id: 't', type: 'transfer', fromAccountId: 'sar', toAccountId: 'egp', amount: 100, toAmount: 1100, date: '2026-10-02', rateToEGP: 11, createdAt: T0, updatedAt: T0 },
    ],
  });

  it('keeps the snapshot when the from-account currency is unchanged', () => {
    const s = setup();
    const tx = s.transactions[0] as Extract<Transaction, { type: 'transfer' }>;
    const after = apply(s, ops.updateTransaction(s, { ...tx, amount: 120, toAmount: 1320 }, makeCtx()));
    assert.equal(after.transactions[0].rateToEGP, 11);
  });

  it('takes the current rate of the new from-currency', () => {
    const s = setup();
    const tx = s.transactions[0] as Extract<Transaction, { type: 'transfer' }>;
    const toEgp = apply(s, ops.updateTransaction(s, { ...tx, fromAccountId: 'egp', toAccountId: 'egp2', toAmount: 100 }, makeCtx()));
    assert.equal(toEgp.transactions[0].rateToEGP, 1);
    const back = toEgp.transactions[0] as Extract<Transaction, { type: 'transfer' }>;
    const toSar = apply(toEgp, ops.updateTransaction(toEgp, { ...back, fromAccountId: 'sar', toAccountId: 'egp', toAmount: 1250 }, makeCtx()));
    assert.equal(toSar.transactions[0].rateToEGP, 12.5); // RATES.SAR_EGP
  });
});

describe('A3: invalid recurring mode', () => {
  it('fails with INVALID_MODE', () => {
    const s = recurringState();
    const { id: _i, updatedAt: _u, createdAt: _c, nextDate: _n, skippedDates: _s, ...input } = rule({ id: 'x' });
    assert.throws(
      () => ops.addRecurringRule(s, { ...input, mode: 'x' as RecurringRule['mode'] }, makeCtx()),
      { code: 'INVALID_MODE' }
    );
    assert.equal(errorMessage(new FinanceValidationError('INVALID_MODE' as never)), 'طريقة التسجيل غير صالحة');
  });
});

describe('A4: zero-limit line with spending', () => {
  it('stays "over" but explains there is no budget', () => {
    const line = { categoryId: 'c', bucket: 'lifestyle' as const, kind: 'flexible' as const, limit: 0, spent: 75, remaining: -75, pct: 1 };
    assert.equal(planUi.lineState(line), 'over');
    assert.ok(planUi.lineSentence(line, 'خروجات', 'SAR').startsWith('مفيش ميزانية للبند ده: اتصرف '));
  });
});
