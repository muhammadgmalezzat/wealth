import { formatDateAr } from '@/components/ui/formatDateAr';
import { formatMoney } from '@/components/ui/formatMoney';
import { planSpend, reservationsOn, type ExpenseContext, type ExpenseSplitProblem } from '@/store/cover';
import { fundCurrent, fundProgressAmount, fundPurchases, fundSpent, reservation, spendOf } from '@/store/selectors';
import type { CurrencyCode, FinanceState, Fund, Transaction } from '@/store/types';

// Pure helpers for fund spending and achieved goals (FUND_SPEND_AND_GOALS_DESIGN.md §5): the expense sheet's
// «من صندوق», the «تدفعه منين؟» cover sheet, «تم الهدف 🎉», «أهداف اتحققت». No React Native: unit-tested.

const fundName = (state: Pick<FinanceState, 'funds'>, id: string) => state.funds.find((f) => f.id === id)?.name.trim() ?? '—';

// --- «من صندوق» on the expense sheet (§5.1, AC-1) ---------------------------------------------------------------

// The funds that hold money on `accountId` (lowest priority first, as a cover takes them), with their names: the
// picker's chips. Empty → the picker is hidden.
export function spendChoices(state: FinanceState, accountId: string): { fundId: string; name: string; amount: number }[] {
  return reservationsOn(state, accountId).map((r) => ({ ...r, name: fundName(state, r.fundId) }));
}

// The state an EDIT is measured against: the expense's own fund spending given back (what the operation does first).
export function withoutSpends(state: FinanceState, transactionId: string | undefined): FinanceState {
  if (!transactionId) return state;
  const ids = new Set(spendOf(state, transactionId).map((m) => m.id));
  return ids.size === 0 ? state : { ...state, reservationMovements: state.reservationMovements.filter((m) => !ids.has(m.id)) };
}

// The live line under the picker. `base`: the state without this expense's old spending (withoutSpends).
export function spendLine(base: FinanceState, fundId: string, accountId: string, amount: number | null, currency: CurrencyCode): string {
  const name = fundName(base, fundId);
  const held = reservation(base, fundId, accountId);
  if (held <= 0.005) return `«${name}» مالوش فلوس في الحساب ده؛ المصروف هيتدفع من الفلوس الحرة.`;
  if (amount === null || !(amount > 0)) return `هيتصرف من «${name}» (فيه ${formatMoney(held, currency)} في الحساب ده).`;
  const fromFund = planSpend(base, fundId, accountId, amount);
  const rest = Math.round((amount - fromFund) * 100) / 100;
  return rest <= 0.005
    ? `هيتصرف ${formatMoney(fromFund, currency)} من «${name}»، وفلوسك الحرة مش هتتلمس.`
    : `${formatMoney(fromFund, currency)} من «${name}» (كل اللي فيه) و ${formatMoney(rest, currency)} من الفلوس الحرة.`;
}

// The funds an expense spent from, for the row chip «من صندوق: …» and the delete confirmation.
export function spendNames(state: FinanceState, tx: Transaction): string[] {
  return [...new Set(spendOf(state, tx.id).map((m) => fundName(state, m.fundId)))];
}

export function spendTotal(state: Pick<FinanceState, 'reservationMovements'>, tx: Transaction): number {
  return Math.round(spendOf(state, tx.id).reduce((sum, m) => sum - m.amount, 0) * 100) / 100;
}

// --- «تدفعه منين؟» (§5.2) ---------------------------------------------------------------------------------------

