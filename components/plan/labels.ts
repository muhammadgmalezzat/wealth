import type { SegmentOption } from '@/components/ui/Segment';
import type { ExpenseBucket, PlanLineKind } from '@/store/types';

export const BUCKET_TITLES: Record<ExpenseBucket, string> = {
  essentials: 'أساسيات',
  lifestyle: 'رفاهيات',
  giving: 'عطاء',
};

export const KIND_OPTIONS: SegmentOption<PlanLineKind>[] = [
  { label: 'ثابت', value: 'fixed' },
  { label: 'مرن', value: 'flexible' },
];
