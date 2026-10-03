import type { RecurringRule } from '@/store/types';
import { fromDateKey } from '@/utils/dates';

const plural = (n: number, one: string, two: string, few: string) =>
  n === 1 ? one : n === 2 ? two : `${n} ${few}`;

// "كل شهر يوم 5" · "كل 3 شهور يوم 5" · "كل أسبوعين" · "كل سنة"
export function frequencyLabel(rule: Pick<RecurringRule, 'frequency' | 'interval' | 'dayOfMonth' | 'startDate'>): string {
  const n = Math.max(1, rule.interval || 1);
  const day = rule.dayOfMonth ?? fromDateKey(rule.startDate).getDate();
  if (rule.frequency === 'weekly') return `كل ${plural(n, 'أسبوع', 'أسبوعين', 'أسابيع')}`;
  if (rule.frequency === 'yearly') return `كل ${plural(n, 'سنة', 'سنتين', 'سنين')}`;
  return `كل ${plural(n, 'شهر', 'شهرين', 'شهور')} يوم ${day}`;
}

export const MODE_LABELS: Record<RecurringRule['mode'], string> = {
  auto: 'تلقائي',
  confirm: 'بتأكيد',
};

export const KIND_SECTION_TITLES: Record<RecurringRule['kind'], string> = {
  income: 'دخل',
  expense: 'مصروفات',
  transfer: 'تحويلات',
};
