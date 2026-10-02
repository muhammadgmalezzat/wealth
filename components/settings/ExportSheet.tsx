import { getRandomBytes } from 'expo-crypto';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Chip, ChipRow } from '@/components/ui/Chip';
import { FieldLabel, FormInput, FormSheet } from '@/components/ui/FormSheet';
import { Colors, FinanceColors } from '@/constants/theme';
import { backupFileName, createBackup, serializeBackup } from '@/store/backup';
import { dataOf, useFinanceStore } from '@/store/useFinanceStore';
import { saveBackupFile } from '@/utils/backupFiles';
import { showMessage } from '@/utils/dialogs';
import { errorMessage } from '@/utils/errorMessages';

const MIN_PASSWORD_LENGTH = 6;

interface ExportSheetProps {
  onClose: () => void;
}

// "تصدير نسخة احتياطية": builds the backup file (encrypted by default) and hands it to the
// share sheet (native) or downloads it (web).
export function ExportSheet({ onClose }: ExportSheetProps) {
  const markBackedUp = useFinanceStore((s) => s.markBackedUp);
  const [encrypt, setEncrypt] = useState(true);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const handleExport = async () => {
    if (encrypt) {
      if (password.length < MIN_PASSWORD_LENGTH) {
        showMessage('تنبيه', `كلمة السر لازم تكون ${MIN_PASSWORD_LENGTH} حروف على الأقل`);
        return;
      }
      if (password !== confirm) {
        showMessage('تنبيه', 'كلمتين السر مش متطابقين');
        return;
      }
    }
    setBusy(true);
    try {
      const now = new Date();
      const file = await createBackup(dataOf(useFinanceStore.getState()), {
        ...(encrypt ? { password } : {}),
        now,
        crypto: { randomBytes: getRandomBytes },
      });
      await saveBackupFile(backupFileName(now), serializeBackup(file));
      markBackedUp(now.toISOString());
      onClose();
    } catch (error) {
      showMessage('تعذّر التصدير', errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormSheet
      visible
      title="تصدير نسخة احتياطية"
      onCancel={onClose}
      onSave={handleExport}
      saveLabel="تصدير"
      saveDisabled={busy}>
      <ChipRow>
        <Chip label="بكلمة سر (موصى به)" selected={encrypt} onPress={() => setEncrypt(true)} />
        <Chip label="بدون كلمة سر" selected={!encrypt} onPress={() => setEncrypt(false)} />
      </ChipRow>

      {encrypt ? (
        <>
          <FieldLabel>كلمة السر</FieldLabel>
          <FormInput value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
          <FieldLabel>تأكيد كلمة السر</FieldLabel>
          <FormInput value={confirm} onChangeText={setConfirm} secureTextEntry autoCapitalize="none" />
          <Text style={styles.hint}>
            كلمة السر مش بتتحفظ في أي مكان. لو نسيتها مش هتقدر تفتح النسخة دي.
          </Text>
        </>
      ) : (
        <Text style={[styles.hint, styles.warning]}>
          النسخة هتبقى مقروءة لأي حد يوصله الملف (كل أرصدتك ومعاملاتك).
        </Text>
      )}

      {busy && (
        <View style={styles.busy}>
          <ActivityIndicator color={Colors.light.tint} />
          <Text style={styles.hint}>{encrypt ? 'جاري التشفير… ممكن ياخد ثواني' : 'جاري التجهيز…'}</Text>
        </View>
      )}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  hint: {
    fontSize: 12,
    color: Colors.light.icon,
    textAlign: 'right',
    marginTop: 10,
    lineHeight: 18,
  },
  warning: {
    color: FinanceColors.expense,
  },
  busy: {
    marginTop: 20,
    alignItems: 'center',
    gap: 8,
  },
});
