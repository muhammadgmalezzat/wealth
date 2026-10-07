import { formatMoney } from '@/components/ui/formatMoney';
import { toEGP } from '@/utils/currency';
import { daysBetween, monthOf, shiftMonth, toDateKey, toMonthKey } from '@/utils/dates';
import { daysAgoPhrase, dueCountPhrase, formatMonthLabel, withinDaysPhrase } from '@/utils/formatters';
import { overspentLines, planFor } from './planning';
import { dueOccurrences } from './recurring';
import {
  fundCurrent,
  fundMonthShortfall,
  fundsByPriority,
  fundStatus,
  suggestedEmergencyTarget,
  unassignedEGP,
} from './selectors';
import type { CurrencyCode, FinanceState, Fund } from './types';

// Next Best Action engine: every rule that applies right now, most important first. Pure (no
// React Native), so it is unit-tested in tests/logic.test.ts. Home shows the first action as a
// card and the rest in a list; screens act on `cta`.

type State = FinanceState;

export type ActionSeverity = 'urgent' | 'warning' | 'opportunity' | 'info';

// Screens, or a sheet Home opens itself ('cover', 'assign', 'new-emergency').
export type ActionRoute = '/due' | '/plan' | '/review' | '/settings' | '/fund/[id]' | 'cover' | 'assign' | 'new-emergency';

export interface NextAction {
  // Stable per situation ('due', 'sinking-<fundId>', 'review-2026-09'…): snoozes are keyed by it.
  id: string;
  // The rule's rank (1 = most important); actions are sorted by it.
  priority: number;
  severity: ActionSeverity;
  title: string;
  subtitle?: string;
  amount?: number;
  currency?: CurrencyCode;
  cta: { label: string; route: ActionRoute; params?: Record<string, string> };
  dismissible: boolean;
}

// Due items and spent fund money can't be snoozed: they make the numbers wrong until handled.
export const NON_DISMISSIBLE_ACTION_IDS = ['due', 'cover'];
export const SNOOZE_MS = 24 * 60 * 60 * 1000;
// Prices and backups older than this many days get a nudge.
export const STALE_DAYS = 7;
// A sinking fund due within this many days that isn't full yet gets a nudge.
export const SINKING_SOON_DAYS = 14;
// The first days of a month in which Home asks for last month's review.
export const REVIEW_PROMPT_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;
// Float noise isn't money.
const EPSILON = 0.005;

// Whole days since an ISO timestamp; null when there is none (or it can't be read).
export function daysSince(iso: string | undefined, now: Date = new Date()): number | null {
  const at = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(at) ? null : Math.floor((now.getTime() - at) / DAY_MS);
}

export function daysSinceBackup(lastBackupAt: string | undefined, now: Date = new Date()): number | null {
  return daysSince(lastBackupAt, now);
}

// No backup yet, or the last one is 7+ days old.
export function needsBackupReminder(lastBackupAt: string | undefined, now: Date = new Date()): boolean {
  const days = daysSinceBackup(lastBackupAt, now);
  return days === null || days >= STALE_DAYS;
}

export function isReviewed(state: Pick<State, 'monthlyReviews'>, month: string): boolean {
  return state.monthlyReviews.some((r) => r.month === month);
}

// Last month, when it had transactions (since tracking started) and hasn't been reviewed yet.
export function pendingReviewMonth(state: State, now: Date = new Date()): string | null {
  const month = shiftMonth(toMonthKey(now), -1);
  if (isReviewed(state, month)) return null;
  const start = state.settings.trackingStartDate;
  const hadActivity = state.transactions.some((tx) => monthOf(tx.date) === month && tx.date >= start);
  return hadActivity ? month : null;
}

// Whether `action` is snoozed at `now` (non-dismissible actions never are).
export function isSnoozed(state: Pick<State, 'actionDismissals'>, action: Pick<NextAction, 'id' | 'dismissible'>, now: Date): boolean {
  if (!action.dismissible) return false;
  const dismissal = state.actionDismissals.find((d) => d.actionId === action.id);
  return !!dismissal && Date.parse(dismissal.until) > now.getTime();
}

// "صندوق الطوارئ" stays as is; "جواز" becomes "صندوق جواز".
const fundLabel = (fund: Fund) => (fund.name.trim().startsWith('صندوق') ? fund.name.trim() : `صندوق ${fund.name.trim()}`);

const allocateCta = (fund: Fund): NextAction['cta'] => ({
  label: 'خصص الآن',
  route: '/fund/[id]',
  params: { id: fund.id, allocate: '1' },
});