export function splitProblemText(problem: ExpenseSplitProblem, context: ExpenseContext, currency: CurrencyCode): string {
  switch (problem) {
    case 'NOTHING_CHOSEN':
      return 'اختار واحدة من الطريقتين.';
    case 'BELOW_MIN':
      return `الفلوس الحرة مش كفاية: لازم ياخد من الصناديق ${formatMoney(context.minFromFunds, currency)} على الأقل.`;
    case 'ABOVE_MAX':
      return `أكتر من المصروف أو من اللي في الصناديق (${formatMoney(context.maxFromFunds, currency)}).`;
    case 'OVER_FUND':
      return 'الصندوق مفيهوش المبلغ ده في الحساب ده.';
    case 'NOT_EXACT':
      return `الصناديق المختارة مش كفاية: لازم تغطي ${formatMoney(context.minFromFunds, currency)} بالظبط.`;
    case 'NOT_POSITIVE':
      return 'اكتب مبلغ أكبر من صفر.';
  }
}

// «من الفلوس الحرة الأول» over the funds the user ticked: exactly the shortfall, lowest priority first among them.
export function coverPicks(context: ExpenseContext, allowed: string[]): { fundId: string; amount: number }[] {
  const picks: { fundId: string; amount: number }[] = [];
  let left = context.minFromFunds;
  for (const f of context.funds) {
    if (left <= 0.005) break;
    if (!allowed.includes(f.fundId)) continue;
    const take = Math.min(left, f.amount);
    picks.push({ fundId: f.fundId, amount: Math.round(take * 100) / 100 });
    left = Math.round((left - take) * 100) / 100;
  }
  return picks;
}

// --- Goals: progress, «تم الهدف 🎉», «أهداف اتحققت» (§5.3, §5.4) ----------------------------------------------------

// What a goal shows: progress amount (held + spent), and the two parts when it spent something.
export function goalFigures(state: FinanceState, fund: Fund): { shown: number; held: number; spent: number } {
  const held = fundCurrent(state, fund.id);
  if (fund.type !== 'goal') return { shown: held, held, spent: 0 };
  return { shown: fundProgressAmount(state, fund.id), held, spent: fundSpent(state, fund.id) };
}

// «اتصرف منه ج.م 6,000 · لسه فيه ج.م 500»; null when nothing was spent.
export function goalSpentLine(state: FinanceState, fund: Fund): string | null {
  const { held, spent } = goalFigures(state, fund);
  return spent > 0.005 ? `اتصرف منه ${formatMoney(spent, fund.currency)} · لسه فيه ${formatMoney(held, fund.currency)}` : null;
}

// What is still reserved per account (the leftover of an achieved goal, or before achieving it).
export function leftoverByAccount(state: FinanceState, fundId: string): { accountId: string; name: string; currency: CurrencyCode; amount: number }[] {
  return state.accounts
    .map((a) => ({ accountId: a.id, name: a.name, currency: a.currency, amount: reservation(state, fundId, a.id) }))
    .filter((x) => x.amount > 0.005);
}

// The «مبروك! 🎉» sheet's lines.
export function achieveSummary(state: FinanceState, fund: Fund): { targetLine: string; leftover: ReturnType<typeof leftoverByAccount> } {
  const spent = fundSpent(state, fund.id);
  const n = fundPurchases(state, fund.id).length;
  const count = n === 0 ? '' : n === 1 ? ' (مصروف واحد)' : n === 2 ? ' (مصروفين)' : ` (${n} مصروفات)`;
  return {
    targetLine: `الهدف ${formatMoney(fund.targetAmount, fund.currency)} · اتصرف عليه ${formatMoney(spent, fund.currency)}${count}`,
    leftover: leftoverByAccount(state, fund.id),
  };
}

// A row of «أهداف اتحققت»: «اتحقق ٢٠ نوفمبر · اتصرف ج.م 6,000 من ج.م 6,000».
export function achievedLine(state: FinanceState, fund: Fund): string {
  // The full ISO time, so the date is the local day it was confirmed on.
  return `اتحقق ${formatDateAr(fund.achievedAt!, { year: false })} · اتصرف ${formatMoney(fundSpent(state, fund.id), fund.currency)} من ${formatMoney(fund.targetAmount, fund.currency)}`;
}
