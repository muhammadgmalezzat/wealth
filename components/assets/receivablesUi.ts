import { formatMoney } from '@/components/ui/formatMoney';
import { formatDateAr } from '@/components/ui/formatDateAr';
import type { AmountHint } from '@/components/ui/AmountInput';
import type { StatusTone } from '@/components/ui/StatusChip';
import { currencyNameAr } from '@/constants/currencies';
import {
  receivableCollected,
  receivableOverdue,
  receivableRemaining,
  receivableStatus,
  type FundAmount,
} from '@/store/selectors';
import type { CurrencyCode, FinanceState, Receivable } from '@/store/types';
import { shiftMonth, toMonthKey } from '@/utils/dates';
import { formatMonthLabel } from '@/utils/formatters';

// Pure helpers for the receivables UI («غير محصّل»: Assets section, ReceivableSheet, CollectSheet). No React
// Native, so they are unit-tested in tests/logic.test.ts.

type State = Pick<FinanceState, 'transactions'>;

// «عن شهر أكتوبر ٢٠٢٦»: the chip on a collection and on a salary receivable.
export const forMonthLabel = (forMonth: string): string => `عن شهر ${formatMonthLabel(forMonth)}`;

export interface ReceivableChip {
  label: string;
  tone: StatusTone;
}

// One status chip per receivable; never colour alone (the label carries it).
export function receivableChip(state: State, r: Receivable, today: string): ReceivableChip {
  const status = receivableStatus(state, r);
  if (status === 'written_off') return { label: 'اتشطب', tone: 'neutral' };
  if (status === 'settled') return { label: 'اتحصّل', tone: 'ok' };
  if (receivableOverdue(state, r, today)) return { label: 'متأخر', tone: 'attention' };
  return status === 'partial' ? { label: 'اتحصّل جزء', tone: 'neutral' } : { label: 'مستنيه', tone: 'neutral' };
}

// «مرتب · عن شهر أكتوبر ٢٠٢٦ · ميعاده ٥ نوفمبر».
export function receivableSubtitle(r: Receivable): string {
  return [
    r.kind === 'salary' ? 'مرتب' : 'حاجة تانية',
    r.forMonth ? forMonthLabel(r.forMonth) : null,
    r.dueDate ? `ميعاده ${formatDateAr(r.dueDate, { year: false })}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

// «اتحصّل ج.م 400 من ج.م 1,000» while partly collected (shown beside the status chip, so a two-line subtitle on a
// small phone can never cut it off); null otherwise.
export function receivableProgress(state: State, r: Receivable): string | null {
  const collected = receivableCollected(state, r);
  const status = receivableStatus(state, r);
  return collected > 0.005 && status !== 'settled' ? `اتحصّل ${formatMoney(collected, r.currency)} من ${formatMoney(r.amount, r.currency)}` : null;
}

// Still owed first (by due date, then month, then when added), then the closed ones (settled, written off).
export function splitReceivables(state: Pick<FinanceState, 'transactions' | 'receivables'>): { open: Receivable[]; closed: Receivable[] } {
  const key = (r: Receivable) => `${r.dueDate ?? '9999-99-99'}|${r.forMonth ?? '9999-99'}|${r.createdAt}`;
  const sorted = [...state.receivables].sort((a, b) => key(a).localeCompare(key(b)));
  const isOpen = (r: Receivable) => {
    const status = receivableStatus(state, r);
    return status === 'open' || status === 'partial';
  };
  return { open: sorted.filter(isOpen), closed: sorted.filter((r) => !isOpen(r)) };
}

// «الحسابات المعروضة: حسابات بالريال فقط».
export const collectAccountsHelper = (currency: CurrencyCode): string => `الحسابات المعروضة: حسابات بال${currencyNameAr(currency)} فقط`;

// Q2: the workaround, said where the user needs it.
export const CROSS_CURRENCY_NOTE = 'اتدفع بعملة تانية؟ التحصيل لازم يبقى بنفس العملة: اشطب الفلوس دي هنا وسجّل الدخل عادي من المعاملات.';

export const noAccountNote = (currency: CurrencyCode): string =>
  `مفيش حساب بال${currencyNameAr(currency)}؛ ضيف حساب الأول من الحسابات. ${CROSS_CURRENCY_NOTE}`;

// The amount hint in the collect sheet, and whether saving is blocked (Q3: more than what is left).
export function collectHint(state: State, r: Receivable, amount: number | null): { hint: AmountHint; blocked: boolean } {
  const remaining = receivableRemaining(state, r);
  if (amount !== null && amount > remaining + 0.005) {
    return {
      blocked: true,
      hint: {
        tone: 'attention',
        icon: 'info-outline',
        text: `ده أكتر من الباقي (${formatMoney(remaining, r.currency)}). لو اتدفع زيادة: حصّل الباقي هنا وسجّل الزيادة كدخل منفصل.`,
      },
    };
  }
  const after = amount === null ? remaining : Math.max(0, remaining - amount);
  return {
    blocked: false,
    hint: {
      tone: 'neutral',
      icon: 'check-circle-outline',
      text: amount === null || after <= 0.005 ? `الباقي ${formatMoney(remaining, r.currency)}` : `هيفضل باقي ${formatMoney(after, r.currency)}`,
    },
  };
}

// The new-receivable defaults: last month (a salary that should have arrived), and the currency of the account the
// last salary income went to (else the reporting currency).
export function receivableDefaults(
  state: Pick<FinanceState, 'transactions' | 'accounts' | 'settings'>,
  now: Date = new Date()
): { forMonth: string; currency: CurrencyCode } {
  const lastSalary = state.transactions
    .filter((t) => t.type === 'income' && t.categoryId === 'cat-income-salary')
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const account = lastSalary && lastSalary.type === 'income' ? state.accounts.find((a) => a.id === lastSalary.accountId) : undefined;
  return { forMonth: shiftMonth(toMonthKey(now), -1), currency: account?.currency ?? state.settings.reportingCurrency };
}

// Q8: the refill sheet opens after a collection only when there is something to propose.
export const shouldOfferRefill = (suggestion: FundAmount[]): boolean => suggestion.some((s) => s.amount > 0.005);

// "1,250" for an amount input (no grouping, no symbol).
export const amountText = (amount: number): string => String(Math.round(amount * 100) / 100);
