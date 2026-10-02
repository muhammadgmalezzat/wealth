import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ExportSheet } from '@/components/settings/ExportSheet';
import { RestoreSheet } from '@/components/settings/RestoreSheet';

import { Card } from '@/components/ui/Card';
import { FutureDateField } from '@/components/ui/DateFields';
import { FieldLabel, FormInput } from '@/components/ui/FormSheet';
import { LoadingView } from '@/components/ui/LoadingView';
import { Colors, FinanceColors } from '@/constants/theme';
import { openBackup, parseBackup, type BackupFile, type OpenedBackup } from '@/store/backup';
import { useFinanceStore } from '@/store/useFinanceStore';
import { appLockAvailability, authenticate, type LockAvailability } from '@/utils/appLock';
import { pickBackupFile } from '@/utils/backupFiles';
import { confirmAction, showMessage } from '@/utils/dialogs';
import { errorMessage } from '@/utils/errorMessages';
import { formatCurrency, formatDate } from '@/utils/formatters';
import { newId } from '@/utils/id';
import { parseAmount } from '@/utils/parseAmount';
import { runAction } from '@/utils/runAction';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const state = useFinanceStore();
  const { settings } = state;
  // The Dashboard's backup reminder links here with ?export=1.
  const params = useLocalSearchParams<{ export?: string }>();

  const [sarText, setSarText] = useState(String(settings.exchangeRates.SAR_EGP));
  const [usdText, setUsdText] = useState(String(settings.exchangeRates.USD_EGP));
  const [gold24Text, setGold24Text] = useState(String(settings.goldPrice24kEGP));
  const [gold21Text, setGold21Text] = useState(String(settings.goldPrice21kEGP));
  const [trackingStart, setTrackingStart] = useState<string | undefined>(settings.trackingStartDate);
  const [importing, setImporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(params.export === '1');
  const [restore, setRestore] = useState<{ file: BackupFile; opened?: OpenedBackup } | null>(null);
  const [lock, setLock] = useState<LockAvailability | null>(null);

  useEffect(() => {
    appLockAvailability().then(setLock);
  }, []);

  if (!state.hasHydrated) return <LoadingView />;

  const gold24 = parseAmount(gold24Text);

  const handleSave = () => {
    const saved = runAction('تعذّر الحفظ', () =>
      state.updateSettings({
        exchangeRates: { SAR_EGP: parseAmount(sarText) ?? NaN, USD_EGP: parseAmount(usdText) ?? NaN },
        goldPrice24kEGP: gold24 ?? NaN,
        goldPrice21kEGP: parseAmount(gold21Text) ?? NaN,
        ...(trackingStart ? { trackingStartDate: trackingStart } : {}),
      })
    );
    if (saved) showMessage('تم', 'اتحفظت الإعدادات');
  };

  const handlePickBackup = async () => {
    try {
      const text = await pickBackupFile();
      if (text === null) return;
      const file = parseBackup(text);
      // Plain backups can be previewed right away; encrypted ones ask for the password first.
      const opened = file.encrypted ? undefined : await openBackup(file, { now: new Date(), newId });
      setRestore({ file, opened });
    } catch (error) {
      showMessage('تعذّر فتح الملف', errorMessage(error));
    }
  };

  const toggleAppLock = async (enabled: boolean) => {
    // Turning it on proves the user can actually unlock before it can lock them out.
    if (enabled && !(await authenticate('أكد هويتك لتفعيل القفل'))) return;
    state.setAppLock(enabled);
  };

  const lastBackupLabel = settings.lastBackupAt
    ? `آخر نسخة احتياطية: ${formatDate(settings.lastBackupAt)}`
    : 'لسه معملتش نسخة احتياطية';

  const handleImport = () => {
    confirmAction({
      title: 'استيراد البيانات الافتتاحية',
      message:
        'هيتم استبدال كل البيانات الحالية بالبيانات الافتتاحية. نسخة احتياطية من البيانات الحالية هتتحفظ الأول. أسعار الصرف والذهب الحالية هتفضل زي ما هي.',
      confirmText: 'استيراد',
      cancelText: 'إلغاء',
      onConfirm: async () => {
        setImporting(true);
        try {
          await state.importOpeningData();
          const fresh = useFinanceStore.getState();
          setTrackingStart(fresh.settings.trackingStartDate);
          showMessage('تم', 'اتستوردت البيانات الافتتاحية');
        } catch (error) {
          showMessage('تعذّر الاستيراد', errorMessage(error));
        } finally {
          setImporting(false);
        }
      },
    });
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      keyboardShouldPersistTaps="handled">
      {/* ── Exchange rates ── */}
      <Text style={styles.sectionTitle}>أسعار الصرف</Text>
      <Card>
        <FieldLabel>ريال سعودي ← جنيه</FieldLabel>
        <FormInput value={sarText} onChangeText={setSarText} keyboardType="decimal-pad" />
        <FieldLabel>دولار ← جنيه</FieldLabel>
        <FormInput value={usdText} onChangeText={setUsdText} keyboardType="decimal-pad" />
        <Text style={styles.hint}>آخر تحديث: {formatDate(settings.exchangeRates.lastUpdated)}</Text>
      </Card>

      {/* ── Gold prices ── */}
      <Text style={styles.sectionTitle}>سعر جرام الذهب (جنيه)</Text>
      <Card>
        <FieldLabel>عيار 24</FieldLabel>
        <FormInput value={gold24Text} onChangeText={setGold24Text} keyboardType="decimal-pad" />
        <FieldLabel>عيار 21</FieldLabel>
        <FormInput value={gold21Text} onChangeText={setGold21Text} keyboardType="decimal-pad" />
        {gold24 !== null && (
          <Text style={styles.hint}>عيار 18 (محسوب): {formatCurrency(gold24 * 0.75, 'EGP')}</Text>
        )}
        <Text style={styles.hint}>آخر تحديث: {formatDate(settings.goldPriceUpdatedAt)}</Text>
      </Card>

      {/* ── Tracking ── */}
      <Text style={styles.sectionTitle}>بداية التتبع</Text>
      <Card>
        <FutureDateField value={trackingStart} onChange={setTrackingStart} />
        <Text style={styles.hint}>المعاملات قبل التاريخ ده مش بتدخل في ملخص الشهر</Text>
      </Card>

      <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85}>
        <Text style={styles.saveText}>حفظ الإعدادات</Text>
      </TouchableOpacity>

      {/* ── Backups ── */}
      <Text style={styles.sectionTitle}>النسخ الاحتياطي</Text>
      <Card>
        <Text style={styles.body}>{lastBackupLabel}</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => setExportOpen(true)} activeOpacity={0.85}>
          <Text style={styles.primaryText}>تصدير نسخة احتياطية</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryBtn} onPress={handlePickBackup} activeOpacity={0.85}>
          <Text style={styles.secondaryText}>استعادة من نسخة احتياطية</Text>
        </TouchableOpacity>
      </Card>

      {/* ── Security ── */}
      <Text style={styles.sectionTitle}>الأمان</Text>
      <Card>
        <View style={styles.switchRow}>
          <Switch
            value={!!settings.appLockEnabled}
            onValueChange={toggleAppLock}
            disabled={!lock?.available}
          />
          <Text style={styles.body}>قفل التطبيق</Text>
        </View>
        <Text style={styles.hint}>
          {lock && !lock.available
            ? lock.reason
            : 'بصمة أو قفل الشاشة عند فتح التطبيق، وبعد دقيقة في الخلفية'}
        </Text>
      </Card>

      {/* ── Opening data ── */}
      <Text style={styles.sectionTitle}>البيانات</Text>
      <Card>
        <Text style={styles.body}>
          استبدال كل البيانات بالوضع الافتتاحي (الحسابات، الذهب، ومعاملات أغسطس وسبتمبر).
        </Text>
        <TouchableOpacity
          style={[styles.importBtn, importing && styles.disabled]}
          onPress={handleImport}
          disabled={importing}
          activeOpacity={0.85}>
          <Text style={styles.importText}>{importing ? 'جاري الاستيراد…' : 'استيراد البيانات الافتتاحية'}</Text>
        </TouchableOpacity>
      </Card>
      {exportOpen && <ExportSheet onClose={() => setExportOpen(false)} />}
      {restore && (
        <RestoreSheet file={restore.file} initialOpened={restore.opened} onClose={() => setRestore(null)} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  content: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.light.text,
    textAlign: 'right',
    marginTop: 20,
    marginBottom: 10,
  },
  hint: {
    fontSize: 12,
    color: Colors.light.icon,
    textAlign: 'right',
    marginTop: 10,
  },
  body: {
    fontSize: 14,
    color: Colors.light.text,
    textAlign: 'right',
    lineHeight: 21,
  },
  saveBtn: {
    marginTop: 20,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: Colors.light.tint,
  },
  saveText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  primaryBtn: {
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: Colors.light.tint,
  },
  primaryText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryBtn: {
    marginTop: 10,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: Colors.light.tint + '15',
  },
  secondaryText: {
    color: Colors.light.tint,
    fontSize: 15,
    fontWeight: '700',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  importBtn: {
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: FinanceColors.expense + '15',
  },
  importText: {
    color: FinanceColors.expense,
    fontSize: 15,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.5,
  },
});
