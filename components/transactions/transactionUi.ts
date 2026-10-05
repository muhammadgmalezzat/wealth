import type { TransactionFilter } from '@/store/selectors';
import type { Category, Transaction } from '@/store/types';

// Pure UI helpers for the Transactions screen and sheet (no React Native; unit-tested).

export const FILTERS: { label: string; value: TransactionFilter }[] = [
  { label: 'الكل', value: 'all' },
  { label: 'مصروف', value: 'expense' },
  { label: 'دخل', value: 'income' },
  { label: 'تحويل', value: 'transfer' },
  { label: 'ذهب', value: 'asset_purchase' },
];

// "مفيش {type} في الشهر ده." for a filter with no match.
const FILTER_NOUNS: Record<Exclude<TransactionFilter, 'all'>, string> = {
  expense: 'مصروفات',
  income: 'دخل',
  transfer: 'تحويلات',
  asset_purchase: 'مشتريات ذهب',
};

export function emptyFilterMessage(filter: TransactionFilter): string {
  return filter === 'all' ? 'مفيش معاملات في الشهر ده.' : `مفيش ${FILTER_NOUNS[filter]} في الشهر ده.`;
}

// UI-only filter over a month's transactions; "ذهب" = asset_purchase.
export function filterTransactions(transactions: Transaction[], filter: TransactionFilter): Transaction[] {
  return filter === 'all' ? transactions : transactions.filter((tx) => tx.type === filter);
}

export interface CategoryChips {
  visible: Category[];
  // How many more sit behind "كل البنود".
  hiddenCount: number;
}

// The quick category chips: the last-used category first, then the rest in picker order, capped
// at `max`. The selected category is always visible (appended when it falls past the cap).
export function quickCategories(
  categories: Category[],
  { lastUsedId, selectedId, max = 6 }: { lastUsedId?: string; selectedId?: string; max?: number } = {}
): CategoryChips {
  const last = categories.find((c) => c.id === lastUsedId);
  const ordered = last ? [last, ...categories.filter((c) => c.id !== last.id)] : categories;
  const visible = ordered.slice(0, max);
  const selected = categories.find((c) => c.id === selectedId);
  if (selected && !visible.includes(selected)) visible.push(selected);
  return { visible, hiddenCount: categories.length - visible.length };
}

// "{from} ← {to}" that reads right-to-left even when an account name is Latin: RLMs fix the
// direction around each part so the arrow always points from the source to the destination.
export function transferTitle(from: string, to: string): string {
  const RLM = '\u200f';
  return `${RLM}${from}${RLM} ← ${RLM}${to}${RLM}`;
}
