// Pure UI helpers for the Settings screen (no React Native; unit-tested).

// "النهارده" · "منذ يوم" · "منذ يومين" · "منذ 5 أيام" · "منذ 14 يوم"; null days = never backed up.
export function backupAgeLabel(days: number | null): string {
  if (days === null) return 'لسه مفيش نسخة';
  if (days <= 0) return 'النهارده';
  if (days === 1) return 'منذ يوم';
  if (days === 2) return 'منذ يومين';
  if (days <= 10) return `منذ ${days} أيام`;
  return `منذ ${days} يوم`;
}

// Same sentence as Home's backup nudge, so both say the same thing.
export const BACKUP_NUDGE = 'يفضل تعمل نسخة احتياطية عشان بياناتك تفضل آمنة.';
