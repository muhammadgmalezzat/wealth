import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { FormField } from '@/components/ui/FormField';
import { FormInput, FormSheet } from '@/components/ui/FormSheet';
import { formatDateAr } from '@/components/ui/formatDateAr';
import { formatMoney } from '@/components/ui/formatMoney';
import { InsightCard } from '@/components/ui/InsightCard';
import { ListGroup, ListRow } from '@/components/ui/ListRow';
import { colors, space } from '@/constants/theme';
import { backupPreview, openBackup, type BackupFile, type OpenedBackup } from '@/store/backup';
import { useFinanceStore } from '@/store/useFinanceStore';
import { confirmAction, showMessage } from '@/utils/dialogs';
import { errorMessage } from '@/utils/errorMessages';
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
  // Inline copy of the open error (e.g. wrong password); the alert stays.
  const [openError, setOpenError] = useState<string | null>(null);

  const open = async () => {
    setBusy(true);
    try {
      setOpened(await openBackup(file, { password, now: new Date(), newId }));
    } catch (error) {
      setOpenError(errorMessage(error));
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
        <FormField label="كلمة السر" helper="النسخة دي محمية بكلمة سر." error={openError}>
          <FormInput
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              setOpenError(null);
            }}
            secureTextEntry
            autoCapitalize="none"
            onSubmitEditing={open}
            accessibilityLabel="كلمة السر"
          />
        </FormField>
      )}

      {busy && (
        <View style={styles.busy}>
          <ActivityIndicator color={colors.primary700} />
          {file.encrypted && !opened && (
            <AppText variant="caption" color="textSecondary" align="center">
              جاري فك التشفير… ممكن ياخد ثواني
            </AppText>
          )}
        </View>
      )}

      {preview && (
        <View style={styles.preview}>
          <InsightCard tone="attention" message="الاستعادة هتستبدل البيانات الحالية." />
          <ListGroup>
            <Row label="تاريخ التصدير" value={formatDateAr(preview.exportedAt)} />
            <Row label="الحسابات" value={String(preview.accounts)} />
            <Row label="المعاملات" value={String(preview.transactions)} />
            <Row label="الاستثمارات" value={String(preview.holdings)} />
            <Row label="الصناديق" value={String(preview.funds)} />
            <Row label="صافي الثروة" value={formatMoney(preview.netWorthEGP, 'EGP')} />
          </ListGroup>
          {opened && opened.schemaVersion < 4 && (
            <AppText variant="caption" color="textSecondary">
              النسخة من إصدار أقدم وهتتحدث تلقائياً.
            </AppText>
          )}
        </View>
      )}
    </FormSheet>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <ListRow
      title={label}
      trailing={
        <AppText variant="bodyStrong" align="left" style={styles.tabular}>
          {value}
        </AppText>
      }
    />
  );
}

const styles = StyleSheet.create({
  busy: { marginTop: space.xl, alignItems: 'center', gap: space.sm },
  preview: { marginTop: space.md, gap: space.md },
  tabular: { fontVariant: ['tabular-nums'] },
});
