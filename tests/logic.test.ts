// Pure-logic tests for the finance model. Run with: npm run test:logic
// TypeScript 6 no longer auto-includes @types packages, so opt in to Node types here.
/// <reference types="node" />
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';

import * as home from '@/components/dashboard/homeInsights';
import * as fundsUi from '@/components/funds/fundsUi';
import * as planUi from '@/components/plan/planUi';
import * as recUi from '@/components/recurring/recurringUi';
import * as settingsUi from '@/components/settings/settingsUi';
import * as assetsUi from '@/components/assets/assetsUi';
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
  migrateV6toV7,
  type FinanceStateV1,
} from '@/store/migrations';
import * as nba from '@/store/nextActions';
import * as planning from '@/store/planning';
import * as reviewLogic from '@/store/review';
import * as analyticsUi from '@/components/analytics/analyticsUi';
import * as sankeyLayout from '@/components/analytics/sankeyLayout';
import * as analytics from '@/store/analytics';
import * as snapshots from '@/store/snapshots';
import * as sel from '@/store/selectors';
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
  monthFlows,
  monthSummary,
  netWorthAsOf,
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
import { formatDayLabel, formatPercent, moreThingsPhrase, timeAgoPhrase } from '@/utils/formatters';
import { parseAmount } from '@/utils/parseAmount';
import * as priceCalc from '@/utils/prices/calc';
import * as prices from '@/utils/prices/fetchPrices';

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
    netWorthSnapshots: [],
    actionDismissals: [],
    monthlyReviews: [],
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
  const GROCERIES = CATEGORY_IDS.groceries;
  const DINING = 'cat-lifestyle-dining';
  const withSarRate = (s: FinanceState, SAR_EGP: number): FinanceState => ({
    ...s,
    settings: { ...s.settings, exchangeRates: { ...s.settings.exchangeRates, SAR_EGP } },
  });
  // Recorded while 1 SAR = 13.5 EGP: a 40 SAR and a 270 EGP (= 20 SAR) expense, a 3,000 SAR
  // income, 1,350 EGP (= 100 SAR) put into an EGP fund, all in October's SAR plan.
  const recordedAt13_5 = (): FinanceState => {
    const ctx = makeCtx();
    let s = withSarRate(
      {
        ...emptyState(),
        accounts: [account('sar', 'SAR', 10000, 'SA'), account('egp', 'EGP', 50000)],
        funds: [fund({ id: 'F' })],
        // One tracked month, so November's suggestion is October as it was.
        settings: { ...emptyState().settings, trackingStartDate: '2026-10-01' },
      },
      13.5
    );
    const add = (input: ops.NewIncomeExpense) => {
      s = apply(s, ops.addTransaction(s, input, ctx));
    };
    add({ type: 'expense', amount: 40, currency: 'SAR', accountId: 'sar', categoryId: GROCERIES, date: '2026-10-05' });
    add({ type: 'expense', amount: 270, currency: 'EGP', accountId: 'egp', categoryId: DINING, date: '2026-10-06' });
    add({ type: 'income', amount: 3000, currency: 'SAR', accountId: 'sar', categoryId: 'cat-income-salary', date: '2026-10-01' });
    s = apply(
      s,
      ops.savePlan(
        s,
        {
          month: '2026-10',
          currency: 'SAR',
          expectedIncome: 3000,
          lines: [
            { categoryId: GROCERIES, limit: 500, kind: 'flexible' },
            { categoryId: DINING, limit: 100, kind: 'flexible' },
          ],
          fundContributions: [{ fundId: 'F', amount: 100 }],
        },
        ctx
      )
    );
    return apply(s, ops.allocateToFund(s, 'F', 1350, undefined, ctx));
  };
  const spent = (s: FinanceState, categoryId: string) => planProgress(s, '2026-10')!.lines.find((l) => l.categoryId === categoryId)!.spent;
  const withoutSnapshots = (s: FinanceState): FinanceState => ({
    ...s,
    transactions: s.transactions.map(({ ratesSnapshot: _r, ...tx }) => tx as Transaction),
    fundMovements: s.fundMovements.map(({ ratesSnapshot: _r, ...m }) => m),
  });

  it('keeps a 40 SAR expense at exactly 40 in a SAR plan after SAR_EGP moves 13.5 → 14', () => {
    const before = recordedAt13_5();
    const after = withSarRate(before, 14);
    assert.equal(spent(before, GROCERIES), 40);
    assert.equal(spent(after, GROCERIES), 40);
    assert.equal(planProgress(after, '2026-10')!.lines[0].remaining, 460);
  });

  it('converts an EGP expense into the SAR plan with its own snapshot, not today’s rate', () => {
    const before = recordedAt13_5();
    assert.deepEqual(before.transactions.find((t) => t.amount === 270)!.ratesSnapshot, { SAR_EGP: 13.5, USD_EGP: 50 });
    approx(spent(before, DINING), 20);
    approx(spent(withSarRate(before, 14), DINING), 20);
    approx(spent(withSarRate(before, 27), DINING), 20);
  });

  it('leaves plan progress, safe to spend, spend impact and the suggestion alone when rates change', () => {
    const before = recordedAt13_5();
    const after = withSarRate(before, 14);
    approx(safeToSpend(after, '2026-10'), 460 + 80);
    assert.equal(safeToSpend(after, '2026-10'), safeToSpend(before, '2026-10'));
    assert.deepEqual(overspentLines(after, '2026-10'), overspentLines(before, '2026-10'));
    assert.equal(planProgress(after, '2026-10')!.totalSpent, planProgress(before, '2026-10')!.totalSpent);
    // A new 60 SAR expense on the SAR line: 500 − 40 − 60, no rate involved.
    assert.equal(spendImpact(after, '2026-10', GROCERIES, 60, 'SAR')!.remainingAfter, 400);
    assert.equal(spendImpact(after, '2026-10', GROCERIES, 60)!.remainingAfter, 400);
    // November's suggestion is built from October's history: same lines and income either way.
    const NOV = new Date(2026, 10, 3, 12);
    const a = planSuggestion(before, '2026-11', 'SAR', NOV);
    const b = planSuggestion(after, '2026-11', 'SAR', NOV);
    assert.deepEqual(b.lines, a.lines);
    assert.equal(b.expectedIncome, a.expectedIncome);
    assert.equal(b.expectedIncome, 3000);
    assert.equal(b.lines.find((l) => l.categoryId === GROCERIES)!.limit, 40);
    assert.equal(b.lines.find((l) => l.categoryId === DINING)!.limit, 20);
  });

  it('keeps fund allocations of the month at their own rates (plan progress, review, month flows)', () => {
    const before = recordedAt13_5();
    const after = withSarRate(before, 14);
    assert.deepEqual(after.fundMovements[0].ratesSnapshot, { SAR_EGP: 13.5, USD_EGP: 50 });
    approx(planProgress(after, '2026-10')!.contributions[0].allocated, 100);
    approx(reviewLogic.monthReview(after, '2026-10', NOW).funds[0].allocated, 100);
    assert.equal(monthFlows(after, '2026-10').savedToFundsEGP, 1350);
    // In its own currency a fund never depends on rates.
    assert.equal(fundAllocated(after, 'F'), 1350);
  });

  it('still works for transactions and movements recorded before ratesSnapshot existed', () => {
    const old = withSarRate(withoutSnapshots(recordedAt13_5()), 14);
    // Same currency: exact, whatever the rates.
    assert.equal(spent(old, GROCERIES), 40);
    // Other currency: own rate to EGP, today's rate out of it (the documented approximation).
    approx(spent(old, DINING), 270 / 14);
    approx(planProgress(old, '2026-10')!.contributions[0].allocated, 1350 / 14);
    approx(amountInCurrency(old, { amount: 100, currency: 'SAR', rateToEGP: 13 }, 'SAR'), 100);
    approx(amountInCurrency(old, { amount: 100, currency: 'SAR', rateToEGP: 13 }, 'EGP'), 1300);
    approx(amountInCurrency(old, { amount: 100, currency: 'SAR', rateToEGP: 13 }, 'USD'), 26);
    // With a snapshot both legs come from the same moment.
    approx(
      amountInCurrency(old, { amount: 100, currency: 'SAR', rateToEGP: 13, ratesSnapshot: { SAR_EGP: 13, USD_EGP: 52 } }, 'USD'),
      25
    );
  });

  it('keeps the snapshot when a transaction is edited, and retakes it when its currency changes', () => {
    const s = withSarRate(recordedAt13_5(), 14);
    const ctx = makeCtx();
    const tx = s.transactions.find((t) => t.amount === 40)!;
    const edited = apply(s, ops.updateTransaction(s, { ...tx, amount: 45 } as Transaction, ctx)).transactions.find((t) => t.id === tx.id)!;
    assert.equal(edited.rateToEGP, 13.5);
    assert.deepEqual(edited.ratesSnapshot, { SAR_EGP: 13.5, USD_EGP: 50 });
    const moved = apply(
      s,
      ops.updateTransaction(s, { ...tx, accountId: 'egp', currency: 'EGP' } as Transaction, ctx)
    ).transactions.find((t) => t.id === tx.id)!;
    assert.equal(moved.rateToEGP, 1);
    assert.deepEqual(moved.ratesSnapshot, { SAR_EGP: 14, USD_EGP: 50 });
    // An old transaction stays without one while its currency is unchanged.
    const old = withoutSnapshots(s);
    const oldTx = old.transactions.find((t) => t.amount === 40)!;
    const oldEdited = apply(old, ops.updateTransaction(old, { ...oldTx, amount: 41 } as Transaction, ctx)).transactions.find((t) => t.id === tx.id)!;
    assert.equal('ratesSnapshot' in oldEdited, false);
  });

  it('pays a sinking fund in its own currency without a conversion', () => {
    const ctx = makeCtx();
    let s = withSarRate(
      {
        ...emptyState(),
        accounts: [account('sar', 'SAR', 10000, 'SA')],
        funds: [fund({ id: 'S', type: 'sinking', currency: 'SAR', targetAmount: 500, frequency: 'yearly', nextDueDate: '2026-10-20' })],
      },
      13.7
    );
    s = apply(s, ops.allocateToFund(s, 'S', 500, undefined, ctx));
    s = apply(s, ops.paySinkingFund(s, { fundId: 'S', accountId: 'sar', categoryId: 'cat-essentials-bills', amount: 200.1, date: '2026-10-15' }, ctx));
    assert.equal(s.fundMovements.at(-1)!.amount, -200.1);
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

describe('next best actions: rules and ordering', () => {
  const OCT_26 = new Date(2026, 9, 26, 12);
  const ids = (s: FinanceState, now = NOW) => nba.nextActions(s, now).map((a) => a.id);
  const expense = (id: string, categoryId: string, amount: number, date: string, extra: Partial<Transaction> = {}): Transaction =>
    ({
      id,
      type: 'expense',
      amount,
      currency: 'EGP',
      accountId: 'egp',
      categoryId,
      date,
      rateToEGP: 1,
      createdAt: `${date}T10:00:00.000Z`,
      updatedAt: T0,
      ...extra,
    }) as Transaction;
  const recentSettings = (s: FinanceState): FinanceState => ({
    ...s,
    settings: {
      ...s.settings,
      exchangeRates: { ...RATES, lastUpdated: '2026-10-25T00:00:00.000Z' },
      goldPriceUpdatedAt: '2026-10-25T00:00:00.000Z',
      lastBackupAt: '2026-10-25T00:00:00.000Z',
    },
  });

  // Triggers every rule that can hold at once (2 and 5 exclude 9 and 3, tested below).
  const busy = (): FinanceState => ({
    ...emptyState(),
    accounts: [account('egp', 'EGP', 100000), account('sar', 'SAR', 1000, 'SA')],
    recurringRules: [rule({ id: 'r', startDate: '2026-10-05' })],
    transactions: [
      expense('oct', CATEGORY_IDS.groceries, 500, '2026-10-10'),
      expense('sep', CATEGORY_IDS.groceries, 300, '2026-09-10'),
    ],
    monthlyPlans: [
      {
        id: 'plan-2026-10',
        month: '2026-10',
        currency: 'EGP',
        expectedIncome: 0,
        lines: [{ categoryId: CATEGORY_IDS.groceries, limit: 100, kind: 'flexible' }],
        fundContributions: [],
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    funds: [
      fund({ id: 'car', name: 'تأمين العربية', type: 'sinking', targetAmount: 5000, frequency: 'yearly', nextDueDate: '2026-11-05', priority: 1 }),
      fund({ id: 'goal', name: 'جواز', targetAmount: 12000, deadline: '2027-09-30', priority: 2 }),
    ],
    holdings: [
      { id: 'g', type: 'gold', name: 'gold', weightGrams: 10, karat: 21, purchaseCostEGP: 50000, updatedAt: T0 },
    ],
  });

  it('lists every applicable rule in priority order', () => {
    assert.deepEqual(ids(busy(), OCT_26), [
      'due',
      'overspent',
      'review-2026-09',
      'emergency',
      'sinking-car',
      'behind-goal',
      'assign',
      'prices',
      'backup',
    ]);
    const actions = nba.nextActions(busy(), OCT_26);
    assert.deepEqual(
      actions.map((a) => a.priority),
      [1, 3, 4, 6, 7, 8, 9, 10, 11]
    );
    const by = (id: string) => actions.find((a) => a.id === id)!;
    assert.equal(by('due').title, 'عندك مستحق واحد محتاج مراجعة');
    assert.equal(by('due').cta.route, '/due');
    assert.ok(by('overspent').title.startsWith('عدّيت ميزانية: أكل وبقالة'));
    approx(by('overspent').amount!, 400);
    assert.deepEqual(by('review-2026-09').cta, { label: 'ابدأ المراجعة', route: '/review', params: { month: '2026-09' } });
    assert.ok(by('sinking-car').title.startsWith('فاضل '));
    assert.ok(by('sinking-car').title.endsWith(' على تأمين العربية'));
    assert.equal(by('sinking-car').subtitle, 'مستحق خلال 10 أيام.');
    // The sinking fund is "soon", so it isn't listed again as behind.
    assert.ok(!actions.some((a) => a.id === 'behind-car'));
    assert.ok(by('behind-goal').title.startsWith('صندوق جواز متأخر '));
    approx(by('behind-goal').amount!, 1000); // 12,000 over 12 months
    assert.deepEqual(by('behind-goal').cta.params, { id: 'goal', allocate: '1' });
    assert.equal(by('assign').cta.route, 'assign');
    assert.equal(by('prices').title, 'حدّث أسعار الذهب والصرف');
    assert.deepEqual(by('backup').cta, { label: 'تصدير نسخة', route: '/settings', params: { export: '1' } });
  });

  it('puts covering spent fund money right after due items, and asks for a plan when there is none', () => {
    const s: FinanceState = {
      ...emptyState(),
      accounts: [account('egp', 'EGP', 1000)],
      funds: [fund({ id: 'goal', name: 'جواز', deadline: '2027-09-30' })],
      fundMovements: [{ id: 'm', fundId: 'goal', amount: 5000, date: '2026-09-01', updatedAt: T0 }],
      recurringRules: [rule({ id: 'r', startDate: '2026-10-05' })],
    };
    assert.deepEqual(ids(s), ['due', 'cover', 'plan-2026-10', 'emergency', 'backup']);
    const cover = nba.nextActions(s, NOW)[1];
    assert.equal(cover.severity, 'urgent');
    assert.equal(cover.cta.route, 'cover');
    approx(cover.amount!, 4000);
    assert.ok(cover.title.startsWith('صرفت ') && cover.title.endsWith(' من فلوس مخصصة'));
  });

  it('marks only due items and spent fund money as non-dismissible', () => {
    const s: FinanceState = {
      ...busy(),
      funds: [...busy().funds, fund({ id: 'big', deadline: '2027-09-30', priority: 9 })],
      fundMovements: [{ id: 'm', fundId: 'big', amount: 500000, date: '2026-09-01', updatedAt: T0 }],
    };
    for (const a of nba.allActions(s, OCT_26)) {
      assert.equal(a.dismissible, !['due', 'cover'].includes(a.id), a.id);
    }
  });

  it('starts empty for a new user except the plan and emergency fund', () => {
    assert.deepEqual(ids(emptyState()), ['plan-2026-10', 'emergency']);
  });

  it('turns rules off when they no longer apply', () => {
    // Fresh prices and backup, last month reviewed, no due items, plan within limits.
    const s = recentSettings({
      ...busy(),
      recurringRules: [],
      monthlyReviews: [{ id: 'review-2026-09', month: '2026-09', completedAt: T0, updatedAt: T0 }],
      transactions: [expense('oct', CATEGORY_IDS.groceries, 50, '2026-10-10')],
    });
    assert.deepEqual(ids(s, OCT_26), ['emergency', 'sinking-car', 'behind-goal', 'assign']);
    // Prices are only nagged about when the data uses them.
    const egpOnly: FinanceState = { ...emptyState(), accounts: [account('egp', 'EGP', 100)] };
    assert.ok(!ids(egpOnly).includes('prices'));
    // Last month without transactions has nothing to review.
    assert.ok(!ids({ ...busy(), transactions: [] }, OCT_26).some((id) => id.startsWith('review-')));
  });

  it('nudges a sinking fund only within 14 days and while it is short', () => {
    const sinking = (nextDueDate: string, saved = 0): FinanceState => ({
      ...emptyState(),
      accounts: [account('egp', 'EGP', 100000)],
      funds: [fund({ id: 'car', type: 'sinking', targetAmount: 5000, frequency: 'yearly', nextDueDate })],
      fundMovements: saved ? [{ id: 'm', fundId: 'car', amount: saved, date: '2026-09-01', updatedAt: T0 }] : [],
    });
    assert.ok(ids(sinking('2026-10-29')).includes('sinking-car')); // 14 days
    assert.ok(!ids(sinking('2026-10-30')).includes('sinking-car')); // 15 days
    assert.equal(nba.nextActions(sinking('2026-10-15'), NOW).find((a) => a.id === 'sinking-car')!.subtitle, 'مستحق النهارده.');
    assert.equal(nba.nextActions(sinking('2026-10-10'), NOW).find((a) => a.id === 'sinking-car')!.subtitle, 'ميعاده فات.');
    assert.ok(!ids(sinking('2026-10-20', 5000)).includes('sinking-car'));
  });

  it('asks to start or top up the emergency fund against a month of essentials', () => {
    const history = ['2026-07-03', '2026-08-03', '2026-09-03'].map((d, i) =>
      expense(`rent-${i}`, 'cat-essentials-rent', 3000, d)
    );
    const withFund = (saved: number): FinanceState => ({
      ...emptyState(),
      accounts: [account('egp', 'EGP', 100000)],
      transactions: history,
      funds: [fund({ id: 'em', type: 'emergency', targetAmount: 18000 })],
      fundMovements: [{ id: 'm', fundId: 'em', amount: saved, date: '2026-09-01', updatedAt: T0 }],
    });
    const thin = nba.nextActions(withFund(1000), NOW).find((a) => a.id === 'emergency')!;
    assert.equal(thin.title, 'ابدأ صندوق الطوارئ');
    approx(thin.amount!, 2000);
    assert.deepEqual(thin.cta.params, { id: 'em', allocate: '1' });
    assert.ok(!ids(withFund(3000)).includes('emergency'));
    // Without a fund the action creates one.
    assert.equal(nba.nextActions(emptyState(), NOW).find((a) => a.id === 'emergency')!.cta.route, 'new-emergency');
  });

  it('nudges stale gold or FX prices and an old backup after 7 days', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const sixDaysAgo = new Date(NOW.getTime() - 6 * DAY).toISOString();
    const s: FinanceState = {
      ...emptyState(),
      accounts: [account('egp', 'EGP', 100)],
      holdings: [{ id: 'g', type: 'gold', name: 'gold', weightGrams: 1, karat: 24, purchaseCostEGP: 1, updatedAt: T0 }],
      settings: { ...emptyState().settings, goldPriceUpdatedAt: sixDaysAgo, lastBackupAt: sixDaysAgo },
    };
    // 6 days: fine.
    assert.ok(!ids(s).includes('prices') && !ids(s).includes('backup'));
    const later = new Date(NOW.getTime() + DAY);
    const prices = nba.nextActions(s, later).find((a) => a.id === 'prices')!;
    assert.equal(prices.title, 'حدّث سعر الذهب');
    assert.equal(prices.severity, 'info');
    assert.equal(nba.nextActions(s, later).find((a) => a.id === 'backup')!.subtitle, 'آخر نسخة منذ 7 أيام.');
    assert.equal(nba.needsBackupReminder(undefined, NOW), true);
    assert.equal(nba.daysSinceBackup(new Date(NOW.getTime() - DAY).toISOString(), NOW), 1);
  });

  it('agrees Arabic counts in phrases', () => {
    assert.equal(home.dueCountPhrase(2), 'مستحقين محتاجين مراجعة');
    assert.equal(home.dueCountPhrase(3), '3 مستحقات محتاجة مراجعة');
    assert.equal(home.dueCountPhrase(11), '11 مستحق محتاج مراجعة');
    assert.deepEqual([1, 2, 3, 11].map(moreThingsPhrase), ['كمان حاجة واحدة', 'كمان حاجتين', 'كمان 3 حاجات', 'كمان 11 حاجة']);
  });
});

describe('next best actions: snooze', () => {
  const s = (): FinanceState => ({
    ...emptyState(),
    accounts: [account('egp', 'EGP', 1000)],
    recurringRules: [rule({ id: 'r', startDate: '2026-10-05' })],
  });

  it('hides a dismissible action for 24 hours, then shows it again', () => {
    const ctx = makeCtx();
    const snoozed = apply(s(), ops.dismissAction(s(), 'assign', ctx));
    assert.equal(snoozed.actionDismissals.length, 1);
    assert.equal(snoozed.actionDismissals[0].until, new Date(NOW.getTime() + nba.SNOOZE_MS).toISOString());
    assert.ok(!nba.nextActions(snoozed, NOW).some((a) => a.id === 'assign'));
    assert.ok(nba.allActions(snoozed, NOW).some((a) => a.id === 'assign'));
    const almost = new Date(NOW.getTime() + nba.SNOOZE_MS - 1);
    assert.ok(!nba.nextActions(snoozed, almost).some((a) => a.id === 'assign'));
    const after = new Date(NOW.getTime() + nba.SNOOZE_MS + 1);
    assert.ok(nba.nextActions(snoozed, after).some((a) => a.id === 'assign'));
  });

  it('refuses to snooze due items and spent fund money, and ignores such records', () => {
    for (const id of ['due', 'cover']) {
      assert.throws(
        () => ops.dismissAction(s(), id, makeCtx()),
        (e: unknown) => e instanceof FinanceValidationError && e.code === 'ACTION_NOT_DISMISSIBLE'
      );
    }
    const forced: FinanceState = {
      ...s(),
      actionDismissals: [{ id: 'due', actionId: 'due', until: '2027-01-01T00:00:00.000Z', updatedAt: T0 }],
    };
    assert.equal(nba.nextActions(forced, NOW)[0].id, 'due');
  });

  it('re-snoozing replaces the record and drops expired ones (with tombstones)', () => {
    const ctx = makeCtx();
    const old: FinanceState = {
      ...s(),
      actionDismissals: [{ id: 'backup', actionId: 'backup', until: '2026-10-01T00:00:00.000Z', updatedAt: T0 }],
    };
    const once = apply(old, ops.dismissAction(old, 'assign', ctx));
    assert.deepEqual(once.actionDismissals.map((d) => d.actionId), ['assign']);
    assert.deepEqual(once.tombstones.map((t) => [t.entity, t.id]), [['actionDismissal', 'backup']]);
    const twice = apply(once, ops.dismissAction(once, 'assign', ctx));
    assert.equal(twice.actionDismissals.length, 1);
  });
});

describe('net worth snapshots', () => {
  const base = (): FinanceState => ({
    ...emptyState(),
    accounts: [{ ...account('egp', 'EGP', 1000), openingDate: '2026-08-01' }],
    transactions: [
      {
        id: 'in',
        type: 'income',
        amount: 500,
        currency: 'EGP',
        accountId: 'egp',
        categoryId: 'cat-income-salary',
        date: '2026-09-10',
        rateToEGP: 1,
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    settings: { ...emptyState().settings, trackingStartDate: '2026-08-01' },
  });

  it('backfills past months as estimates and upserts the current month', () => {
    const list = snapshots.syncedSnapshots(base(), NOW)!;
    assert.deepEqual(
      list.map((s) => [s.id, s.month, s.netWorthEGP, !!s.estimated]),
      [
        ['nw-2026-08', '2026-08', 1000, true],
        ['nw-2026-09', '2026-09', 1500, true],
        ['nw-2026-10', '2026-10', 1500, false],
      ]
    );
    assert.equal(list[2].takenAt, NOW.toISOString());
    assert.equal(list[2].updatedAt, NOW.toISOString());
    assert.equal(list[2].liquidEGP, 1500);
    assert.equal(list[2].holdingsEGP, 0);
  });

  it('writes nothing when nothing changed, and only the current month when it did', () => {
    const ctx = makeCtx();
    const once = apply(base(), ops.recordNetWorthSnapshots(base(), ctx));
    assert.deepEqual(ops.recordNetWorthSnapshots(once, ctx), {});
    const richer = { ...once, accounts: [{ ...once.accounts[0], openingBalance: 3000 }] };
    const updated = ops.recordNetWorthSnapshots(richer, ctx).netWorthSnapshots!;
    assert.deepEqual(updated.map((s) => s.netWorthEGP), [1000, 1500, 3500]);
  });

  it('leaves out what came after a month ended', () => {
    const s: FinanceState = {
      ...base(),
      holdings: [{ id: 'g', type: 'gold', name: 'g', weightGrams: 1, karat: 24, purchaseCostEGP: 1, purchaseDate: '2026-09-15', updatedAt: T0 }],
      liabilities: [{ id: 'l', name: 'loan', principal: 200, currency: 'EGP', startDate: '2026-10-01', updatedAt: T0 }],
    };
    assert.equal(netWorthAsOf(s, '2026-08-31').netWorthEGP, 1000);
    assert.equal(netWorthAsOf(s, '2026-09-30').netWorthEGP, 1500 + 6000);
    assert.equal(netWorthAsOf(s, '2026-09-30').holdingsEGP, 6000);
    assert.equal(netWorthAsOf(s, '2026-10-31').netWorthEGP, 1500 + 6000 - 200);
  });

  it('measures the change against last month (hidden without a snapshot)', () => {
    assert.equal(snapshots.netWorthChange(base(), NOW), null);
    const s: FinanceState = { ...base(), netWorthSnapshots: snapshots.syncedSnapshots(base(), NOW)! };
    const richer = { ...s, accounts: [{ ...s.accounts[0], openingBalance: 1500 }] };
    const change = snapshots.netWorthChange(richer, NOW)!;
    assert.equal(change.fromMonth, '2026-09');
    approx(change.amountEGP, 500);
    approx(change.pct, 1 / 3);
    // Over September: Sept's end vs August's.
    approx(snapshots.monthNetWorthChange(s, '2026-09', NOW)!.amountEGP, 500);
    assert.equal(snapshots.monthNetWorthChange(s, '2026-08', NOW), null);
    // From zero there is no percentage.
    const fromZero: FinanceState = {
      ...richer,
      netWorthSnapshots: [{ ...s.netWorthSnapshots[1], netWorthEGP: 0 }],
    };
    assert.equal(snapshots.netWorthChange(fromZero, NOW)!.pct, null);
  });
});

describe('migration v6 → v7', () => {
  const v6 = () => {
    const { netWorthSnapshots: _n, actionDismissals: _a, monthlyReviews: _r, ...rest } = {
      ...emptyState(),
      accounts: [{ ...account('egp', 'EGP', 1000), openingDate: '2026-08-01' }],
      settings: { ...emptyState().settings, trackingStartDate: '2026-08-20' },
    };
    return rest;
  };

  it('adds the collections and backfills past months since tracking started', () => {
    const migrated = migrateV6toV7(v6(), MIGRATION_CTX);
    assert.deepEqual(migrated.actionDismissals, []);
    assert.deepEqual(migrated.monthlyReviews, []);
    assert.deepEqual(
      migrated.netWorthSnapshots.map((s) => [s.month, s.netWorthEGP, s.estimated, s.takenAt]),
      [
        ['2026-08', 1000, true, MIGRATION_CTX.now],
        ['2026-09', 1000, true, MIGRATION_CTX.now],
      ]
    );
  });

  it('is idempotent and keeps existing snapshots', () => {
    const once = migrateV6toV7(v6(), MIGRATION_CTX);
    assert.deepEqual(migrateV6toV7(once, MIGRATION_CTX), once);
    const kept = { ...once.netWorthSnapshots[0], netWorthEGP: 777, estimated: undefined };
    const again = migrateV6toV7({ ...once, netWorthSnapshots: [kept] }, MIGRATION_CTX);
    assert.deepEqual(again.netWorthSnapshots.map((s) => [s.month, s.netWorthEGP]), [
      ['2026-08', 777],
      ['2026-09', 1000],
    ]);
  });

  it('runs as part of the chain', () => {
    assert.equal(CURRENT_VERSION, 7);
    const { state } = migratePersistedState(v6(), 6, MIGRATION_CTX);
    assert.equal(state.netWorthSnapshots.length, 2);
    // Tracking that starts this month has nothing to backfill.
    const fresh = { ...v6(), settings: { ...v6().settings, trackingStartDate: '2026-10-01' } };
    assert.deepEqual(migrateV6toV7(fresh, MIGRATION_CTX).netWorthSnapshots, []);
  });
});

describe('monthly review', () => {
  const SEP = '2026-09';
  const tx = (id: string, type: 'income' | 'expense', categoryId: string, amount: number, extra: Partial<Transaction> = {}): Transaction =>
    ({
      id,
      type,
      amount,
      currency: 'EGP',
      accountId: 'egp',
      categoryId,
      date: '2026-09-10',
      rateToEGP: 1,
      createdAt: T0,
      updatedAt: T0,
      ...extra,
    }) as Transaction;
  const s = (): FinanceState => ({
    ...emptyState(),
    accounts: [account('egp', 'EGP', 20000)],
    transactions: [
      tx('salary', 'income', 'cat-income-salary', 10000),
      tx('rent', 'expense', 'cat-essentials-rent', 3000),
      tx('food', 'expense', CATEGORY_IDS.groceries, 2000),
      tx('dining', 'expense', 'cat-lifestyle-dining', 200),
      tx('sofa', 'expense', 'cat-essentials-home-setup', 1500, { oneTime: true, note: 'كنبة' }),
      {
        id: 'gold',
        type: 'asset_purchase',
        amount: 4000,
        currency: 'EGP',
        accountId: 'egp',
        holdingId: 'g',
        date: '2026-09-12',
        rateToEGP: 1,
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    holdings: [{ id: 'g', type: 'gold', name: 'g', weightGrams: 1, karat: 24, purchaseCostEGP: 4000, updatedAt: T0 }],
    funds: [fund({ id: 'goal', name: 'جواز', targetAmount: 50000 }), fund({ id: 'done', targetAmount: 100, priority: 2 })],
    fundMovements: [
      { id: 'm1', fundId: 'goal', amount: 1000, date: '2026-09-15', updatedAt: T0 },
      { id: 'm2', fundId: 'done', amount: 100, date: '2026-08-15', updatedAt: T0 },
    ],
    monthlyPlans: [
      {
        id: 'plan-2026-09',
        month: SEP,
        currency: 'EGP',
        expectedIncome: 10000,
        lines: [
          { categoryId: 'cat-essentials-rent', limit: 3000, kind: 'fixed' },
          { categoryId: CATEGORY_IDS.groceries, limit: 1500, kind: 'flexible' },
          { categoryId: 'cat-lifestyle-dining', limit: 1000, kind: 'flexible' },
        ],
        fundContributions: [{ fundId: 'goal', amount: 1000 }],
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    netWorthSnapshots: [
      { id: 'nw-2026-08', month: '2026-08', netWorthEGP: 20000, liquidEGP: 20000, holdingsEGP: 0, takenAt: T0, updatedAt: T0 },
      { id: 'nw-2026-09', month: SEP, netWorthEGP: 23000, liquidEGP: 17000, holdingsEGP: 6000, takenAt: T0, updatedAt: T0 },
    ],
  });

  it('summarises income, expenses, savings rate and net worth change', () => {
    const r = reviewLogic.monthReview(s(), SEP, NOW);
    assert.equal(r.incomeEGP, 10000);
    // The gold purchase is not an expense.
    assert.equal(r.expenseEGP, 6700);
    assert.equal(r.netEGP, 3300);
    approx(r.savingsRate, 0.33);
    approx(r.netWorthChange!.amountEGP, 3000);
    approx(r.netWorthChange!.pct, 0.15);
  });

  it('compares the plan with what was spent', () => {
    const plan = reviewLogic.monthReview(s(), SEP, NOW).plan!;
    // Buckets cover planned lines only; the sofa (no line) is "outside the plan".
    assert.deepEqual(plan.buckets.essentials, { planned: 4500, spent: 5000 });
    assert.deepEqual(plan.buckets.lifestyle, { planned: 1000, spent: 200 });
    assert.deepEqual(plan.over.map((l) => [l.categoryId, l.remaining]), [[CATEGORY_IDS.groceries, -500]]);
    assert.deepEqual(plan.under.map((l) => [l.categoryId, l.remaining]), [['cat-lifestyle-dining', 800]]);
    // The sofa had no line.
    assert.equal(plan.unplannedSpent, 1500);
    assert.equal(reviewLogic.monthReview(s(), '2026-08', NOW).plan, null);
  });

  it('lists the top regular categories and one-time expenses separately', () => {
    const r = reviewLogic.monthReview(s(), SEP, NOW);
    assert.deepEqual(r.topCategories, [
      { categoryId: 'cat-essentials-rent', amountEGP: 3000 },
      { categoryId: CATEGORY_IDS.groceries, amountEGP: 2000 },
      { categoryId: 'cat-lifestyle-dining', amountEGP: 200 },
    ]);
    assert.deepEqual(r.oneTime, [{ id: 'sofa', categoryId: 'cat-essentials-home-setup', amountEGP: 1500, date: '2026-09-10', note: 'كنبة' }]);
    assert.equal(r.oneTimeTotalEGP, 1500);
    // At most five.
    const many = { ...s(), transactions: Array.from({ length: 8 }, (_, i) => tx(`t${i}`, 'expense', DEFAULT_CATEGORIES.filter((c) => c.kind === 'expense')[i].id, 100 + i)) };
    assert.equal(reviewLogic.monthReview(many, SEP, NOW).topCategories.length, 5);
  });

  it('shows fund allocations against the plan, completed funds and the next step', () => {
    const r = reviewLogic.monthReview(s(), SEP, NOW);
    assert.deepEqual(r.funds, [{ fundId: 'goal', allocated: 1000, planned: 1000 }]);
    assert.deepEqual(r.completedFunds.map((f) => f.id), ['done']);
    assert.equal(r.nextMonth, '2026-10');
    assert.equal(r.nextMonthHasPlan, false);
    assert.equal(r.copyFromMonth, SEP);
    approx(r.unassignedEGP, 20000 + 10000 - 6700 - 4000 - 1100);
    assert.equal(r.reviewed, false);
  });

  it('finishing marks the month reviewed (once; never a future month)', () => {
    const ctx = makeCtx();
    const done = apply(s(), ops.completeMonthlyReview(s(), SEP, ctx));
    assert.deepEqual(done.monthlyReviews.map((m) => [m.id, m.month, m.completedAt]), [['review-2026-09', SEP, NOW.toISOString()]]);
    assert.equal(reviewLogic.monthReview(done, SEP, NOW).reviewed, true);
    assert.deepEqual(ops.completeMonthlyReview(done, SEP, ctx), {});
    assert.throws(
      () => ops.completeMonthlyReview(s(), '2026-11', ctx),
      (e: unknown) => e instanceof FinanceValidationError && e.code === 'INVALID_MONTH'
    );
    // Reviewed months stop the action.
    assert.equal(nba.pendingReviewMonth(s(), NOW), SEP);
    assert.equal(nba.pendingReviewMonth(done, NOW), null);
  });

  it('monthFlows splits where the money went', () => {
    const flows = monthFlows(s(), SEP);
    assert.equal(flows.incomeEGP, 10000);
    assert.equal(flows.expenseEGP, 6700);
    assert.equal(flows.savedToFundsEGP, 1000);
    assert.equal(flows.investedEGP, 4000);
  });

  it('formats percentages with the sign isolated', () => {
    assert.equal(formatPercent(0.335), '⁦‎33.5%⁩');
    assert.equal(formatPercent(0.1, true), '⁦‎+10%⁩');
    assert.equal(formatPercent(-0.04, true), '⁦‎−4%⁩');
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

// --- Funds / recurring UI helpers (Calm Wealth phase 5) ---------------------------

describe('funds UI helpers', () => {
  const at = (day: number) => new Date(2026, 9, day, 12);
  const state = (funds: Fund[], movements: FinanceState['fundMovements'] = []): FinanceState => ({
    ...emptyState(),
    accounts: [account('egp', 'EGP', 1000000)],
    funds,
    fundMovements: movements,
  });

  it('fundsSummary sums current and required in EGP at current rates', () => {
    const s = state(
      [
        fund({ id: 'egp', targetAmount: 30000, deadline: '2026-12-31' }),
        fund({ id: 'sar', currency: 'SAR', targetAmount: 3000, deadline: '2026-12-31' }),
        fund({ id: 'open', targetAmount: 1000 }),
      ],
      [
        { id: 'm1', fundId: 'egp', amount: 6000, date: '2026-09-01', updatedAt: T0 },
        { id: 'm2', fundId: 'sar', amount: 600, date: '2026-09-01', updatedAt: T0 },
      ]
    );
    const summary = fundsUi.fundsSummary(s, at(15));
    approx(summary.reservedEGP, 6000 + 600 * 12.5);
    // (30000 − 6000) / 3 + (3000 − 600) / 3 × 12.5; the open fund has no requirement.
    approx(summary.requiredEGP, 8000 + 800 * 12.5);
    assert.equal(summary.count, 3);
  });

  it('fundNextStep follows the status, the deadline and the target', () => {
    const goal = fund({ id: 'g', targetAmount: 30000, deadline: '2026-12-31' });
    assert.equal(fundsUi.fundNextStep(state([goal]), goal, at(26)).tone, 'attention'); // behind
    assert.ok(fundsUi.fundNextStep(state([goal]), goal, at(26)).text.startsWith('خصص '));
    assert.equal(fundsUi.fundNextStep(state([goal]), goal, at(10)).tone, 'neutral'); // pending
    assert.ok(fundsUi.fundNextStep(state([goal]), goal, at(10)).text.endsWith(' الشهر ده.'));
    const paid = state([goal], [{ id: 'm', fundId: 'g', amount: 10000, date: '2026-10-02', updatedAt: T0 }]);
    assert.deepEqual(fundsUi.fundNextStep(paid, goal, at(26)), { tone: 'ok', text: 'ماشي على الخطة.' });
    const open = fund({ id: 'o', targetAmount: 1000 });
    assert.ok(fundsUi.fundNextStep(state([open]), open, at(26)).text.startsWith('لسه محتاج '));
    const reached = state([open], [{ id: 'm', fundId: 'o', amount: 1000, date: '2026-10-02', updatedAt: T0 }]);
    assert.deepEqual(fundsUi.fundNextStep(reached, open, at(26)), { tone: 'ok', text: 'وصلت للهدف.' });
  });

  it('movementKind tells allocations, withdrawals and sinking payments apart', () => {
    assert.equal(fundsUi.movementKind({ amount: 100 }), 'allocation');
    assert.equal(fundsUi.movementKind({ amount: -100, note: 'سحب' }), 'withdrawal');
    assert.equal(fundsUi.movementKind({ amount: -100 }), 'withdrawal');
    assert.equal(fundsUi.movementKind({ amount: -100, note: 'اتدفعت: تأمين' }), 'payment');
  });
});

describe('recurring UI helpers', () => {
  it('ruleState: paused, ended, active', () => {
    assert.equal(recUi.ruleState({ active: false, nextDate: '2026-11-01' }), 'paused');
    assert.equal(recUi.ruleState({ active: true, nextDate: '' }), 'ended');
    assert.equal(recUi.ruleState({ active: true, nextDate: '2026-11-01' }), 'active');
  });

  it('ruleDetailsOpen when editing a rule with an end date, note or received amount', () => {
    assert.equal(recUi.ruleDetailsOpen(undefined), false);
    assert.equal(recUi.ruleDetailsOpen({}), false);
    assert.equal(recUi.ruleDetailsOpen({ endDate: '2027-01-01' }), true);
    assert.equal(recUi.ruleDetailsOpen({ note: ' x ' }), true);
    assert.equal(recUi.ruleDetailsOpen({ note: '  ' }), false);
    assert.equal(recUi.ruleDetailsOpen({ toAmount: 100 }), true);
  });
});

describe('funds UI: capped percent', () => {
  it('caps the shown percent at 100 and keeps the real one', () => {
    assert.deepEqual(fundsUi.fundPercent(0.42), { shown: 42, real: 42, over: false });
    assert.deepEqual(fundsUi.fundPercent(1), { shown: 100, real: 100, over: false });
    assert.deepEqual(fundsUi.fundPercent(1.79), { shown: 100, real: 179, over: true });
    assert.deepEqual(fundsUi.fundPercent(-0.2), { shown: 0, real: 0, over: false });
  });
});

describe('settings / assets UI helpers', () => {
  it('backupAgeLabel words the age of the last backup', () => {
    assert.equal(settingsUi.backupAgeLabel(null), 'لسه مفيش نسخة');
    assert.equal(settingsUi.backupAgeLabel(0), 'النهارده');
    assert.equal(settingsUi.backupAgeLabel(1), 'منذ يوم');
    assert.equal(settingsUi.backupAgeLabel(2), 'منذ يومين');
    assert.equal(settingsUi.backupAgeLabel(7), 'منذ 7 أيام');
    assert.equal(settingsUi.backupAgeLabel(14), 'منذ 14 يوم');
  });

  it('holdingTitle, signedDifference and groupAccounts', () => {
    const gold = { id: 'g', type: 'gold' as const, name: 'سبيكة 5 جم', weightGrams: 5, karat: 24 as const, purchaseCostEGP: 1, updatedAt: T0 };
    assert.equal(assetsUi.holdingTitle(gold), 'سبيكة 5 جم — عيار 24');
    assert.equal(assetsUi.holdingTitle({ ...gold, name: ' ' }), '5 جم — عيار 24');
    assert.ok(assetsUi.signedDifference(1200).includes('+'));
    assert.ok(assetsUi.signedDifference(-300).includes('−'));
    const accs = [
      account('a', 'EGP', 1),
      account('b', 'SAR', 1, 'SA'),
      { ...account('c', 'EGP', 0), archived: true },
    ];
    const g = assetsUi.groupAccounts(accs);
    assert.deepEqual([g.EG.map((a) => a.id), g.SA.map((a) => a.id), g.archived.map((a) => a.id)], [['a'], ['b'], ['c']]);
  });
});

describe('parseAmount in the add-asset form', () => {
  it('reads Arabic digits with the Arabic thousands separator', () => {
    assert.equal(parseAmount('١٢٬٥٠٠'), 12500);
    assert.equal(parseAmount('٠', { allowZero: true }), 0);
    // Negative or text input is rejected (the form then asks for a valid number).
    assert.equal(parseAmount('-500', { allowZero: true }), null);
  });
});

// --- Live prices ---------------------------------------------------------------

describe('live prices: calculations and validation', () => {
  const ER_API = { result: 'success', base_code: 'USD', rates: { USD: 1, EGP: 50, SAR: 3.75 } };
  const ER_FUN = { timestamp: 1, base: 'USD', rates: { EGP: 52, SAR: 3.75 } };
  const GOLD = { symbol: 'XAU', currency: 'USD', price: 3110.34768, name: 'Gold' };

  it('derives SAR_EGP and USD_EGP from USD-based rates', () => {
    const fx = priceCalc.parseOpenErApi(ER_API)!;
    assert.equal(fx.USD_EGP, 50);
    approx(fx.SAR_EGP, 50 / 3.75);
    approx(priceCalc.parseExchangerateFun(ER_FUN)!.SAR_EGP, 52 / 3.75);
  });

  it('prices a gram of gold from the ounce price, the USD rate and the local premium', () => {
    // 3,110.34768 USD/oz = 100 USD/g → 5,000 EGP/g at 50.
    const plain = priceCalc.goldPricesEGP(GOLD.price, 50);
    approx(plain.goldPrice24kEGP, 5000);
    approx(plain.goldPrice21kEGP, 4375);
    const withPremium = priceCalc.goldPricesEGP(GOLD.price, 50, 4);
    approx(withPremium.goldPrice24kEGP, 5200);
    approx(withPremium.goldPrice21kEGP, 4550);
    approx(priceCalc.goldPricesEGP(GOLD.price, 50, -10).goldPrice24kEGP, 4500);
    assert.equal(priceCalc.parseGoldApi(GOLD), GOLD.price);
  });

  it('rejects broken or implausible responses', () => {
    const fxBad: unknown[] = [
      null,
      'oops',
      { ...ER_API, result: 'error' },
      { ...ER_API, base_code: 'EUR' },
      { ...ER_API, rates: undefined },
      { ...ER_API, rates: { EGP: 0, SAR: 3.75 } },
      { ...ER_API, rates: { EGP: -50, SAR: 3.75 } },
      { ...ER_API, rates: { EGP: '50', SAR: 3.75 } },
      { ...ER_API, rates: { EGP: 50 } },
      { ...ER_API, rates: { EGP: 50, SAR: 375 } },
      { ...ER_API, rates: { EGP: 50000, SAR: 3.75 } },
      { ...ER_API, rates: { EGP: NaN, SAR: 3.75 } },
    ];
    for (const json of fxBad) assert.equal(priceCalc.parseOpenErApi(json), null, JSON.stringify(json));
    assert.equal(priceCalc.parseExchangerateFun({ ...ER_FUN, base: 'EUR' }), null);
    assert.equal(priceCalc.parseExchangerateFun({ base: 'USD' }), null);
    const goldBad: unknown[] = [null, {}, { ...GOLD, symbol: 'XAG' }, { ...GOLD, currency: 'EUR' }, { ...GOLD, price: 0 }, { ...GOLD, price: -1 }, { ...GOLD, price: 1e6 }, { ...GOLD, price: '4000' }];
    for (const json of goldBad) assert.equal(priceCalc.parseGoldApi(json), null, JSON.stringify(json));
    assert.equal(priceCalc.isValidPremiumPct(0), true);
    assert.equal(priceCalc.isValidPremiumPct(-51), false);
    assert.equal(priceCalc.isValidPremiumPct(NaN), false);
  });

  it('parses the typed premium and words the status', () => {
    assert.equal(settingsUi.parsePremiumPct('4.5'), 4.5);
    assert.equal(settingsUi.parsePremiumPct('-3'), -3);
    assert.equal(settingsUi.parsePremiumPct('−٢'), -2);
    assert.equal(settingsUi.parsePremiumPct('0'), 0);
    assert.equal(settingsUi.parsePremiumPct('abc'), null);
    assert.equal(timeAgoPhrase(new Date(NOW.getTime() - 2 * 3_600_000).toISOString(), NOW), 'منذ ساعتين');
    assert.equal(timeAgoPhrase(new Date(NOW.getTime() - 5 * 60_000).toISOString(), NOW), 'منذ 5 دقايق');
    assert.equal(timeAgoPhrase(NOW.toISOString(), NOW), 'دلوقتي');
    assert.equal(
      settingsUi.priceStatusLine({ fxSource: 'open.er-api', lastPriceFetchAt: new Date(NOW.getTime() - 3_600_000).toISOString() }, NOW),
      'المصدر: ExchangeRate-API · آخر تحديث منذ ساعة'
    );
    assert.ok(settingsUi.priceErrorMessage('network').includes('الأسعار المحفوظة زي ما هي'));
  });
});

describe('live prices: fetching', () => {
  const ER_API = { result: 'success', base_code: 'USD', rates: { EGP: 50, SAR: 3.75 } };
  const ER_FUN = { base: 'USD', rates: { EGP: 52, SAR: 3.75 } };
  const GOLD = { symbol: 'XAU', currency: 'USD', price: 3110.34768 };
  type Reply = unknown | Error | 'hang' | { status: number };
  // A fake fetch answering by URL; records what was asked for.
  const fakeFetch = (replies: Record<string, Reply>) => {
    const calls: string[] = [];
    const fetchImpl = (url: string) => {
      calls.push(url);
      const reply = replies[url];
      if (reply === 'hang') return new Promise<never>(() => {});
      if (reply instanceof Error) return Promise.reject(reply);
      if (reply && typeof reply === 'object' && 'status' in reply) return Promise.resolve({ ok: false, json: async () => ({}) });
      return Promise.resolve({ ok: true, json: async () => reply });
    };
    return { fetchImpl, calls };
  };
  const { FX_PRIMARY_URL: P, FX_FALLBACK_URL: F, GOLD_URL: G } = prices;

  it('uses the primary FX source and never calls the fallback when it works', async () => {
    const { fetchImpl, calls } = fakeFetch({ [P]: ER_API, [F]: ER_FUN, [G]: GOLD });
    const result = await prices.fetchLivePrices({ fetchImpl });
    assert.deepEqual(result, { fx: { SAR_EGP: 50 / 3.75, USD_EGP: 50 }, fxSource: 'open.er-api', xauUsd: GOLD.price });
    assert.ok(!calls.includes(F));
  });

  it('falls back when the primary fails, is down or sends invalid data', async () => {
    for (const primary of [new Error('offline'), { status: 500 }, { result: 'error' }, { ...ER_API, rates: { EGP: 0, SAR: 3.75 } }] as Reply[]) {
      const result = await prices.fetchLivePrices({ fetchImpl: fakeFetch({ [P]: primary, [F]: ER_FUN, [G]: GOLD }).fetchImpl });
      assert.equal(result.fxSource, 'exchangerate.fun');
      assert.equal(result.fx!.USD_EGP, 52);
      assert.equal(result.error, undefined);
    }
  });

  it('reports what failed without throwing', async () => {
    const down = new Error('offline');
    const offline = await prices.fetchLivePrices({ fetchImpl: fakeFetch({ [P]: down, [F]: down, [G]: down }).fetchImpl });
    assert.deepEqual(offline, { fx: null, xauUsd: null, error: 'network' });
    const fxBad = await prices.fetchLivePrices({ fetchImpl: fakeFetch({ [P]: {}, [F]: { base: 'USD', rates: {} }, [G]: GOLD }).fetchImpl });
    assert.deepEqual(fxBad, { fx: null, xauUsd: GOLD.price, error: 'fx' });
    const goldBad = await prices.fetchLivePrices({ fetchImpl: fakeFetch({ [P]: ER_API, [G]: { ...GOLD, price: -5 } }).fetchImpl });
    assert.equal(goldBad.error, 'gold');
    assert.equal(goldBad.xauUsd, null);
    assert.equal(goldBad.fx!.USD_EGP, 50);
  });

  it('gives up on a request that hangs (timeout)', async () => {
    const result = await prices.fetchLivePrices({ fetchImpl: fakeFetch({ [P]: 'hang', [F]: 'hang', [G]: 'hang' }).fetchImpl, timeoutMs: 20 });
    assert.deepEqual(result, { fx: null, xauUsd: null, error: 'network' });
  });
});

describe('live prices: applying', () => {
  const OK: prices.PriceFetchResult = { fx: { SAR_EGP: 14, USD_EGP: 50 }, fxSource: 'open.er-api', xauUsd: 3110.34768 };
  const withSettings = (s: FinanceState, settings: Partial<FinanceState['settings']>): FinanceState => ({ ...s, settings: { ...s.settings, ...settings } });
  const AUTO = { priceSource: 'auto' } as const;
  const autoState = () => withSettings(emptyState(), AUTO);

  it('auto mode overwrites rates and gold prices and their dates', () => {
    const s = withSettings(autoState(), { localPremiumPct: 4 });
    const { settings } = apply(s, ops.applyLivePrices(s, OK, makeCtx()));
    assert.deepEqual(settings.exchangeRates, { SAR_EGP: 14, USD_EGP: 50, lastUpdated: NOW.toISOString() });
    approx(settings.goldPrice24kEGP, 5200);
    approx(settings.goldPrice21kEGP, 4550);
    assert.equal(settings.goldPriceUpdatedAt, NOW.toISOString());
    assert.equal(settings.lastPriceFetchAt, NOW.toISOString());
    assert.equal(settings.fxSource, 'open.er-api');
    assert.equal(settings.lastGoldUsdPerOunce, OK.xauUsd);
    assert.equal('lastPriceFetchError' in settings, false);
  });

  it('defaults to manual for data that already has prices: existing installs, restores, imports', () => {
    // Saved before live prices existed: no priceSource.
    const existing = emptyState();
    assert.equal(prices.priceSourceOf(existing.settings), 'manual');
    // Hydrating saved data never switches it to auto…
    assert.deepEqual(ops.ensurePriceSource(existing, false), {});
    // …so a fetch changes nothing and none is started on its own.
    assert.deepEqual(ops.applyLivePrices(existing, OK, makeCtx()), {});
    assert.equal(prices.shouldAutoFetch(existing.settings, NOW), false);
    // Restoring an older backup onto a device in auto mode brings its typed prices as manual.
    const restored = apply(autoState(), ops.restoreFromBackup(autoState(), existing, makeCtx()));
    assert.equal(prices.priceSourceOf(restored.settings), 'manual');
    assert.deepEqual(ops.applyLivePrices(restored, OK, makeCtx()), {});
    // Importing the opening data keeps the device's prices and its (manual) choice.
    const imported = apply(existing, ops.replaceWithSeed(existing, emptyState(), makeCtx()));
    assert.equal(prices.priceSourceOf(imported.settings), 'manual');
    // The migration chain doesn't turn auto on either.
    const { netWorthSnapshots: _n, actionDismissals: _a, monthlyReviews: _r, ...v6 } = emptyState();
    assert.equal(prices.priceSourceOf(migratePersistedState(v6, 6, MIGRATION_CTX).state.settings), 'manual');
  });

  it('defaults to auto only on a fresh install with nothing saved', () => {
    const fresh = apply(emptyState(), ops.ensurePriceSource(emptyState(), true));
    assert.equal(fresh.settings.priceSource, 'auto');
    assert.equal(prices.shouldAutoFetch(fresh.settings, NOW), true);
    approx(apply(fresh, ops.applyLivePrices(fresh, OK, makeCtx())).settings.exchangeRates.SAR_EGP, 14);
    // An explicit choice is never changed, fresh or not.
    const manual = withSettings(emptyState(), { priceSource: 'manual' });
    assert.deepEqual(ops.ensurePriceSource(manual, true), {});
    assert.deepEqual(ops.ensurePriceSource(autoState(), false), {});
  });

  it('never overwrites manual prices', () => {
    const s = withSettings(emptyState(), { priceSource: 'manual' });
    assert.deepEqual(ops.applyLivePrices(s, OK, makeCtx()), {});
    assert.equal(prices.shouldAutoFetch(s.settings, NOW), false);
  });

  it('keeps the saved prices on failure and records the error until a fetch succeeds', () => {
    const s = autoState();
    const failed = apply(s, ops.applyLivePrices(s, { fx: null, xauUsd: null, error: 'network' }, makeCtx()));
    assert.deepEqual(failed.settings.exchangeRates, s.settings.exchangeRates);
    assert.equal(failed.settings.goldPrice24kEGP, s.settings.goldPrice24kEGP);
    assert.equal(failed.settings.lastPriceFetchError, 'network');
    assert.equal(failed.settings.lastPriceFetchAt, undefined);
    // Gold failed: rates update, gold stays.
    const partial = apply(s, ops.applyLivePrices(s, { fx: OK.fx, fxSource: 'exchangerate.fun', xauUsd: null, error: 'gold' }, makeCtx()));
    assert.equal(partial.settings.exchangeRates.SAR_EGP, 14);
    assert.equal(partial.settings.goldPrice24kEGP, s.settings.goldPrice24kEGP);
    assert.equal(partial.settings.goldPriceUpdatedAt, s.settings.goldPriceUpdatedAt);
    assert.equal(partial.settings.lastPriceFetchError, 'gold');
    const recovered = apply(failed, ops.applyLivePrices(failed, OK, makeCtx()));
    assert.equal('lastPriceFetchError' in recovered.settings, false);
  });

  it('throttles auto fetches to once every 6 hours, with a pause after a failed attempt', () => {
    const at = (msAgo: number) => ({ lastPriceFetchAt: new Date(NOW.getTime() - msAgo).toISOString() });
    const HOUR = 3_600_000;
    assert.equal(prices.shouldAutoFetch(AUTO, NOW), true);
    assert.equal(prices.shouldAutoFetch({ ...AUTO, ...at(6 * HOUR - 1) }, NOW), false);
    assert.equal(prices.shouldAutoFetch({ ...AUTO, ...at(6 * HOUR) }, NOW), true);
    assert.equal(prices.shouldAutoFetch({ priceSource: 'manual', ...at(48 * HOUR) }, NOW), false);
    // Tried 5 minutes ago and failed: wait.
    assert.equal(prices.shouldAutoFetch(AUTO, NOW, NOW.getTime() - 5 * 60_000), false);
    assert.equal(prices.shouldAutoFetch(AUTO, NOW, NOW.getTime() - 15 * 60_000), true);
  });

  it('re-prices gold when the premium changes (auto mode only) and validates it', () => {
    const ctx = makeCtx();
    const fetched = apply(autoState(), ops.applyLivePrices(autoState(), OK, ctx));
    approx(fetched.settings.goldPrice24kEGP, 5000);
    const premium = apply(fetched, ops.setPricePreferences(fetched, { localPremiumPct: 10 }, ctx));
    approx(premium.settings.goldPrice24kEGP, 5500);
    approx(premium.settings.goldPrice21kEGP, 5500 * 0.875);
    assert.throws(
      () => ops.setPricePreferences(fetched, { localPremiumPct: 500 }, ctx),
      (e: unknown) => e instanceof FinanceValidationError && e.code === 'NOT_A_NUMBER'
    );
    const manual = apply(fetched, ops.setPricePreferences(fetched, { priceSource: 'manual', localPremiumPct: 10 }, ctx));
    assert.equal(manual.settings.priceSource, 'manual');
    approx(manual.settings.goldPrice24kEGP, 5000);
  });

  it('changes current valuations but no historical plan amount', () => {
    const ctx = makeCtx();
    let s: FinanceState = withSettings(
      {
        ...emptyState(),
        accounts: [account('sar', 'SAR', 1000, 'SA'), account('egp', 'EGP', 5000)],
        holdings: [{ id: 'g', type: 'gold', name: 'g', weightGrams: 10, karat: 24, purchaseCostEGP: 1, updatedAt: T0 }],
      },
      { exchangeRates: { ...RATES, SAR_EGP: 12.5 }, priceSource: 'auto' }
    );
    s = apply(s, ops.addTransaction(s, { type: 'expense', amount: 40, currency: 'SAR', accountId: 'sar', categoryId: CATEGORY_IDS.groceries, date: '2026-10-05' }, ctx));
    s = apply(s, ops.addTransaction(s, { type: 'expense', amount: 250, currency: 'EGP', accountId: 'egp', categoryId: 'cat-lifestyle-dining', date: '2026-10-06' }, ctx));
    s = apply(
      s,
      ops.savePlan(
        s,
        {
          month: '2026-10',
          currency: 'SAR',
          expectedIncome: 0,
          lines: [
            { categoryId: CATEGORY_IDS.groceries, limit: 500, kind: 'flexible' },
            { categoryId: 'cat-lifestyle-dining', limit: 100, kind: 'flexible' },
          ],
          fundContributions: [],
        },
        ctx
      )
    );
    const updated = apply(s, ops.applyLivePrices(s, OK, ctx));
    assert.deepEqual(
      planning.planProgress(updated, '2026-10')!.lines.map((l) => l.spent),
      planning.planProgress(s, '2026-10')!.lines.map((l) => l.spent)
    );
    assert.deepEqual(planning.planProgress(updated, '2026-10')!.lines.map((l) => l.spent), [40, 20]);
    assert.equal(monthSummary(updated, '2026-10').expenseEGP, monthSummary(s, '2026-10').expenseEGP);
    assert.deepEqual(updated.transactions, s.transactions);
    // Balances and gold follow the new prices.
    approx(netWorthEGP(s), 960 * 12.5 + 4750 + 10 * 6000);
    approx(netWorthEGP(updated), 960 * 14 + 4750 + 10 * 5000);
  });

  it('skips the "update prices" action after a successful auto fetch in the last 24 hours', () => {
    const DAY = 86_400_000;
    const stale = new Date(NOW.getTime() - 30 * DAY).toISOString();
    const base = withSettings(
      { ...emptyState(), holdings: [{ id: 'g', type: 'gold', name: 'g', weightGrams: 1, karat: 24, purchaseCostEGP: 1, updatedAt: T0 }] },
      { goldPriceUpdatedAt: stale, priceSource: 'auto' }
    );
    const has = (s: FinanceState) => nba.nextActions(s, NOW).some((a) => a.id === 'prices');
    assert.equal(has(base), true);
    const recent = { lastPriceFetchAt: new Date(NOW.getTime() - DAY + 1000).toISOString() };
    assert.equal(has(withSettings(base, recent)), false);
    assert.equal(has(withSettings(base, { ...recent, lastPriceFetchError: 'gold' })), true);
    assert.equal(has(withSettings(base, { ...recent, priceSource: 'manual' })), true);
    assert.equal(has(withSettings(base, { lastPriceFetchAt: new Date(NOW.getTime() - DAY).toISOString() })), true);
  });
});

// --- Native amounts never drift with the rates ------------------------------------

describe('native amounts never drift with the rates', () => {
  const at = (s: FinanceState, SAR_EGP: number): FinanceState => ({
    ...s,
    settings: { ...s.settings, exchangeRates: { ...s.settings.exchangeRates, SAR_EGP } },
  });
  // 1000 SAR and 5000 EGP of cash, SAR_EGP 13.
  const base = (rate = 13): FinanceState =>
    at({ ...emptyState(), accounts: [account('sar', 'SAR', 1000, 'SA'), account('egp', 'EGP', 5000)] }, rate);
  const withFund = (): FinanceState => ({ ...base(), funds: [fund({ id: 'F', targetAmount: 100000 })] });
  const allocate = (s: FinanceState, amount: number, currency?: 'EGP' | 'SAR' | 'USD', fundId = 'F') =>
    apply(s, ops.allocateMany(s, [{ fundId, amount, ...(currency ? { currency } : {}) }], undefined, makeCtx()));
  const spendSar = (s: FinanceState, amount: number) =>
    apply(
      s,
      ops.addTransaction(
        s,
        { type: 'expense', amount, currency: 'SAR', accountId: 'sar', categoryId: 'cat-essentials-bills', date: '2026-10-10' },
        makeCtx()
      )
    );

  it('a 1000 SAR account stays 1000 SAR when SAR_EGP moves 13 → 15; only its EGP value follows', () => {
    const before = base(13);
    const after = at(before, 15);
    assert.equal(accountBalance(before, 'sar'), 1000);
    assert.equal(accountBalance(after, 'sar'), 1000);
    assert.equal(sel.accountBalanceEGP(before, before.accounts[0]), 13000);
    assert.equal(sel.accountBalanceEGP(after, after.accounts[0]), 15000);
    assert.deepEqual(liquidByCurrency(after), { EGP: 5000, SAR: 1000, USD: 0 });
    assert.equal(netWorthEGP(before), 18000);
    assert.equal(netWorthEGP(after), 20000);
  });

  it('balances built from SAR income, expenses and same-currency transfers stay exact', () => {
    const ctx = makeCtx();
    let s: FinanceState = at({ ...emptyState(), accounts: [account('a', 'SAR', 1000, 'SA'), account('b', 'SAR', 0, 'SA')] }, 13);
    s = apply(s, ops.addTransaction(s, { type: 'income', amount: 500.55, currency: 'SAR', accountId: 'a', categoryId: 'cat-income-salary', date: '2026-10-01' }, ctx));
    s = apply(s, ops.addTransaction(s, { type: 'expense', amount: 200.1, currency: 'SAR', accountId: 'a', categoryId: 'cat-essentials-bills', date: '2026-10-02' }, ctx));
    // No conversion between two SAR accounts: the received amount is exactly what was sent.
    s = apply(s, ops.addTransfer(s, { fromAccountId: 'a', toAccountId: 'b', amount: 333.33, date: '2026-10-03' }, ctx));
    assert.equal(s.transactions[0].type === 'transfer' && s.transactions[0].toAmount, 333.33);
    const natives = [accountBalance(s, 'a'), accountBalance(s, 'b')];
    approx(natives[0], 1000 + 500.55 - 200.1 - 333.33);
    approx(natives[1], 333.33);
    for (const rate of [13, 15, 9.7]) {
      const moved = at(s, rate);
      assert.deepEqual([accountBalance(moved, 'a'), accountBalance(moved, 'b')], natives);
    }
    // "Set current balance" round-trips exactly too.
    const opening = openingBalanceForCurrentBalance(s, 'a', 1234.56);
    const reset = { ...s, accounts: s.accounts.map((x) => (x.id === 'a' ? { ...x, openingBalance: opening } : x)) };
    approx(accountBalance(at(reset, 15), 'a'), 1234.56);
  });

  it('a currency holding is its quantity; only its value in EGP follows the rate', () => {
    const holding = { id: 'h', type: 'currency' as const, name: 'ريال', currency: 'SAR' as const, quantity: 1000, purchaseCostEGP: 12000, updatedAt: T0 };
    const s: FinanceState = {
      ...emptyState(),
      holdings: [holding],
      funds: [
        fund({ id: 'FS', currency: 'SAR', targetAmount: 5000, linkedHoldingIds: ['h'] }),
        fund({ id: 'FE', targetAmount: 50000 }),
      ],
    };
    const before = at(s, 13);
    const after = at(s, 15);
    assert.equal(holding.quantity, 1000);
    assert.equal(sel.holdingValueEGP(before, holding), 13000);
    assert.equal(sel.holdingValueEGP(after, holding), 15000);
    // In a SAR fund it is exactly its quantity (no round trip through EGP); in an EGP fund it follows the rate.
    assert.equal(fundCurrent(before, 'FS'), 1000);
    assert.equal(fundCurrent(after, 'FS'), 1000);
    assert.equal(fundCurrent(after, 'FE'), 0);
    const linkedToEgp = { ...after, funds: [fund({ id: 'FE', targetAmount: 50000, linkedHoldingIds: ['h'] })] };
    assert.equal(fundCurrent(linkedToEgp, 'FE'), 15000);
  });

  it('a SAR allocation to an EGP fund: the fund’s value follows the rate, SAR unassigned does not', () => {
    const s = withFund();
    assert.throws(() => allocate(s, 1001, 'SAR'), { code: 'INSUFFICIENT_UNASSIGNED' }); // only 1000 SAR exist
    assert.throws(() => allocate(s, 5001, 'EGP'), { code: 'INSUFFICIENT_UNASSIGNED' }); // only 5000 EGP exist
    const funded = allocate(s, 400, 'SAR');
    const later = at(funded, 15);

    assert.equal(funded.fundMovements[0].amount, 400);
    assert.equal(funded.fundMovements[0].currency, 'SAR');
    assert.equal(sel.fundAllocatedIn(later, 'F', 'SAR'), 400);
    approx(fundAllocated(funded, 'F'), 400 * 13);
    approx(fundAllocated(later, 'F'), 400 * 15);
    approx(fundProgress(later, 'F'), 6000 / 100000);
    // Unassigned money per currency is unchanged by the rate…
    assert.deepEqual(sel.unassignedByCurrency(funded), { EGP: 5000, SAR: 600, USD: 0 });
    assert.deepEqual(sel.unassignedByCurrency(later), { EGP: 5000, SAR: 600, USD: 0 });
    // …only its EGP total (display) moves.
    approx(unassignedEGP(funded), 600 * 13 + 5000);
    approx(unassignedEGP(later), 600 * 15 + 5000);
    const summary = sel.unassignedSummary(later);
    assert.deepEqual(summary.surpluses, [{ currency: 'EGP', amount: 5000 }, { currency: 'SAR', amount: 600 }]);
    assert.deepEqual(summary.deficits, []);
  });

  it('old movements (no currency) behave exactly as before', () => {
    const legacy = (amount: number): FinanceState['fundMovements'] => [
      { id: 'm', updatedAt: T0, fundId: 'F', amount, date: '2026-09-01' },
    ];
    // Everything in EGP: the sum of the movements, the old unassigned figure.
    const egp: FinanceState = { ...emptyState(), accounts: [account('egp', 'EGP', 10000)], funds: [fund({ id: 'F' })], fundMovements: legacy(6000) };
    assert.equal(fundAllocated(egp, 'F'), 6000);
    assert.deepEqual(sel.fundCashByCurrency(egp, 'F'), { EGP: 6000, SAR: 0, USD: 0 });
    assert.deepEqual(sel.unassignedByCurrency(egp), { EGP: 4000, SAR: 0, USD: 0 });
    assert.equal(unassignedEGP(egp), 4000);

    // Mixed: EGP movements against SAR money have no source currency, so they take EGP first
    // and then SAR at today's rate. Totals are the old totals and nothing is falsely "short".
    const mixed: FinanceState = { ...base(13), funds: [fund({ id: 'F' })], fundMovements: legacy(10000) };
    approx(unassignedEGP(mixed), 13000 + 5000 - 10000);
    approx(unassignedEGP(at(mixed, 15)), 15000 + 5000 - 10000);
    const by = sel.unassignedByCurrency(mixed);
    approx(by.EGP, 0);
    approx(by.SAR, 1000 - 5000 / 13);
    assert.deepEqual(sel.unassignedSummary(mixed).deficits, []);
    approx(fundAllocated(at(mixed, 15), 'F'), 10000);

    // More than all the money: the rest is short in the fund's currency.
    const over: FinanceState = { ...base(13), funds: [fund({ id: 'F' })], fundMovements: legacy(20000) };
    approx(unassignedEGP(over), 13000 + 5000 - 20000);
    const deficits = sel.unassignedSummary(over).deficits;
    assert.equal(deficits.length, 1);
    assert.equal(deficits[0].currency, 'EGP');
    approx(deficits[0].amount, 2000);

    // The fund edit sheet still sets the total cash: any currency's money may back an increase.
    const edited = apply(mixed, ops.editFund(mixed, 'F', { name: 'F', targetAmount: 100000, cashAllocation: 12000 }, makeCtx()));
    assert.equal(edited.fundMovements.at(-1)!.currency, undefined);
    approx(fundAllocated(edited, 'F'), 12000);
    assert.throws(() => ops.editFund(mixed, 'F', { name: 'F', targetAmount: 100000, cashAllocation: 30000 }, makeCtx()), {
      code: 'INSUFFICIENT_UNASSIGNED',
    });
  });

  it('withdrawals are per currency: SAR cash can only leave as SAR', () => {
    const funded = allocate(allocate(withFund(), 400, 'SAR'), 2000, 'EGP');
    const ctx = makeCtx();
    // The EGP cash can't pay for a SAR withdrawal, nor SAR cash for an EGP one.
    assert.throws(() => ops.withdrawFromFund(funded, 'F', 401, undefined, ctx, 'SAR'), { code: 'WITHDRAW_EXCEEDS_FUND' });
    assert.throws(() => ops.withdrawFromFund(funded, 'F', 2001, undefined, ctx), { code: 'WITHDRAW_EXCEEDS_FUND' });
    const after = apply(funded, ops.withdrawFromFund(funded, 'F', 150, undefined, ctx, 'SAR'));
    assert.deepEqual(sel.fundCashByCurrency(after, 'F'), { EGP: 2000, SAR: 250, USD: 0 });
    assert.deepEqual(sel.unassignedByCurrency(after), { EGP: 3000, SAR: 750, USD: 0 });
    // A bad currency is rejected.
    assert.throws(() => ops.allocateToFund(funded, 'F', 1, undefined, ctx, 'XYZ' as 'SAR'), { code: 'CURRENCY_MISMATCH' });
  });

  it('a shortfall in SAR is covered with SAR cash, never with another currency', () => {
    const funded = allocate(allocate(withFund(), 400, 'SAR'), 2000, 'EGP');
    const short = spendSar(funded, 800); // SAR balance 200, SAR set aside 400
    const summary = sel.unassignedSummary(short);
    assert.deepEqual(summary.deficits, [{ currency: 'SAR', amount: 200 }]);
    assert.equal(summary.byCurrency.EGP, 3000);

    const plan = planCover(short, ['F']);
    assert.deepEqual(plan.withdrawals, [{ fundId: 'F', amount: 200, currency: 'SAR' }]);
    assert.equal(plan.remainingEGP, 0);
    assert.deepEqual(planCover(short, ['F'], 'EGP').withdrawals, []);

    const covered = apply(short, ops.withdrawMany(short, plan.withdrawals, 'تغطية مصروف', makeCtx()));
    assert.deepEqual(sel.unassignedSummary(covered).deficits, []);
    assert.deepEqual(sel.fundCashByCurrency(covered, 'F'), { EGP: 2000, SAR: 200, USD: 0 });

    // Home asks for it in the shortfall's own currency.
    const action = nba.nextActions(short, NOW).find((a) => a.id === 'cover')!;
    assert.equal(action.currency, 'SAR');
    assert.equal(action.amount, 200);
    // A fund with no SAR cash can't cover a SAR shortfall.
    const onlyEgp = allocate(allocate(withFund(), 400, 'SAR'), 2000, 'EGP', 'F');
    const noSar = { ...spendSar(onlyEgp, 800), funds: [...onlyEgp.funds, fund({ id: 'G', priority: 2 })] };
    approx(planCover(noSar, ['G']).remainingEGP, 200 * 13);
  });

  it('Home quotes money without a job in its own currency, or the EGP total for several', () => {
    const sarOnly: FinanceState = at({ ...emptyState(), accounts: [account('sar', 'SAR', 1000, 'SA')] }, 13);
    const one = nba.nextActions(sarOnly, NOW).find((a) => a.id === 'assign')!;
    assert.deepEqual([one.amount, one.currency], [1000, 'SAR']);
    const both = nba.nextActions(base(), NOW).find((a) => a.id === 'assign')!;
    assert.deepEqual([both.amount, both.currency], [13000 + 5000, 'EGP']);
    assert.equal(reviewLogic.monthReview(base(), '2026-09', NOW).surplusEGP, 18000);
  });

  it('suggests a split of SAR money across funds, in SAR', () => {
    const s: FinanceState = {
      ...base(),
      funds: [
        fund({ id: 'A', priority: 1, monthlyContribution: 6500 }), // 500 SAR
        fund({ id: 'B', priority: 2, monthlyContribution: 13000 }), // 1,000 SAR
      ],
    };
    assert.deepEqual(sel.suggestAllocationIn(s, 'SAR', 1000, NOW), [
      { fundId: 'A', amount: 500, currency: 'SAR' },
      { fundId: 'B', amount: 500, currency: 'SAR' },
    ]);
    const after = apply(s, ops.allocateMany(s, sel.suggestAllocationIn(s, 'SAR', 1000, NOW), 'توزيع', makeCtx()));
    assert.equal(sel.unassignedByCurrency(after).SAR, 0);
  });

  it('paying a sinking fund uses cash in the payment’s currency first, with no conversion', () => {
    const s: FinanceState = {
      ...base(),
      funds: [fund({ id: 'S', type: 'sinking', targetAmount: 5000, frequency: 'yearly', nextDueDate: '2026-10-20' })],
    };
    const funded = allocate(allocate(s, 300, 'SAR', 'S'), 2000, 'EGP', 'S');
    const pay = (amount: number) =>
      apply(funded, ops.paySinkingFund(funded, { fundId: 'S', accountId: 'sar', categoryId: 'cat-essentials-bills', amount, date: '2026-10-15' }, makeCtx()));

    const small = pay(100);
    assert.deepEqual(sel.fundCashByCurrency(small, 'S'), { EGP: 2000, SAR: 200, USD: 0 });
    // The fund paid for it, so SAR unassigned is untouched.
    assert.equal(sel.unassignedByCurrency(small).SAR, sel.unassignedByCurrency(funded).SAR);

    // More than its SAR cash: the rest comes out of the EGP cash at today's rate.
    const big = pay(400);
    const cash = sel.fundCashByCurrency(big, 'S');
    assert.equal(cash.SAR, 0);
    approx(cash.EGP, 2000 - 100 * 13);
  });

  it('editing a fund’s total cash takes from its own currency first, then the others', () => {
    const funded = allocate({ ...base(), funds: [fund({ id: 'F', targetAmount: 100000 })], fundMovements: [{ id: 'm0', updatedAt: T0, fundId: 'F', amount: 1000, date: '2026-09-01' }] }, 100, 'SAR');
    approx(fundAllocated(funded, 'F'), 2300);
    const small = apply(funded, ops.editFund(funded, 'F', { name: 'F', targetAmount: 100000, cashAllocation: 1500 }, makeCtx()));
    assert.deepEqual(sel.fundCashByCurrency(small, 'F'), { EGP: 200, SAR: 100, USD: 0 });
    const deep = apply(funded, ops.editFund(funded, 'F', { name: 'F', targetAmount: 100000, cashAllocation: 1000 }, makeCtx()));
    const cash = sel.fundCashByCurrency(deep, 'F');
    approx(cash.EGP, 0);
    approx(cash.SAR, 100 - 300 / 13);
    approx(fundAllocated(deep, 'F'), 1000);
  });

  it('plan progress counts a SAR allocation as exactly what it was, and keeps history at its own rates', () => {
    const planFor = (currency: 'SAR' | 'EGP'): ops.PlanInput => ({
      month: '2026-10',
      currency,
      expectedIncome: 0,
      lines: [],
      fundContributions: [{ fundId: 'F', amount: 400 }],
    });
    const prepare = (currency: 'SAR' | 'EGP') => {
      const funded = allocate(withFund(), 400, 'SAR');
      return at(apply(funded, ops.savePlan(funded, planFor(currency), makeCtx())), 15);
    };
    assert.equal(planning.planProgress(prepare('SAR'), '2026-10')!.contributions[0].allocated, 400);
    // In an EGP plan it is what 400 SAR was worth when allocated (13), not today's 15.
    approx(planning.planProgress(prepare('EGP'), '2026-10')!.contributions[0].allocated, 400 * 13);
    approx(reviewLogic.monthReview(prepare('SAR'), '2026-10', NOW).funds[0].allocated, 400);
  });
});

// --- Analytics ------------------------------------------------------------------------

describe('analytics', () => {
  const OCT_26 = new Date(2026, 9, 26, 12);
  const SNAP = { SAR_EGP: 12.5, USD_EGP: 50 };
  const tx = (
    id: string,
    type: 'income' | 'expense',
    categoryId: string,
    amount: number,
    date: string,
    extra: Record<string, unknown> = {}
  ): Transaction =>
    ({
      id,
      type,
      amount,
      currency: 'EGP',
      accountId: 'egp',
      categoryId,
      date,
      rateToEGP: 1,
      ratesSnapshot: SNAP,
      createdAt: `${date}T10:00:00.000Z`,
      updatedAt: T0,
      ...extra,
    }) as Transaction;
  const sarTx = (id: string, type: 'income' | 'expense', categoryId: string, amount: number, date: string): Transaction =>
    tx(id, type, categoryId, amount, date, { currency: 'SAR', accountId: 'sar', rateToEGP: 12.5 });
  const gold = (id: string, amount: number, date: string): Transaction =>
    ({
      id,
      type: 'asset_purchase',
      amount,
      currency: 'EGP',
      accountId: 'egp',
      holdingId: 'g1',
      date,
      rateToEGP: 1,
      ratesSnapshot: SNAP,
      createdAt: `${date}T10:00:00.000Z`,
      updatedAt: T0,
    }) as Transaction;
  const transfer = (id: string, amount: number, date: string): Transaction =>
    ({
      id,
      type: 'transfer',
      amount,
      toAmount: amount / 12.5,
      fromAccountId: 'egp',
      toAccountId: 'sar',
      date,
      rateToEGP: 1,
      ratesSnapshot: SNAP,
      createdAt: `${date}T10:00:00.000Z`,
      updatedAt: T0,
    }) as Transaction;
  const movement = (id: string, fundId: string, amount: number, date: string, extra: Record<string, unknown> = {}) => ({
    id,
    fundId,
    amount,
    date,
    ratesSnapshot: SNAP,
    updatedAt: T0,
    ...extra,
  });
  const at = (s: FinanceState, SAR_EGP: number): FinanceState => ({
    ...s,
    settings: { ...s.settings, exchangeRates: { ...s.settings.exchangeRates, SAR_EGP } },
  });
  const withTx = (s: FinanceState, ...more: Transaction[]): FinanceState => ({ ...s, transactions: [...s.transactions, ...more] });

  // Tracking starts 1 Aug. Aug: salary 10,000 · rent 3,000 · groceries 1,000 · dining 500.
  // Sep: salary 10,000 + freelance 2,000 · rent 3,000 · groceries 1,500 · dining 1,000 · sofa 4,000
  // (one-time) · gold 3,000 · a transfer. Oct: salary 10,000 · rent 3,000 · groceries 2,400 ·
  // dining 300 EGP + 100 SAR (= 1,250) · gift 200. In July (before tracking): a 777 expense.
  const ledger = (): FinanceState => ({
    ...emptyState(),
    accounts: [account('egp', 'EGP', 20000), account('sar', 'SAR', 2000, 'SA')],
    settings: { ...emptyState().settings, trackingStartDate: '2026-08-01' },
    holdings: [{ id: 'g1', type: 'gold', name: 'g', weightGrams: 0.5, karat: 21, purchaseCostEGP: 3000, updatedAt: T0 }],
    funds: [fund({ id: 'F', targetAmount: 20000, priority: 1 })],
    fundMovements: [
      movement('m1', 'F', 1000, '2026-08-10'),
      movement('m2', 'F', 1000, '2026-09-10'),
      movement('m3', 'F', 1000, '2026-10-10'),
    ],
    transactions: [
      tx('x0', 'expense', 'cat-lifestyle-misc', 777, '2026-07-20'),
      tx('a1', 'income', 'cat-income-salary', 10000, '2026-08-05'),
      tx('a2', 'expense', 'cat-essentials-rent', 3000, '2026-08-06'),
      tx('a3', 'expense', CATEGORY_IDS.groceries, 1000, '2026-08-10'),
      tx('a4', 'expense', 'cat-lifestyle-dining', 500, '2026-08-12'),
      tx('b1', 'income', 'cat-income-salary', 10000, '2026-09-05'),
      tx('b2', 'income', 'cat-income-freelance', 2000, '2026-09-10'),
      tx('b3', 'expense', 'cat-essentials-rent', 3000, '2026-09-06'),
      tx('b4', 'expense', CATEGORY_IDS.groceries, 1500, '2026-09-12'),
      tx('b5', 'expense', 'cat-lifestyle-dining', 1000, '2026-09-18'),
      tx('b6', 'expense', 'cat-essentials-home-setup', 4000, '2026-09-15', { oneTime: true }),
      gold('b7', 3000, '2026-09-20'),
      transfer('b8', 2500, '2026-09-22'),
      tx('c1', 'income', 'cat-income-salary', 10000, '2026-10-05'),
      tx('c2', 'expense', 'cat-essentials-rent', 3000, '2026-10-06'),
      tx('c3', 'expense', CATEGORY_IDS.groceries, 2400, '2026-10-09'),
      tx('c4', 'expense', 'cat-lifestyle-dining', 300, '2026-10-11'),
      sarTx('c5', 'expense', 'cat-lifestyle-dining', 100, '2026-10-08'),
      tx('c6', 'expense', 'cat-giving-gifts', 200, '2026-10-13'),
    ],
  });
  const query = (
    state: FinanceState,
    kind: analytics.PeriodKind,
    over: Partial<analytics.AnalyticsQuery> = {}
  ): analytics.AnalyticsQuery => ({
    period: analytics.resolvePeriod(state, kind, NOW),
    currency: 'EGP',
    includeOneTime: true,
    ...over,
  });

  describe('periods', () => {
    it('resolves the presets, clamped to the tracking start', () => {
      const s = ledger();
      assert.deepEqual(analytics.resolvePeriod(s, 'month', NOW), { kind: 'month', months: 1, from: '2026-10-01', to: '2026-10-31' });
      assert.deepEqual(analytics.resolvePeriod(s, '3m', NOW), { kind: '3m', months: 3, from: '2026-08-01', to: '2026-10-31' });
      // 6 months and a year reach back before tracking: they start at the tracking start.
      assert.equal(analytics.resolvePeriod(s, '6m', NOW).from, '2026-08-01');
      assert.equal(analytics.resolvePeriod(s, 'year', NOW).from, '2026-08-01');
      assert.deepEqual(analytics.resolvePeriod(s, 'sinceStart', NOW), { kind: 'sinceStart', from: '2026-08-01', to: '2026-10-31' });
      const early = { ...s, settings: { ...s.settings, trackingStartDate: '2025-01-01' } };
      assert.equal(analytics.resolvePeriod(early, '6m', NOW).from, '2026-05-01');
      assert.equal(analytics.resolvePeriod(early, 'year', NOW).from, '2025-11-01');
    });

    it('a custom period is as given (swapped if reversed) and may cover days before tracking', () => {
      const s = ledger();
      assert.deepEqual(analytics.resolvePeriod(s, 'custom', NOW, { from: '2026-07-01', to: '2026-07-31' }), {
        kind: 'custom',
        from: '2026-07-01',
        to: '2026-07-31',
      });
      assert.deepEqual(analytics.resolvePeriod(s, 'custom', NOW, { from: '2026-09-30', to: '2026-09-01' }), {
        kind: 'custom',
        from: '2026-09-01',
        to: '2026-09-30',
      });
      assert.deepEqual(analytics.monthsInPeriod({ from: '2026-08-15', to: '2026-10-02' }), ['2026-08', '2026-09', '2026-10']);
    });

    it('filters rows by period: presets leave out rows before tracking, a custom period can include them', () => {
      const s = ledger();
      const total = (kind: analytics.PeriodKind, custom?: { from: string; to: string }) =>
        analytics.periodTotals(s, { ...query(s, 'month'), period: analytics.resolvePeriod(s, kind, NOW, custom) });
      // Oct only.
      assert.equal(total('month').income, 10000);
      assert.equal(total('month').expense, 3000 + 2400 + 300 + 1250 + 200);
      // Aug–Oct, and since the start, are the same here; the July expense is never in them.
      assert.equal(total('3m').expense, 4500 + 9500 + 7150);
      assert.equal(total('sinceStart').expense, 21150);
      assert.equal(total('year').income, 32000);
      // Explicitly asking for July covers it.
      const july = total('custom', { from: '2026-07-01', to: '2026-07-31' });
      assert.equal(july.expense, 777);
      assert.equal(total('custom', { from: '2026-07-15', to: '2026-08-10' }).expense, 777 + 3000 + 1000);
    });

    it('previous period: the equal span right before, or nothing to compare with', () => {
      const s = ledger();
      assert.deepEqual(analytics.previousPeriod(s, analytics.resolvePeriod(s, 'month', NOW)), {
        kind: 'month',
        months: 1,
        from: '2026-09-01',
        to: '2026-09-30',
      });
      // Aug–Oct would be compared with May–Jul, which is before tracking.
      assert.equal(analytics.previousPeriod(s, analytics.resolvePeriod(s, '3m', NOW)), null);
      assert.equal(analytics.previousPeriod(s, analytics.resolvePeriod(s, 'sinceStart', NOW)), null);
      const early = { ...s, settings: { ...s.settings, trackingStartDate: '2025-01-01' } };
      assert.deepEqual(analytics.previousPeriod(early, analytics.resolvePeriod(early, '3m', NOW)), {
        kind: '3m',
        months: 3,
        from: '2026-05-01',
        to: '2026-07-31',
      });
      // Custom: the same number of days ending the day before.
      const custom = analytics.resolvePeriod(s, 'custom', NOW, { from: '2026-09-11', to: '2026-09-20' });
      assert.deepEqual(analytics.previousPeriod(s, custom), { kind: 'custom', from: '2026-09-01', to: '2026-09-10' });
      assert.equal(analytics.previousPeriod(s, analytics.resolvePeriod(s, 'custom', NOW, { from: '2026-08-05', to: '2026-08-14' })), null);
    });
  });

  describe('totals', () => {
    it('asset purchases and transfers are not spending; gold is its own figure', () => {
      const s = ledger();
      const sep = analytics.periodTotals(s, { ...query(s, 'month'), period: { kind: 'custom', from: '2026-09-01', to: '2026-09-30' } });
      assert.equal(sep.expense, 9500);
      assert.equal(sep.income, 12000);
      assert.equal(sep.gold, 3000);
      assert.deepEqual(sep.byBucket, { essentials: 8500, lifestyle: 1000, giving: 0 });
      assert.equal(sep.fundsNet, 1000);
    });

    it('the one-time toggle', () => {
      const s = ledger();
      const sep = { kind: 'custom' as const, from: '2026-09-01', to: '2026-09-30' };
      const on = analytics.periodTotals(s, { period: sep, currency: 'EGP', includeOneTime: true });
      const off = analytics.periodTotals(s, { period: sep, currency: 'EGP', includeOneTime: false });
      assert.equal(on.expense, 9500);
      assert.equal(off.expense, 5500);
      assert.equal(off.byBucket.essentials, 4500);
      assert.equal(off.byCategory.has('cat-essentials-home-setup'), false);
      approx(off.savingsRate, (12000 - 5500) / 12000);
      assert.equal(analytics.oneTimeSpend(s, { period: sep, currency: 'EGP', includeOneTime: false }), 4000);
    });

    it('the currency toggle: native SAR stays exact, EGP rows convert with their own snapshot, history ignores today’s rate', () => {
      const s = ledger();
      const sar = analytics.periodTotals(s, query(s, 'month', { currency: 'SAR' }));
      approx(sar.income, 10000 / 12.5);
      // 300 EGP at the snapshot (24 SAR) + the 100 SAR expense exactly.
      assert.equal(sar.byCategory.get('cat-lifestyle-dining')!.amount, 24 + 100);
      approx(sar.expense, 7150 / 12.5);
      // The SAR rate moving 12.5 → 20 changes nothing about what already happened.
      const later = analytics.periodTotals(at(s, 20), query(at(s, 20), 'month', { currency: 'SAR' }));
      assert.deepEqual(later.income, sar.income);
      assert.deepEqual(later.expense, sar.expense);
      assert.equal(later.byCategory.get('cat-lifestyle-dining')!.amount, 124);
      // …and in EGP the SAR expense is what it was worth then (100 × 12.5).
      assert.equal(analytics.periodTotals(at(s, 20), query(at(s, 20), 'month')).byCategory.get('cat-lifestyle-dining')!.amount, 300 + 1250);
    });

    it('a transaction without a snapshot converts its other leg at today’s rate (documented approximation)', () => {
      const old = tx('o1', 'expense', 'cat-lifestyle-dining', 1250, '2026-10-02', { ratesSnapshot: undefined });
      const s = withTx({ ...emptyState(), settings: { ...emptyState().settings, trackingStartDate: '2026-08-01' } }, old);
      const q = query(s, 'month', { currency: 'SAR' });
      approx(analytics.periodTotals(s, q).expense, 100);
      approx(analytics.periodTotals(at(s, 25), q).expense, 50);
      assert.equal(analytics.periodTotals(at(s, 25), query(s, 'month')).expense, 1250);
    });

    it('hasAnalyticsData needs income or spending since tracking started', () => {
      assert.equal(analytics.hasAnalyticsData(ledger()), true);
      assert.equal(analytics.hasAnalyticsData(emptyState()), false);
      const onlyOld = { ...emptyState(), transactions: [tx('o', 'expense', 'cat-lifestyle-misc', 5, '2025-01-01')] };
      assert.equal(analytics.hasAnalyticsData(onlyOld), false);
    });
  });

  describe('where did the money go (Sankey)', () => {
    const SEP = { kind: 'custom' as const, from: '2026-09-01', to: '2026-09-30' };
    const byId = (flow: analytics.SpendingFlow, id: string) => flow.nodes.find((n) => n.id === id);
    // Every node's inflow and outflow match its value; sources have no inflow, leaves no outflow.
    const assertBalanced = (flow: analytics.SpendingFlow) => {
      approx(flow.totalIn, flow.totalOut);
      for (const node of flow.nodes) {
        const incoming = flow.links.filter((l) => l.target === node.id).reduce((t, l) => t + l.value, 0);
        const outgoing = flow.links.filter((l) => l.source === node.id).reduce((t, l) => t + l.value, 0);
        if (node.kind !== 'source') approx(incoming, node.value);
        if (node.kind === 'source' || node.kind === 'bucket') approx(outgoing, node.value);
      }
    };

    it('income spreads over buckets, funds and a surplus, and it balances', () => {
      const s = ledger();
      const flow = analytics.spendingFlow(s, query(s, 'month'));
      assert.deepEqual(
        flow.nodes.filter((n) => n.kind !== 'category').map((n) => [n.id, n.value]),
        [
          ['src:salary', 10000],
          ['bucket:essentials', 5400],
          ['bucket:lifestyle', 1550],
          ['bucket:giving', 200],
          ['dest:funds', 1000],
          ['dest:surplus', 1850],
        ]
      );
      assert.equal(flow.totalIn, 10000);
      assertBalanced(flow);
      assert.equal(byId(flow, 'src:balance'), undefined);
    });

    it('gold is a destination, never spending; spending beyond income comes "من رصيدك"', () => {
      const s = ledger();
      const flow = analytics.spendingFlow(s, { period: SEP, currency: 'EGP', includeOneTime: true });
      assert.equal(byId(flow, 'dest:gold')!.value, 3000);
      assert.equal(byId(flow, 'bucket:essentials')!.value, 8500); // the gold isn't in any bucket
      assert.equal(byId(flow, 'src:balance')!.label, 'من رصيدك');
      approx(byId(flow, 'src:balance')!.value, 1500);
      assert.equal(byId(flow, 'dest:surplus'), undefined);
      assert.equal(flow.totalIn, 13500);
      assertBalanced(flow);
      // Leaving the one-time sofa out turns it into a surplus again.
      const lean = analytics.spendingFlow(s, { period: SEP, currency: 'EGP', includeOneTime: false });
      assert.equal(byId(lean, 'src:balance'), undefined);
      assert.equal(byId(lean, 'dest:surplus')!.value, 2500);
      assertBalanced(lean);
    });

    it('income sources: راتب · فري لانس · دخل تاني; money released from funds is a source', () => {
      let s = withTx(ledger(), tx('i1', 'income', CATEGORY_IDS.otherIncome, 700, '2026-09-25'));
      // September put 1,000 into the fund; taking 1,500 out leaves 500 released.
      s = { ...s, fundMovements: [...s.fundMovements, movement('w1', 'F', -1500, '2026-09-26')] };
      const flow = analytics.spendingFlow(s, { period: SEP, currency: 'EGP', includeOneTime: true });
      assert.deepEqual(
        flow.nodes.filter((n) => n.kind === 'source').map((n) => [n.label, n.value]),
        [['راتب', 10000], ['فري لانس', 2000], ['دخل تاني', 700], ['من الصناديق', 500]]
      );
      // 13,200 in, 12,500 out (9,500 spent + 3,000 gold): 700 is left over.
      assert.equal(flow.nodes.find((n) => n.id === 'dest:surplus')!.value, 700);
      assert.equal(flow.nodes.some((n) => n.id === 'dest:funds'), false);
      assertBalanced(flow);
    });

    it('shows the top 5 categories of a bucket and groups the rest as "تاني"', () => {
      const ids = ['cat-lifestyle-dining', 'cat-lifestyle-clothing', 'cat-lifestyle-entertainment', 'cat-lifestyle-personal-care', 'cat-lifestyle-gadgets', 'cat-lifestyle-misc'];
      const amounts = [600, 500, 400, 300, 200, 100];
      let s: FinanceState = { ...emptyState(), settings: { ...emptyState().settings, trackingStartDate: '2026-08-01' } };
      s = withTx(s, tx('inc', 'income', 'cat-income-salary', 5000, '2026-10-01'), ...ids.map((id, i) => tx(`e${i}`, 'expense', id, amounts[i], '2026-10-02')));
      const q = query(s, 'month');
      const flow = analytics.spendingFlow(s, q);
      const cats = flow.nodes.filter((n) => n.kind === 'category');
      assert.deepEqual(cats.map((n) => [n.label, n.value]), [
        ['مطاعم وقهوة', 600],
        ['ملابس', 500],
        ['ترفيه', 400],
        ['عناية شخصية', 300],
        ['أجهزة وأدوات', 200],
        ['تاني', 100],
      ]);
      assertBalanced(flow);
      // Tapping a node shows exactly the transactions behind it, adding up to its value.
      for (const node of flow.nodes.filter((n) => n.drill)) {
        approx(analytics.drillTransactions(s, q, node.drill!).total, node.value);
      }
      const rest = byId(flow, 'cat:lifestyle:rest')!;
      assert.deepEqual(analytics.drillTransactions(s, q, rest.drill!).transactions.map((t) => t.id), ['e5']);
    });

    it('every tappable node drills into transactions that add up to it', () => {
      const s = ledger();
      for (const q of [query(s, 'month'), query(s, 'sinceStart'), query(s, 'sinceStart', { includeOneTime: false }), query(s, 'month', { currency: 'SAR' })]) {
        const flow = analytics.spendingFlow(s, q);
        assertBalanced(flow);
        for (const node of flow.nodes.filter((n) => n.drill)) {
          approx(analytics.drillTransactions(s, q, node.drill!).total, node.value);
        }
      }
    });

    it('is empty without income or spending, and the currency toggle rescales it', () => {
      assert.equal(analytics.spendingFlow(emptyState(), query(emptyState(), 'month')).empty, true);
      const s = ledger();
      const egp = analytics.spendingFlow(s, query(s, 'month'));
      const sar = analytics.spendingFlow(s, query(s, 'month', { currency: 'SAR' }));
      approx(sar.totalIn, egp.totalIn / 12.5);
      assertBalanced(sar);
    });
  });

  describe('monthly trend', () => {
    it('lists each month with income, spending, net and savings rate', () => {
      const s = ledger();
      const trend = analytics.monthlyTrend(s, query(s, '3m'));
      assert.deepEqual(
        trend.months.map((m) => [m.month, m.income, m.expense, m.net]),
        [
          ['2026-08', 10000, 4500, 5500],
          ['2026-09', 12000, 9500, 2500],
          ['2026-10', 10000, 7150, 2850],
        ]
      );
      approx(trend.months[1].savingsRate, 2500 / 12000);
      approx(trend.averageSavingsRate, (0.55 + 2500 / 12000 + 0.285) / 3);
      assert.equal(trend.monthsWithIncome, 3);
      assert.deepEqual(trend.months.map((m) => m.overspent), [false, false, false]);
    });

    it('follows the one-time toggle and the currency toggle', () => {
      const s = ledger();
      const lean = analytics.monthlyTrend(s, query(s, '3m', { includeOneTime: false }));
      assert.equal(lean.months[1].expense, 5500);
      const sar = analytics.monthlyTrend(s, query(s, '3m', { currency: 'SAR' }));
      approx(sar.months[0].income, 800);
      approx(sar.months[2].expense, 572);
    });

    it('flags months where spending beat income, and has no rate without income', () => {
      const s = withTx(ledger(), tx('big', 'expense', 'cat-lifestyle-gadgets', 9000, '2026-08-20'));
      const trend = analytics.monthlyTrend(s, query(s, '3m'));
      assert.deepEqual(trend.months.map((m) => m.overspent), [true, false, false]);
      const none = analytics.monthlyTrend({ ...emptyState(), settings: { ...emptyState().settings, trackingStartDate: '2026-08-01' } }, query(ledger(), 'month'));
      assert.equal(none.months[0].savingsRate, null);
      assert.equal(none.averageSavingsRate, null);
    });
  });

  describe('spending breakdown', () => {
    it('ranks categories with their share and the change against the previous equal period', () => {
      const s = ledger();
      const b = analytics.spendingBreakdown(s, query(s, 'month'));
      assert.equal(b.total, 7150);
      assert.equal(b.comparable, true);
      assert.equal(b.previousTotal, 9500);
      assert.deepEqual(b.categories.map((c) => c.categoryId), [
        'cat-essentials-rent',
        CATEGORY_IDS.groceries,
        'cat-lifestyle-dining',
        'cat-giving-gifts',
      ]);
      approx(
        b.categories.reduce((t, c) => t + c.pct, 0),
        1
      );
      const row = (id: string) => b.categories.find((c) => c.categoryId === id)!;
      assert.equal(row(CATEGORY_IDS.groceries).previous, 1500);
      approx(row(CATEGORY_IDS.groceries).changePct, 0.6);
      assert.equal(row(CATEGORY_IDS.groceries).direction, 'up');
      approx(row('cat-lifestyle-dining').changePct, 550 / 1000);
      assert.equal(row('cat-essentials-rent').direction, 'flat');
      assert.equal(row('cat-giving-gifts').isNew, true);
      assert.equal(row('cat-giving-gifts').changePct, null);
      // Spending that fell is a "down".
      const cut = analytics.spendingBreakdown(
        { ...s, transactions: s.transactions.map((t) => (t.id === 'c3' ? { ...t, amount: 750 } : t)) },
        query(s, 'month')
      );
      assert.equal(cut.categories.find((c) => c.categoryId === CATEGORY_IDS.groceries)!.direction, 'down');
    });

    it('splits by bucket, and has nothing to compare with when the previous period was before tracking', () => {
      const s = ledger();
      const b = analytics.spendingBreakdown(s, query(s, '3m'));
      assert.equal(b.comparable, false);
      assert.equal(b.previousTotal, null);
      assert.equal(b.categories.every((c) => c.previous === null && c.direction === null), true);
      assert.deepEqual(
        analytics.spendingBreakdown(s, query(s, 'month')).buckets.map((x) => [x.bucket, x.amount]),
        [['essentials', 5400], ['lifestyle', 1550], ['giving', 200]]
      );
    });

    it('comparison follows the one-time toggle on both periods', () => {
      const s = ledger();
      const lean = analytics.spendingBreakdown(s, query(s, 'month', { includeOneTime: false }));
      assert.equal(lean.previousTotal, 5500);
    });
  });

  describe('net worth over time', () => {
    const zero = { cashEGP: 0, goldEGP: 0, currenciesEGP: 0 };
    const snap = (month: string, extra: Partial<import('@/store/types').NetWorthSnapshot>): import('@/store/types').NetWorthSnapshot => ({
      id: `nw-${month}`,
      month,
      netWorthEGP: 0,
      liquidEGP: 0,
      holdingsEGP: 0,
      takenAt: T0,
      updatedAt: T0,
      ...extra,
    });
    const state = (): FinanceState => ({
      ...emptyState(),
      accounts: [account('egp', 'EGP', 50000)],
      netWorthSnapshots: [
        snap('2026-07', { netWorthEGP: 120000 }), // recorded before breakdowns existed
        snap('2026-08', {
          estimated: true,
          netWorthEGP: 125000,
          ratesSnapshot: { SAR_EGP: 12.5, USD_EGP: 50 },
          breakdown: { EG: { ...zero, cashEGP: 100000 }, SA: { ...zero, cashEGP: 25000 }, liabilitiesEGP: 0 },
        }),
        snap('2026-09', {
          netWorthEGP: 131000,
          ratesSnapshot: { SAR_EGP: 13, USD_EGP: 50 },
          breakdown: { EG: { cashEGP: 110000, goldEGP: 5000, currenciesEGP: 0 }, SA: { ...zero, cashEGP: 26000 }, liabilitiesEGP: 10000 },
        }),
      ],
    });
    const series = (s: FinanceState, location: analytics.NetWorthLocation, currency: analytics.DisplayCurrency = 'EGP', includeEstimated = true) =>
      analytics.netWorthSeries(s, { location, currency, includeEstimated, now: NOW });

    it('all: one point per snapshot plus today, with cash / gold / currencies and the total after liabilities', () => {
      const result = series(state(), 'all');
      assert.deepEqual(result.points.map((p) => [p.month, p.estimated, p.live]), [
        ['2026-07', false, false],
        ['2026-08', true, false],
        ['2026-09', false, false],
        ['2026-10', false, true],
      ]);
      const [jul, aug, sep, oct] = result.points;
      assert.equal(jul.total, 120000); // total only
      assert.deepEqual([aug.cash, aug.gold, aug.currencies, aug.total], [125000, 0, 0, 125000]);
      assert.deepEqual([sep.cash, sep.gold, sep.currencies, sep.total], [136000, 5000, 0, 131000]);
      assert.equal(oct.total, netWorthEGP(state()));
      assert.equal(result.estimatedCount, 1);
    });

    it('by location: Egypt carries the liabilities, Saudi doesn’t, and snapshots without a breakdown are skipped', () => {
      const eg = series(state(), 'EG');
      assert.equal(eg.skipped, 1);
      assert.deepEqual(eg.points.slice(0, 2).map((p) => p.total), [100000, 105000]);
      const sa = series(state(), 'SA');
      assert.deepEqual(sa.points.slice(0, 2).map((p) => p.total), [25000, 26000]);
      // Egypt + Saudi is everything.
      assert.equal(eg.points[1].total + sa.points[1].total, 131000);
    });

    it('estimated points can be hidden', () => {
      const result = series(state(), 'all', 'EGP', false);
      assert.deepEqual(result.points.map((p) => p.month), ['2026-07', '2026-09', '2026-10']);
      assert.equal(result.estimatedCount, 0);
    });

    it('in SAR each point uses the rates it was valued at; today’s for the current month', () => {
      const result = series(state(), 'all', 'SAR');
      approx(result.points[1].total, 125000 / 12.5);
      approx(result.points[2].total, 131000 / 13);
      approx(result.points[3].total, netWorthEGP(state()) / 12.5);
      // A snapshot that kept no rates falls back to today's.
      approx(result.points[0].total, 120000 / 12.5);
      // Changing today's rate leaves the recorded points alone.
      const moved = series(at(state(), 20), 'all', 'SAR');
      approx(moved.points[1].total, 125000 / 12.5);
      approx(moved.points[2].total, 131000 / 13);
    });
  });

  describe('money map', () => {
    const mapState = (): FinanceState => ({
      ...emptyState(),
      accounts: [account('egp', 'EGP', 5000), account('sar', 'SAR', 1000, 'SA')],
      holdings: [
        { id: 'g21', type: 'gold', name: 'a', weightGrams: 10, karat: 21, purchaseCostEGP: 50000, location: 'EG', updatedAt: T0 },
        { id: 'g24', type: 'gold', name: 'b', weightGrams: 5, karat: 24, purchaseCostEGP: 28000, location: 'EG', updatedAt: T0 },
        { id: 'fx', type: 'currency', name: 'ريال', currency: 'SAR', quantity: 200, purchaseCostEGP: 2400, location: 'SA', updatedAt: T0 },
      ],
    });

    it('liquid money by currency (native + value), by location, and gold by karat', () => {
      const m = analytics.moneyMap(mapState(), 'EGP');
      assert.deepEqual(m.liquid.map((l) => [l.currency, l.native, l.valueEGP, l.value]), [
        ['EGP', 5000, 5000, 5000],
        ['SAR', 1000, 12500, 12500],
      ]);
      assert.equal(m.liquidTotal, 17500);
      assert.deepEqual(m.byLocation.map((l) => [l.location, l.cash, l.gold, l.currencies, l.total]), [
        ['EG', 5000, 82500, 0, 87500],
        ['SA', 12500, 0, 2500, 15000],
      ]);
      // 24k first: 5 g × 6,000 and 10 g × 5,250.
      assert.deepEqual(m.gold.rows.map((r) => [r.karat, r.grams, r.value, r.cost, r.pnl]), [
        [24, 5, 30000, 28000, 2000],
        [21, 10, 52500, 50000, 2500],
      ]);
      assert.deepEqual([m.gold.grams, m.gold.value, m.gold.cost, m.gold.pnl], [15, 82500, 78000, 4500]);
      approx(m.goldShare, 82500 / 102500);
    });

    it('SAR display: native amounts stay, values follow today’s rate', () => {
      const m = analytics.moneyMap(mapState(), 'SAR');
      assert.equal(m.liquid[1].native, 1000);
      assert.equal(m.liquid[1].value, 1000);
      assert.equal(m.liquid[0].value, 400);
      assert.equal(m.gold.value, 82500 / 12.5);
      const later = analytics.moneyMap(at(mapState(), 15), 'EGP');
      assert.equal(later.liquid[1].native, 1000);
      assert.equal(later.liquid[1].valueEGP, 15000);
    });
  });

  describe('runway', () => {
    it('months the money lasts at the average essentials of the last completed months, one-time excluded', () => {
      const s = ledger();
      const r = analytics.runway(s, 'EGP', NOW);
      // Aug 4,000 and Sep 4,500 (the 4,000 sofa is one-time); July is before tracking.
      assert.equal(r.monthsObserved, 2);
      assert.equal(r.avgEssentials, 4250);
      approx(r.liquid.months, liquidTotalEGP(s) / 4250);
      approx(r.unassigned.months, Math.max(0, unassignedEGP(s)) / 4250);
      approx(r.liquid.amount, liquidTotalEGP(s));
    });

    it('per currency: native money against the essentials spent in that currency', () => {
      const s = ledger();
      const r = analytics.runway(s, 'EGP', NOW);
      const egp = r.perCurrency.find((c) => c.currency === 'EGP')!;
      const sar = r.perCurrency.find((c) => c.currency === 'SAR')!;
      assert.equal(egp.avgEssentials, 4250);
      approx(egp.liquidMonths, egp.liquid / 4250);
      // No SAR essentials were recorded, so there is nothing to divide by.
      assert.equal(sar.avgEssentials, 0);
      assert.equal(sar.liquidMonths, null);
      assert.equal(sar.liquid, accountBalance(s, 'sar'));
    });

    it('SAR display converts the average as recorded and the money at today’s rate', () => {
      const s = ledger();
      const r = analytics.runway(s, 'SAR', NOW);
      approx(r.avgEssentials, 4250 / 12.5);
      approx(r.liquid.amount, liquidTotalEGP(s) / 12.5);
      const moved = analytics.runway(at(s, 25), 'SAR', NOW);
      approx(moved.avgEssentials, 4250 / 12.5); // history unchanged
    });

    it('needs a completed month of essentials', () => {
      const s = withTx({ ...emptyState(), accounts: [account('egp', 'EGP', 9000)], settings: { ...emptyState().settings, trackingStartDate: '2026-10-01' } }, tx('only', 'expense', 'cat-essentials-rent', 3000, '2026-10-03'));
      const r = analytics.runway(s, 'EGP', NOW);
      assert.equal(r.monthsObserved, 0);
      assert.equal(r.liquid.months, null);
      assert.equal(r.unassigned.months, null);
    });
  });

  describe('funds', () => {
    it('projects completion at the average pace of the last completed months', () => {
      const f = analytics.fundsProjection(ledger(), NOW).find((p) => p.fundId === 'F')!;
      assert.equal(f.current, 3000);
      assert.equal(f.pace, 1000); // Aug and Sep, 1,000 each
      assert.equal(f.status, 'projected');
      assert.equal(f.projectedDate, '2028-03-15'); // 17 more months from 15 Oct 2026
      approx(f.pct, 0.15);
      assert.deepEqual(f.cashByCurrency, { EGP: 3000, SAR: 0, USD: 0 });
    });

    it('a fund with no pace never finishes; a finished one says so; a new one is judged on this month', () => {
      const s: FinanceState = {
        ...ledger(),
        funds: [
          fund({ id: 'F', targetAmount: 20000, priority: 1 }),
          fund({ id: 'stuck', targetAmount: 5000, priority: 2 }),
          fund({ id: 'done', targetAmount: 1000, priority: 3 }),
          fund({ id: 'fresh', targetAmount: 3000, priority: 4 }),
        ],
        fundMovements: [
          ...ledger().fundMovements,
          movement('d1', 'done', 1000, '2026-09-01'),
          movement('n1', 'fresh', 500, '2026-10-02'),
          // Stuck once had money, then gave it back.
          movement('s1', 'stuck', 800, '2026-08-02'),
          movement('s2', 'stuck', -800, '2026-09-02'),
        ],
      };
      const by = (id: string) => analytics.fundsProjection(s, NOW).find((p) => p.fundId === id)!;
      assert.equal(by('stuck').status, 'stalled');
      assert.equal(by('stuck').projectedDate, null);
      assert.equal(by('done').status, 'completed');
      assert.equal(by('done').projectedDate, null);
      assert.equal(by('fresh').pace, 500);
      assert.equal(by('fresh').projectedDate, '2027-03-15'); // 2,500 left ÷ 500 = 5 months
    });

    it('shows cash by currency, linked gold, and whether it will miss its deadline', () => {
      let s: FinanceState = {
        ...emptyState(),
        accounts: [account('egp', 'EGP', 10000), account('sar', 'SAR', 1000, 'SA')],
        holdings: [{ id: 'g1', type: 'gold', name: 'g', weightGrams: 1, karat: 24, purchaseCostEGP: 5000, updatedAt: T0 }],
        funds: [fund({ id: 'G', targetAmount: 100000, deadline: '2027-01-31', linkedHoldingIds: ['g1'] })],
        fundMovements: [
          movement('a', 'G', 1000, '2026-08-05'),
          movement('b', 'G', 100, '2026-09-05', { currency: 'SAR' }),
        ],
      };
      s = at(s, 12.5);
      const p = analytics.fundsProjection(s, NOW)[0];
      assert.deepEqual(p.cashByCurrency, { EGP: 1000, SAR: 100, USD: 0 });
      assert.equal(p.linkedValue, 6000);
      // 1,000 + 100 SAR (1,250) + the gold's 6,000 now; the pace comes from the cash movements.
      assert.equal(p.current, 8250);
      assert.equal(p.status, 'projected');
      assert.equal(p.lateVsDue, true);
      assert.equal(p.dueDate, '2027-01-31');
    });
  });

  describe('insights', () => {
    const ids = (list: analytics.Insight[]) => list.map((i) => i.id);

    it('biggest category increase and a savings rate below your average', () => {
      const s = ledger();
      const list = analytics.insights(s, query(s, 'month'), NOW);
      assert.deepEqual(ids(list), ['category-increase', 'savings-rate']);
      const increase = list[0];
      assert.ok(increase.text.includes('أكل وبقالة'));
      assert.equal(increase.tone, 'attention');
      assert.deepEqual(increase.target, { type: 'drill', filter: { type: 'expense', categoryIds: [CATEGORY_IDS.groceries] } });
      assert.ok(list[1].text.includes('أقل من متوسطك'));
      assert.deepEqual(list[1].target, { type: 'trend' });
    });

    it('a savings rate above your average is good news', () => {
      const s = ledger();
      const better = withTx(s, tx('bonus', 'income', CATEGORY_IDS.otherIncome, 6000, '2026-10-14'));
      const list = analytics.insights(better, query(better, 'month'), NOW);
      const rate = list.find((i) => i.id === 'savings-rate')!;
      assert.equal(rate.tone, 'ok');
      assert.ok(rate.text.includes('أعلى من متوسطك'));
    });

    it('one-time spending in the period, even when the toggle leaves it out of the totals', () => {
      const s = ledger();
      const q = { period: { kind: 'custom' as const, from: '2026-09-01', to: '2026-09-30' }, currency: 'EGP' as const, includeOneTime: false };
      const list = analytics.insights(s, q, NOW);
      const oneTime = list.find((i) => i.id === 'one-time')!;
      assert.ok(oneTime);
      assert.deepEqual(oneTime.target, { type: 'drill', filter: { type: 'expense', oneTimeOnly: true } });
      // 4,000 of 9,500 in all.
      assert.ok(oneTime.text.includes('4,000'));
      assert.equal(analytics.insights(s, query(s, 'month'), NOW).some((i) => i.id === 'one-time'), false);
    });

    it('months where spending beat income', () => {
      const s = withTx(ledger(), tx('big', 'expense', 'cat-lifestyle-gadgets', 9000, '2026-08-20'));
      const over = analytics.insights(s, query(s, '3m'), NOW).find((i) => i.id === 'overspent-months')!;
      assert.ok(over);
      assert.ok(over.text.includes('أغسطس'));
      assert.deepEqual(over.target, { type: 'trend' });
      assert.equal(analytics.insights(ledger(), query(ledger(), '3m'), NOW).some((i) => i.id === 'overspent-months'), false);
    });

    it('a fund that is behind schedule, and gold as a large share of net worth', () => {
      const s: FinanceState = {
        ...ledger(),
        funds: [...ledger().funds, fund({ id: 'late', name: 'جواز', targetAmount: 60000, deadline: '2027-03-31', priority: 2 })],
        holdings: [{ id: 'g1', type: 'gold', name: 'g', weightGrams: 100, karat: 24, purchaseCostEGP: 500000, updatedAt: T0 }],
      };
      const list = analytics.insights(s, query(s, 'month'), OCT_26);
      const behind = list.find((i) => i.id === 'fund-behind')!;
      assert.ok(behind.text.includes('جواز'));
      assert.deepEqual(behind.target, { type: 'fund', fundId: 'late' });
      const share = list.find((i) => i.id === 'gold-share')!;
      assert.ok(share);
      assert.deepEqual(share.target, { type: 'assets' });
      // Mid-month the fund is only "pending".
      assert.equal(analytics.insights(s, query(s, 'month'), NOW).some((i) => i.id === 'fund-behind'), false);
    });

    it('shows at most 5, most important first', () => {
      const base = ledger();
      const s: FinanceState = {
        ...base,
        funds: [...base.funds, fund({ id: 'late', name: 'جواز', targetAmount: 60000, deadline: '2027-03-31', priority: 2 })],
        holdings: [{ id: 'g1', type: 'gold', name: 'g', weightGrams: 100, karat: 24, purchaseCostEGP: 500000, updatedAt: T0 }],
        // A big one-time purchase in October: spending beats income and it dominates.
        transactions: [...base.transactions, tx('huge', 'expense', 'cat-essentials-home-setup', 5000, '2026-10-14', { oneTime: true })],
      };
      const list = analytics.insights(s, query(s, 'month'), OCT_26);
      assert.equal(list.length, analytics.MAX_INSIGHTS);
      assert.deepEqual(ids(list), ['category-increase', 'savings-rate', 'one-time', 'fund-behind', 'overspent-months']);
    });

    it('has nothing to say about a quiet period', () => {
      const s = withTx({ ...emptyState(), settings: { ...emptyState().settings, trackingStartDate: '2026-08-01' } }, tx('i', 'income', 'cat-income-salary', 1000, '2026-10-01'));
      assert.deepEqual(analytics.insights(s, query(s, 'month'), NOW), []);
    });
  });

  describe('drill-down', () => {
    it('lists the transactions behind a filter, newest first, with their total', () => {
      const s = ledger();
      const q = query(s, 'sinceStart');
      const dining = analytics.drillTransactions(s, q, { type: 'expense', categoryIds: ['cat-lifestyle-dining'] });
      assert.deepEqual(dining.transactions.map((t) => t.id), ['c4', 'c5', 'b5', 'a4']);
      assert.equal(dining.total, 300 + 1250 + 1000 + 500);
      assert.deepEqual(analytics.drillTransactions(s, q, { type: 'asset_purchase' }).transactions.map((t) => t.id), ['b7']);
      assert.deepEqual(analytics.drillTransactions(s, q, { type: 'expense', oneTimeOnly: true }).transactions.map((t) => t.id), ['b6']);
      // The toggle hides one-time expenses from a plain bucket list.
      const lean = analytics.drillTransactions(s, { ...q, includeOneTime: false }, { type: 'expense', bucket: 'essentials' });
      assert.equal(lean.transactions.some((t) => t.id === 'b6'), false);
      // Transfers never show up.
      assert.equal(analytics.drillTransactions(s, q, { type: 'expense' }).transactions.some((t) => t.id === 'b8'), false);
    });

    it('round-trips through route params and rejects bad ones', () => {
      const s = ledger();
      const q = query(s, 'month', { currency: 'SAR', includeOneTime: false });
      const filter: analytics.DrillFilter = { type: 'expense', bucket: 'lifestyle', excludeCategoryIds: ['a', 'b'], oneTimeOnly: true };
      const parsed = analytics.parseDrillParams(analytics.drillParams(q, filter))!;
      assert.deepEqual(parsed.filter, filter);
      assert.equal(parsed.query.currency, 'SAR');
      assert.equal(parsed.query.includeOneTime, false);
      assert.deepEqual([parsed.query.period.from, parsed.query.period.to], ['2026-10-01', '2026-10-31']);
      assert.equal(analytics.parseDrillParams({}), null);
      assert.equal(analytics.parseDrillParams({ ...analytics.drillParams(q, filter), type: 'transfer' }), null);
      assert.equal(analytics.parseDrillParams({ ...analytics.drillParams(q, filter), currency: 'USD' }), null);
      assert.equal(analytics.parseDrillParams({ ...analytics.drillParams(q, filter), from: '2026-12-01' }), null);
      assert.equal(analytics.parseDrillParams({ ...analytics.drillParams(q, filter), from: 'x' }), null);
    });

    it('describes what is being listed', () => {
      const s = ledger();
      assert.equal(analytics.describeFilter(s, { type: 'expense', categoryIds: [CATEGORY_IDS.groceries] }), 'أكل وبقالة');
      assert.equal(analytics.describeFilter(s, { type: 'expense', bucket: 'giving' }), 'عطاء');
      assert.equal(analytics.describeFilter(s, { type: 'asset_purchase' }), 'شراء ذهب');
      assert.equal(analytics.describeFilter(s, { type: 'income', excludeCategoryIds: ['x'] }), 'دخل تاني');
    });
  });

  describe('snapshots keep the breakdown analytics needs', () => {
    it('new snapshots carry the breakdown and the rates, and old estimates are rebuilt with them', () => {
      const s: FinanceState = {
        ...emptyState(),
        accounts: [account('egp', 'EGP', 1000), account('sar', 'SAR', 100, 'SA')],
        holdings: [{ id: 'g', type: 'gold', name: 'g', weightGrams: 1, karat: 24, purchaseCostEGP: 1, updatedAt: T0 }],
        settings: { ...emptyState().settings, trackingStartDate: '2026-08-01' },
      };
      const list = snapshots.syncedSnapshots(s, NOW)!;
      const oct = list.at(-1)!;
      assert.deepEqual(oct.breakdown, {
        EG: { cashEGP: 1000, goldEGP: 6000, currenciesEGP: 0 },
        SA: { cashEGP: 1250, goldEGP: 0, currenciesEGP: 0 },
        liabilitiesEGP: 0,
      });
      assert.deepEqual(oct.ratesSnapshot, { SAR_EGP: 12.5, USD_EGP: 50 });
      assert.ok(list.every((p) => p.breakdown && p.ratesSnapshot));
      assert.equal(snapshots.syncedSnapshots({ ...s, netWorthSnapshots: list }, NOW), null);

      // Snapshots from before: an estimate is worked out again, a recorded one is left alone.
      const old = list.map(({ breakdown: _b, ratesSnapshot: _r, ...rest }) => rest);
      const upgraded = snapshots.syncedSnapshots({ ...s, netWorthSnapshots: old.map((p) => (p.month === '2026-09' ? { ...p, estimated: undefined, netWorthEGP: 42 } : p)) }, NOW)!;
      assert.equal(upgraded.find((p) => p.month === '2026-08')!.breakdown!.SA.cashEGP, 1250);
      const kept = upgraded.find((p) => p.month === '2026-09')!;
      assert.equal(kept.netWorthEGP, 42);
      assert.equal(kept.breakdown, undefined);
    });
  });
});

// --- Analytics UI helpers ----------------------------------------------------------------

describe('analytics UI helpers', () => {
  it('formats chart numbers compactly', () => {
    assert.deepEqual([950, 1000, 1500, 9990, 12400, 999999, 1250000, -2500].map(analyticsUi.compactNumber), [
      '950',
      '1k',
      '1.5k',
      '10k',
      '12k',
      '1000k',
      '1.3M',
      '−2.5k',
    ]);
  });

  it('picks a round axis step and handles negative values', () => {
    assert.equal(analyticsUi.niceStep(48000, 4), 20000);
    assert.equal(analyticsUi.niceStep(10, 4), 2.5);
    assert.equal(analyticsUi.niceStep(0, 4), 1);
    assert.deepEqual(analyticsUi.chartAxis(0, 48000), { step: 20000, above: 3, below: 0 });
    assert.deepEqual(analyticsUi.chartAxis(-3000, 10000), { step: 2500, above: 4, below: 2 });
  });

  it('words runway, change and projection', () => {
    assert.equal(analyticsUi.runwayPhrase(null), '—');
    assert.equal(analyticsUi.runwayPhrase(0.4), 'أقل من شهر');
    assert.equal(analyticsUi.runwayPhrase(2), 'شهرين');
    assert.equal(analyticsUi.runwayPhrase(3.04), '3 شهور');
    assert.equal(analyticsUi.runwayPhrase(3.46), '3.5 شهر');
    assert.equal(analyticsUi.runwayPhrase(14), '14 شهر');
    assert.equal(analyticsUi.runwayPhrase(500), 'أكتر من 10 سنين');
    assert.deepEqual(analyticsUi.changeText({ direction: 'up', changePct: 0.6, isNew: false }), { text: '↑ ⁦‎60%⁩', color: 'warning' });
    assert.deepEqual(analyticsUi.changeText({ direction: 'down', changePct: -0.25, isNew: false }), { text: '↓ ⁦‎25%⁩', color: 'primary700' });
    assert.equal(analyticsUi.changeText({ direction: 'up', changePct: null, isNew: true })!.text, 'جديد');
    assert.equal(analyticsUi.changeText({ direction: 'flat', changePct: 0, isNew: false })!.text, '–');
    assert.equal(analyticsUi.changeText({ direction: null, changePct: null, isNew: false }), null);
    assert.equal(analyticsUi.projectionPhrase({ status: 'stalled', projectedDate: null, lateVsDue: false }), 'مش هيخلص بالمعدل ده');
    assert.equal(analyticsUi.projectionPhrase({ status: 'completed', projectedDate: null, lateVsDue: false }), 'وصل للهدف');
    assert.ok(analyticsUi.projectionPhrase({ status: 'projected', projectedDate: '2028-03-15', lateVsDue: false }).startsWith('هيخلص حوالي مارس'));
    assert.ok(analyticsUi.projectionPhrase({ status: 'projected', projectedDate: '2028-03-15', lateVsDue: true }).endsWith('بعد الموعد'));
    assert.equal(analyticsUi.truncateLabel('مساعدة الأهل في الشهر', 10), 'مساعدة ال…');
    assert.equal(analyticsUi.truncateLabel('صدقة', 10), 'صدقة');
  });

  it('labels the periods', () => {
    assert.equal(analyticsUi.periodLabel({ kind: 'month', from: '2026-10-01', to: '2026-10-31' }), 'أكتوبر ٢٠٢٦');
    assert.equal(analyticsUi.periodLabel({ kind: '3m', from: '2026-08-01', to: '2026-10-31' }), 'أغسطس ٢٠٢٦ – أكتوبر ٢٠٢٦');
    assert.ok(analyticsUi.periodLabel({ kind: 'custom', from: '2026-08-05', to: '2026-08-14' }).includes('–'));
    assert.deepEqual(analyticsUi.PERIOD_OPTIONS.map((o) => o.value), ['month', '3m', '6m', 'year', 'sinceStart', 'custom']);
  });

  it('the narrow-screen stacked bar covers where the money went, not the categories', () => {
    const flow: analytics.SpendingFlow = {
      nodes: [
        { id: 's', label: 'راتب', kind: 'source', value: 100, group: 'income', drill: null },
        { id: 'b', label: 'أساسيات', kind: 'bucket', value: 60, group: 'essentials', drill: null },
        { id: 'l', label: 'فايض', kind: 'leaf', value: 40, group: 'surplus', drill: null },
        { id: 'c', label: 'إيجار', kind: 'category', value: 60, group: 'essentials', drill: null },
      ],
      links: [],
      totalIn: 100,
      totalOut: 100,
      empty: false,
    };
    const segments = analyticsUi.stackedFlowSegments(flow);
    assert.deepEqual(segments.map((s) => [s.node.id, s.pct]), [['b', 0.6], ['l', 0.4]]);
    assert.deepEqual(analyticsUi.stackedFlowSegments({ ...flow, nodes: [] }), []);
  });

  it('lays the Sankey out right to left, inside its frame, with ribbons from source to target', () => {
    const state: FinanceState = {
      ...emptyState(),
      settings: { ...emptyState().settings, trackingStartDate: '2026-08-01' },
      transactions: [
        { id: 'i', type: 'income', amount: 10000, currency: 'EGP', accountId: 'a', categoryId: 'cat-income-salary', date: '2026-10-02', rateToEGP: 1, createdAt: T0, updatedAt: T0 },
        { id: 'e1', type: 'expense', amount: 3000, currency: 'EGP', accountId: 'a', categoryId: 'cat-essentials-rent', date: '2026-10-03', rateToEGP: 1, createdAt: T0, updatedAt: T0 },
        { id: 'e2', type: 'expense', amount: 1000, currency: 'EGP', accountId: 'a', categoryId: 'cat-lifestyle-dining', date: '2026-10-04', rateToEGP: 1, createdAt: T0, updatedAt: T0 },
      ] as Transaction[],
    };
    const flow = analytics.spendingFlow(state, { period: analytics.resolvePeriod(state, 'month', NOW), currency: 'EGP', includeOneTime: true });
    const margins = { left: 100, right: 70, top: 8, bottom: 8 };
    const layout = sankeyLayout.layoutSankey(flow, 340, 300, margins);
    const x = (id: string) => layout.nodes.find((n) => n.node.id === id)!;
    // Money comes in on the right and flows left.
    assert.ok(x('src:salary').x0 > x('bucket:essentials').x0);
    assert.ok(x('bucket:essentials').x0 > x('cat:essentials:cat-essentials-rent').x0);
    assert.deepEqual(layout.nodes.map((n) => n.column).sort(), [0, 1, 1, 1, 2, 2]);
    for (const n of layout.nodes) {
      // Mirrored: the layout's right margin is the left room (for category labels).
      assert.ok(n.x0 >= margins.right - 0.5 && n.x1 <= 340 - margins.left + 0.5, n.node.id);
      assert.ok(n.y0 >= margins.top - 0.5 && n.y1 <= 300 - margins.bottom + 0.5, n.node.id);
    }
    assert.equal(layout.links.length, flow.links.length);
    for (const l of layout.links) {
      assert.ok(l.path.startsWith(`M${l.source.x0},`));
      // It ends on the target's right edge.
      assert.ok(l.path.includes(` ${l.target.x1},`));
      assert.ok(l.width >= 1);
    }
    // A bigger flow gets a thicker node (same scale across columns).
    const height = (id: string) => x(id).y1 - x(id).y0;
    assert.ok(height('bucket:essentials') > height('bucket:lifestyle'));
    approx(height('src:salary') / 10000, height('bucket:essentials') / 3000);
  });
});
