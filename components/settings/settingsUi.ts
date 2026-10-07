// Pure UI helpers for the Settings screen (no React Native; unit-tested).
import { daysAgoPhrase } from '@/utils/formatters';

// "النهارده" · "منذ يوم" · "منذ يومين" · "منذ 5 أيام" · "منذ 14 يوم"; null days = never backed up.
export function backupAgeLabel(days: number | null): string {
  return days === null ? 'لسه مفيش نسخة' : daysAgoPhrase(days);
}

// Same sentence as Home's backup nudge, so both say the same thing.
export const BACKUP_NUDGE = 'يفضل تعمل نسخة احتياطية عشان بياناتك تفضل آمنة.';
