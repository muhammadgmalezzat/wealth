import { router } from 'expo-router';

import { InsightCard } from '@/components/ui/InsightCard';

const REMIND_AFTER_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

// Whole days since the last backup, or null when there has never been one.
export function daysSinceBackup(lastBackupAt: string | undefined, now: Date = new Date()): number | null {
  if (!lastBackupAt) return null;
  return Math.floor((now.getTime() - new Date(lastBackupAt).getTime()) / DAY_MS);
}

// Whether to nudge: no backup yet, or the last one is 7+ days old.
export function needsBackupReminder(lastBackupAt: string | undefined, now: Date = new Date()): boolean {
  const days = daysSinceBackup(lastBackupAt, now);
  return days === null || days >= REMIND_AFTER_DAYS;
}

// Calm nudge to export a backup (opens Settings with the export sheet).
export function BackupReminder({ lastBackupAt }: { lastBackupAt?: string }) {
  if (!needsBackupReminder(lastBackupAt)) return null;
  return (
    <InsightCard
      tone="attention"
      icon="backup"
      message="يفضل تعمل نسخة احتياطية عشان بياناتك تفضل آمنة."
      actionLabel="تصدير نسخة"
      onAction={() => router.push({ pathname: '/settings', params: { export: '1' } })}
    />
  );
}
