import type { RecurringRule } from '@/store/types';

// Pure UI helpers for the Recurring screen and RuleSheet (no React Native; unit-tested).

export type RuleState = 'active' | 'paused' | 'ended';

// paused: switched off · ended: no occurrence left (nextDate '') · active otherwise.
export function ruleState(rule: Pick<RecurringRule, 'active' | 'nextDate'>): RuleState {
  if (!rule.active) return 'paused';
  return rule.nextDate ? 'active' : 'ended';
}

// "تفاصيل أكتر" starts open when editing a rule that uses any of its fields.
export function ruleDetailsOpen(rule: Pick<RecurringRule, 'endDate' | 'note' | 'toAmount'> | undefined): boolean {
  return !!rule && (!!rule.endDate || !!rule.note?.trim() || rule.toAmount !== undefined);
}