type Draft = Omit<NextAction, 'priority' | 'dismissible'>;

// Every applicable action, snoozed ones included, sorted by priority. Rules, in order:
//  1 due 'confirm' items          2 fund money spent (unassigned < 0)   3 overspent plan lines
//  4 last month not reviewed       5 no plan this month                  6 no / thin emergency fund
//  7 sinking fund due ≤ 14 days    8 fund behind this month              9 money without a job
// 10 gold / FX prices ≥ 7 days old 11 last backup ≥ 7 days old (or never)
export function allActions(state: State, now: Date = new Date()): NextAction[] {
  const today = toDateKey(now);
  const month = toMonthKey(now);
  const rates = state.settings.exchangeRates;
  const unassigned = unassignedEGP(state);
  const actions: NextAction[] = [];
  const add = (priority: number, draft: Draft) =>
    actions.push({ ...draft, priority, dismissible: !NON_DISMISSIBLE_ACTION_IDS.includes(draft.id) });

  // 1
  const due = dueOccurrences(state, today, 'confirm');
  if (due.length > 0) {
    add(1, {
      id: 'due',
      severity: 'urgent',
      title: `عندك ${dueCountPhrase(due.length)}`,
      subtitle: 'أكّدها أو اتخطاها عشان أرصدتك تفضل مظبوطة.',
      cta: { label: 'راجعهم', route: '/due' },
    });
  }

  // 2
  if (unassigned < -EPSILON) {
    add(2, {
      id: 'cover',
      severity: 'urgent',
      title: `صرفت ${formatMoney(-unassigned, 'EGP')} من فلوس مخصصة`,
      subtitle: 'رجّع الفرق من صندوق عشان أرقام الصناديق تفضل حقيقية.',
      amount: -unassigned,
      currency: 'EGP',
      cta: { label: 'غطّي الفرق', route: 'cover' },
    });
  }

  // 3
  const plan = planFor(state, month);
  const overspent = overspentLines(state, month);
  if (plan && overspent.length > 0) {
    const over = overspent.reduce((total, l) => total - l.remaining, 0);
    const names = overspent.map((l) => state.categories.find((c) => c.id === l.categoryId)?.name ?? '—');
    add(3, {
      id: 'overspent',
      severity: 'warning',
      title: `عدّيت ميزانية: ${names.join('، ')}`,
      subtitle: `زيادة ${formatMoney(over, plan.currency)} عن الخطة.`,
      amount: over,
      currency: plan.currency,
      cta: { label: 'افتح الخطة', route: '/plan' },
    });
  }

  // 4
  const reviewMonth = pendingReviewMonth(state, now);
  if (reviewMonth) {
    add(4, {
      id: `review-${reviewMonth}`,
      severity: 'opportunity',
      title: `راجع شهر ${formatMonthLabel(reviewMonth)}`,
      subtitle: 'شوف دخلك ومصروفك وقارنهم بالخطة في دقيقتين.',
      cta: { label: 'ابدأ المراجعة', route: '/review', params: { month: reviewMonth } },
    });
  }

  // 5
  if (!plan) {
    add(5, {
      id: `plan-${month}`,
      severity: 'warning',
      title: 'اعمل خطة الشهر',
      subtitle: 'ادي كل جنيه من دخلك وظيفة: مصاريف وتحويش.',
      cta: { label: 'اعمل الخطة', route: '/plan' },
    });
  }

  // 6
  const funds = fundsByPriority(state);
  const emergency = funds.filter((f) => f.type === 'emergency');
  if (emergency.length === 0) {
    add(6, {
      id: 'emergency',
      severity: 'opportunity',
      title: 'ابدأ صندوق الطوارئ',
      subtitle: 'حتى مبلغ صغير بيحميك من المفاجآت.',
      cta: { label: 'أنشئ الصندوق', route: 'new-emergency' },
    });
  } else {
    const target = suggestedEmergencyTarget(state, 3, now);
    const monthlyEssentials = target === null ? null : target / 3;
    const savedEGP = emergency.reduce((total, f) => total + toEGP(fundCurrent(state, f.id), f.currency, rates), 0);
    if (monthlyEssentials !== null && savedEGP < monthlyEssentials - EPSILON) {
      add(6, {
        id: 'emergency',
        severity: 'opportunity',
        title: 'ابدأ صندوق الطوارئ',
        subtitle: `فيه أقل من شهر مصاريف أساسية (${formatMoney(monthlyEssentials, 'EGP')}).`,
        amount: monthlyEssentials - savedEGP,
        currency: 'EGP',
        cta: allocateCta(emergency[0]),
      });
    }
  }

  // 7
  const sinkingSoon = new Set<string>();
  for (const fund of funds) {
    if (fund.type !== 'sinking' || !fund.nextDueDate) continue;
    const days = daysBetween(today, fund.nextDueDate);
    const remaining = fund.targetAmount - fundCurrent(state, fund.id);
    if (days > SINKING_SOON_DAYS || remaining <= EPSILON) continue;
    sinkingSoon.add(fund.id);
    add(7, {
      id: `sinking-${fund.id}`,
      severity: 'warning',
      title: `فاضل ${formatMoney(remaining, fund.currency)} على ${fund.name}`,
      subtitle: days < 0 ? 'ميعاده فات.' : days === 0 ? 'مستحق النهارده.' : `مستحق ${withinDaysPhrase(days)}.`,
      amount: remaining,
      currency: fund.currency,
      cta: allocateCta(fund),
    });
  }

  // 8
  for (const fund of funds) {
    if (sinkingSoon.has(fund.id) || fundStatus(state, fund.id, now) !== 'behind') continue;
    const shortfall = fundMonthShortfall(state, fund.id, now);
    if (shortfall <= EPSILON) continue;
    add(8, {
      id: `behind-${fund.id}`,
      severity: 'warning',
      title: `${fundLabel(fund)} متأخر ${formatMoney(shortfall, fund.currency)} الشهر ده`,
      subtitle: 'خصصله عشان يفضل على المسار.',
      amount: shortfall,
      currency: fund.currency,
      cta: allocateCta(fund),
    });
  }

  // 9
  if (unassigned > EPSILON) {
    add(9, {
      id: 'assign',
      severity: 'opportunity',
      title: `عندك ${formatMoney(unassigned, 'EGP')} بدون وظيفة، وزّعها`,
      subtitle: 'حطها في صندوق أو هدف قبل ما تتصرف.',
      amount: unassigned,
      currency: 'EGP',
      cta: { label: 'وزّع أموالك', route: 'assign' },
    });
  }

  // 10 — only prices the data actually uses.
  const usesGold = state.holdings.some((h) => h.type === 'gold');
  const usesFx =
    state.accounts.some((a) => a.currency !== 'EGP') ||
    state.holdings.some((h) => h.type === 'currency' && h.currency !== 'EGP') ||
    state.funds.some((f) => f.currency !== 'EGP') ||
    state.monthlyPlans.some((p) => p.currency !== 'EGP');
  const stale = (iso: string) => {
    const days = daysSince(iso, now);
    return days === null || days >= STALE_DAYS ? (days ?? Infinity) : null;
  };
  const goldAge = usesGold ? stale(state.settings.goldPriceUpdatedAt) : null;
  const fxAge = usesFx ? stale(rates.lastUpdated) : null;
  if (goldAge !== null || fxAge !== null) {
    const what = goldAge !== null && fxAge !== null ? 'أسعار الذهب والصرف' : goldAge !== null ? 'سعر الذهب' : 'أسعار الصرف';
    const age = Math.max(goldAge ?? 0, fxAge ?? 0);
    add(10, {
      id: 'prices',
      severity: 'info',
      title: `حدّث ${what}`,
      subtitle: Number.isFinite(age) ? `آخر تحديث ${daysAgoPhrase(age)}، فقيمة أصولك ممكن تكون مش دقيقة.` : 'قيمة أصولك ممكن تكون مش دقيقة.',
      cta: { label: 'حدّث الأسعار', route: '/settings' },
    });
  }

  // 11 — once there is something worth backing up.
  const hasData = state.transactions.length > 0 || state.funds.length > 0 || state.holdings.length > 0;
  if (hasData && needsBackupReminder(state.settings.lastBackupAt, now)) {
    const days = daysSinceBackup(state.settings.lastBackupAt, now);
    add(11, {
      id: 'backup',
      severity: 'info',
      title: 'اعمل نسخة احتياطية',
      subtitle: days === null ? 'لسه معملتش أي نسخة من بياناتك.' : `آخر نسخة ${daysAgoPhrase(days)}.`,
      cta: { label: 'تصدير نسخة', route: '/settings', params: { export: '1' } },
    });
  }

  // Array#sort is stable, so actions of one rule keep their order (funds by priority).
  return actions.sort((a, b) => a.priority - b.priority);
}

// What to show now: allActions without the snoozed ones.
export function nextActions(state: State, now: Date = new Date()): NextAction[] {
  return allActions(state, now).filter((a) => !isSnoozed(state, a, now));
}
