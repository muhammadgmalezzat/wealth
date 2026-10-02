import { Colors, FinanceColors } from '@/constants/theme';
import type { FundStatus } from '@/store/selectors';
import type { Fund, SinkingFrequency } from '@/store/types';

export const FUND_TYPE_LABELS: Record<Fund['type'], string> = {
  emergency: 'طوارئ',
  goal: 'هدف',
  sinking: 'مصاريف دورية',
};

export const FUND_SECTION_TITLES: Record<Fund['type'], string> = {
  emergency: 'الطوارئ',
  goal: 'الأهداف',
  sinking: 'مصاريف دورية',
};

export const FREQUENCY_LABELS: Record<SinkingFrequency, string> = {
  yearly: 'سنوي',
  semiannual: 'كل ٦ شهور',
  quarterly: 'كل ٣ شهور',
};

export const STATUS_BADGES: Record<FundStatus, { label: string; color: string }> = {
  ahead: { label: 'متقدم', color: FinanceColors.income },
  on_track: { label: 'في الطريق', color: Colors.light.tint },
  behind: { label: 'متأخر', color: FinanceColors.expense },
  no_deadline: { label: 'بدون موعد', color: Colors.light.icon },
};
