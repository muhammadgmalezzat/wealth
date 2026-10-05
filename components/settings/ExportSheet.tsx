import { getRandomBytes } from 'expo-crypto';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { FormField } from '@/components/ui/FormField';
import { FormInput, FormSheet } from '@/components/ui/FormSheet';
import { InsightCard } from '@/components/ui/InsightCard';
import { Segment } from '@/components/ui/Segment';
import { colors, space } from '@/constants/theme';
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
  // Inline copy of the password checks' messages (the alerts stay).
  const [pwError, setPwError] = useState<{ password?: string; confirm?: string }>({});

  const handleExport = async () => {
    if (encrypt) {
      if (password.length < MIN_PASSWORD_LENGTH) {
        setPwError({ password: `كلمة السر لازم تكون ${MIN_PASSWORD_LENGTH} حروف على الأقل` });
        showMessage('تنبيه', `كلمة السر لازم تكون ${MIN_PASSWORD_LENGTH} حروف على الأقل`);
        return;
      }
      if (password !== confirm) {
        setPwError({ confirm: 'كلمتين السر مش متطابقين' });
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
      <Segment<'yes' | 'no'>
        options={[
          { label: 'بكلمة سر (موصى به)', value: 'yes' },
          { label: 'بدون كلمة سر', value: 'no' },
        ]}
        value={encrypt ? 'yes' : 'no'}
        onChange={(v) => setEncrypt(v === 'yes')}
      />

      {encrypt ? (
        <>
          <FormField label="كلمة السر" helper={`${MIN_PASSWORD_LENGTH} حروف على الأقل.`} error={pwError.password}>
            <FormInput
              value={password}
              onChangeText={(t) => {
                setPassword(t);
                setPwError({});
              }}
              secureTextEntry
              autoCapitalize="none"
              accessibilityLabel="كلمة السر"
            />
          </FormField>
          <FormField
            label="تأكيد كلمة السر"
            helper="كلمة السر مش بتتحفظ في أي مكان. لو نسيتها مش هتقدر تفتح النسخة دي."
            error={pwError.confirm}>
            <FormInput
              value={confirm}
              onChangeText={(t) => {
                setConfirm(t);
                setPwError({});
              }}
              secureTextEntry
              autoCapitalize="none"
              accessibilityLabel="تأكيد كلمة السر"
            />
          </FormField>
        </>
      ) : (
        <View style={styles.warning}>
          <InsightCard tone="attention" message="النسخة هتبقى مقروءة لأي حد يوصله الملف (كل أرصدتك ومعاملاتك)." />
        </View>
      )}

      {busy && (
        <View style={styles.busy}>
          <ActivityIndicator color={colors.primary700} />
          <AppText variant="caption" color="textSecondary" align="center">
            {encrypt ? 'جاري التشفير… ممكن ياخد ثواني' : 'جاري التجهيز…'}
          </AppText>
        </View>
      )}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  warning: { marginTop: space.lg },
  busy: { marginTop: space.xl, alignItems: 'center', gap: space.sm },
});
