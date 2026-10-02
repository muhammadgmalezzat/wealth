import { router } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Colors, FinanceColors } from '@/constants/theme';

const REMIND_AFTER_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

// Whole days since the last backup, or null when there has never been one.
export function daysSinceBackup(lastBackupAt: string | undefined, now: Date = new Date()): number | null {
  if (!lastBackupAt) return null;
  return Math.floor((now.getTime() - new Date(lastBackupAt).getTime()) / DAY_MS);
}

// Small banner nudging the user to export when the last backup is missing or > 7 days old.
export function BackupReminder({ lastBackupAt }: { lastBackupAt?: string }) {
  const days = daysSinceBackup(lastBackupAt);
  if (days !== null && days < REMIND_AFTER_DAYS) return null;

  return (
    <View style={styles.banner}>
      <TouchableOpacity
        style={styles.button}
        onPress={() => router.push({ pathname: '/settings', params: { export: '1' } })}
        activeOpacity={0.85}>
        <Text style={styles.buttonText}>صدّر نسخة</Text>
      </TouchableOpacity>
      <Text style={styles.text}>
        {days === null ? 'لسه معملتش نسخة احتياطية' : `آخر نسخة احتياطية من ${days} يوم`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    padding: 12,
    marginBottom: 16,
    borderRadius: 10,
    backgroundColor: FinanceColors.gold + '18',
    borderWidth: 1,
    borderColor: FinanceColors.gold + '55',
  },
  text: {
    flex: 1,
    fontSize: 13,
    color: Colors.light.text,
    textAlign: 'right',
  },
  button: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: FinanceColors.gold,
  },
  buttonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
});
