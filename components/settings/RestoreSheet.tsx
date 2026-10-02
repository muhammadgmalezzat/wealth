import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { FieldLabel, FormInput, FormSheet } from '@/components/ui/FormSheet';
import { Colors, FinanceColors } from '@/constants/theme';
import { backupPreview, openBackup, type BackupFile, type OpenedBackup } from '@/store/backup';
import { useFinanceStore } from '@/store/useFinanceStore';
import { confirmAction, showMessage } from '@/utils/dialogs';
import { errorMessage } from '@/utils/errorMessages';
import { formatCurrency, formatDate } from '@/utils/formatters';
import { newId } from '@/utils/id';

interface RestoreSheetProps {
  // An already-parsed backup envelope (see parseBackup).
  file: BackupFile;
  // Plain backups are opened by the caller before the sheet is shown.
  initialOpened?: OpenedBackup;
  onClose: () => void;
}

// "استعادة من نسخة احتياطية": password (if encrypted) → preview → confirm → replace.
// Nothing changes until the user confirms; the current data is snapshotted first.
export function RestoreSheet({ file, initialOpened, onClose }: RestoreSheetProps) {
  const restoreBackup = useFinanceStore((s) => s.restoreBackup);
  const [password, setPassword] = useState('');
  const [opened, setOpened] = useState<OpenedBackup | null>(initialOpened ?? null);
  const [busy, setBusy] = useState(false);

  const open = async () => {
    setBusy(true);
    try {
      setOpened(await openBackup(file, { password, now: new Date(), newId }));
    } catch (error) {
      showMessage('تعذّر فتح النسخة', errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!opened) return;
    confirmAction({
      title: 'استعادة النسخة الاحتياطية',
      message: 'كل البيانات الحالية هتتستبدل بالنسخة دي. هتتحفظ نسخة من بياناتك الحالية الأول.',
      confirmText: 'استعادة',
      cancelText: 'إلغاء',
      onConfirm: async () => {
        setBusy(true);
        try {
          await restoreBackup(opened.state);
          showMessage('تم', 'اتستعادت النسخة الاحتياطية');
          onClose();
        } catch (error) {
          showMessage('تعذّرت الاستعادة', errorMessage(error));
          setBusy(false);
        }
      },
    });
  };

  const preview = opened ? backupPreview(opened) : null;

  return (
    <FormSheet
      visible
      title="استعادة نسخة احتياطية"
      onCancel={onClose}
      onSave={opened ? apply : open}
      saveLabel={opened ? 'استعادة' : 'فتح'}
      saveDisabled={busy}>
      {!opened && file.encrypted && (
        <>
          <Text style={styles.hint}>النسخة دي محمية بكلمة سر.</Text>
          <FieldLabel>كلمة السر</FieldLabel>
          <FormInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            onSubmitEditing={open}
          />
        </>
      )}

      {busy && (
        <View style={styles.busy}>
          <ActivityIndicator color={Colors.light.tint} />
          {file.encrypted && !opened && <Text style={styles.hint}>جاري فك التشفير… ممكن ياخد ثواني</Text>}
        </View>
      )}

      {preview && (
        <View style={styles.preview}>
          <Row label="تاريخ التصدير" value={formatDate(preview.exportedAt)} />
          <Row label="الحسابات" value={String(preview.accounts)} />
          <Row label="المعاملات" value={String(preview.transactions)} />
          <Row label="الاستثمارات" value={String(preview.holdings)} />
          <Row label="الصناديق" value={String(preview.funds)} />
          <Row label="صافي الثروة" value={formatCurrency(preview.netWorthEGP, 'EGP')} />
          {opened && opened.schemaVersion < 4 && (
            <Text style={styles.hint}>النسخة من إصدار أقدم وهتتحدث تلقائياً.</Text>
          )}
          <Text style={[styles.hint, styles.warning]}>الاستعادة هتستبدل كل بياناتك الحالية.</Text>
        </View>
      )}
    </FormSheet>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: {
    fontSize: 12,
    color: Colors.light.icon,
    textAlign: 'right',
    marginTop: 8,
  },
  warning: {
    color: FinanceColors.expense,
  },
  busy: {
    marginTop: 20,
    alignItems: 'center',
    gap: 8,
  },
  preview: {
    marginTop: 8,
    padding: 14,
    borderRadius: 10,
    backgroundColor: FinanceColors.cardBackground,
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: 14,
    color: Colors.light.icon,
  },
  value: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.text,
  },
});
