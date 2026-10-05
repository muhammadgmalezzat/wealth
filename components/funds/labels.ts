import type { StatusTone } from '@/components/ui/StatusChip';
import { formatMoney } from '@/components/ui/formatMoney';
import { colors } from '@/constants/theme';
import type { FundStatus } from '@/store/selectors';
import type { CurrencyCode, Fund, SinkingFrequency } from '@/store/types';

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

// Fund status → chip label and tone. Behind is "attention" (amber), never red.
export const FUND_STATUS: Record<FundStatus, { label: string; tone: StatusTone }> = {
  ahead: { label: 'متقدم', tone: 'ok' },
  on_track: { label: 'على المسار', tone: 'ok' },
  // This month's contribution isn't in yet, but there's still time.
  pending: { label: 'الشهر ده', tone: 'neutral' },
  behind: { label: 'محتاج انتباه', tone: 'attention' },
  no_deadline: { label: 'بدون موعد', tone: 'neutral' },
};

const TONE_COLOR: Record<StatusTone, string> = {
  ok: colors.primary800,
  attention: colors.warning,
  danger: colors.danger,
  gold: colors.goldText,
  neutral: colors.textSecondary,
};

// Older call sites (fund detail) read { label, color }; derived from FUND_STATUS.
export const STATUS_BADGES: Record<FundStatus, { label: string; color: string }> = {
  ahead: { label: FUND_STATUS.ahead.label, color: TONE_COLOR[FUND_STATUS.ahead.tone] },
  on_track: { label: FUND_STATUS.on_track.label, color: TONE_COLOR[FUND_STATUS.on_track.tone] },
  pending: { label: FUND_STATUS.pending.label, color: TONE_COLOR[FUND_STATUS.pending.tone] },
  behind: { label: FUND_STATUS.behind.label, color: TONE_COLOR[FUND_STATUS.behind.tone] },
  no_deadline: { label: FUND_STATUS.no_deadline.label, color: TONE_COLOR[FUND_STATUS.no_deadline.tone] },
};

// The one action sentence under a fund's progress (null = nothing to say).
export function fundStatusSentence(
  status: FundStatus,
  { requiredMonthly, remaining, currency }: { requiredMonthly: number | null; remaining: number; currency: CurrencyCode }
): string | null {
  switch (status) {
    case 'on_track':
      return 'ماشي على الخطة';
    case 'pending':
      return requiredMonthly && requiredMonthly > 0.005 ? `محتاج ${formatMoney(requiredMonthly, currency)} الشهر ده` : null;
    case 'behind':
      return requiredMonthly && requiredMonthly > 0.005
        ? `محتاج ${formatMoney(requiredMonthly, currency)} هذا الشهر للحاق بالخطة`
        : null;
    case 'no_deadline':
      return remaining > 0.005 ? `لسه محتاج ${formatMoney(remaining, currency)} للوصول للهدف` : 'وصلت للهدف';
    default:
      return null;
  }
}
