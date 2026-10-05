import { formatMoney } from '@/components/ui/formatMoney';
import {
  fundCurrent,
  fundDueDate,
  fundRequiredMonthly,
  fundsByPriority,
  fundStatus,
} from '@/store/selectors';
import type { FinanceState, Fund, FundMovement } from '@/store/types';
import { toEGP } from '@/utils/currency';

// Pure UI helpers for the Funds tab and fund detail (no React Native; unit-tested).

export interface FundsSummary {
  // Σ fundCurrent (cash + linked gold), in EGP at current rates.
  reservedEGP: number;
  // Σ fundRequiredMonthly (funds with a due date), in EGP at current rates.
  requiredEGP: number;
  count: number;
}

export function fundsSummary(state: FinanceState, now: Date = new Date()): FundsSummary {
  const rates = state.settings.exchangeRates;
  const funds = fundsByPriority(state);
  let reservedEGP = 0;
  let requiredEGP = 0;
  for (const fund of funds) {
    reservedEGP += toEGP(fundCurrent(state, fund.id), fund.currency, rates);
    const required = fundRequiredMonthly(state, fund.id, now);
    if (required !== null) requiredEGP += toEGP(required, fund.currency, rates);
  }
  return { reservedEGP, requiredEGP, count: funds.length };
}

export interface NextStep {
  tone: 'ok' | 'attention' | 'neutral';
  text: string;
}

const EPSILON = 0.005;

// The one sentence under a fund's progress on its detail screen.
export function fundNextStep(state: FinanceState, fund: Fund, now: Date = new Date()): NextStep {
  const current = fundCurrent(state, fund.id);
  const remaining = fund.targetAmount - current;
  if (remaining <= EPSILON) return { tone: 'ok', text: 'وصلت للهدف.' };
  if (!fundDueDate(fund)) {
    return { tone: 'neutral', text: `لسه محتاج ${formatMoney(remaining, fund.currency)} للوصول للهدف.` };
  }
  const required = fundRequiredMonthly(state, fund.id, now) ?? 0;
  switch (fundStatus(state, fund.id, now)) {
    case 'behind':
      return { tone: 'attention', text: `خصص ${formatMoney(required, fund.currency)} هذا الشهر للبقاء على المسار.` };
    case 'pending':
      return { tone: 'neutral', text: `محتاج ${formatMoney(required, fund.currency)} الشهر ده.` };
    default:
      return { tone: 'ok', text: 'ماشي على الخطة.' };
  }
}

export type MovementKind = 'allocation' | 'withdrawal' | 'payment';

// Sinking payments are withdrawals noted "اتدفعت: {fund}" (store/operations paySinkingFund).
export function movementKind(movement: Pick<FundMovement, 'amount' | 'note'>): MovementKind {
  if (movement.amount >= 0) return 'allocation';
  return movement.note?.startsWith('اتدفعت') ? 'payment' : 'withdrawal';
}

export interface PercentDisplay {
  // What the chip/caption shows: capped at 100.
  shown: number;
  // The real rounded percent (may exceed 100), for secondary text.
  real: number;
  // Progress past the target.
  over: boolean;
}

// Fund progress as a capped percent: "100%" + "تخطيت الهدف" past the target, real figure kept.
export function fundPercent(progress: number): PercentDisplay {
  const real = Math.round(Math.max(0, progress) * 100);
  return { shown: Math.min(100, real), real, over: progress > 1 + 1e-9 };
}
