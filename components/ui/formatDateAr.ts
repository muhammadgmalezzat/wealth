import { fromDateKey } from '@/utils/dates';

// Arabic display date ("٥ أكتوبر ٢٠٢٦") for the redesigned screens; utils/formatters' formatDate
// keeps its existing output elsewhere until those screens are redesigned. Accepts a date key
// or an ISO timestamp.
export function formatDateAr(value: string, { year = true }: { year?: boolean } = {}): string {
  const date = value.length === 10 ? fromDateKey(value) : new Date(value);
  return date.toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', ...(year ? { year: 'numeric' } : {}) });
}
