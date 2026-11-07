import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBackground } from '@/components/ui/AppBackground';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { colors, radius, space } from '@/constants/theme';
import type { HydrationFailure } from '@/store/hydration';
import { readRawStoredData, retryHydration, useHydrationFailure } from '@/store/useFinanceStore';
import { saveBackupFile } from '@/utils/backupFiles';
import { toDateKey } from '@/utils/dates';
import { showMessage } from '@/utils/dialogs';
import { errorMessage } from '@/utils/errorMessages';

function explanation(failure: HydrationFailure): string {
  switch (failure.kind) {
    case 'unsupported_version':
      return `بياناتك اتحفظت بنسخة أحدث من التطبيق (إصدار البيانات ${failure.storedVersion}، والنسخة دي بتفهم لحد ${failure.supportedVersion}). حدّث التطبيق لآخر نسخة.`;
    case 'migration_failed':
      return 'حصلت مشكلة وإحنا بنحدّث شكل بياناتك للنسخة دي.';
    case 'unreadable':
      return 'مش قادرين نقرا البيانات المحفوظة على الموبايل.';
  }
}

// Shown instead of the app when the stored data could not be opened (unreadable, newer than this
// build, or its migration failed). Nothing was written to the stored data (see store/hydration.ts):
// the screen's whole job is to let the user keep a copy of it and try again.
export function HydrationErrorGate() {
  const insets = useSafeAreaInsets();
  const failure = useHydrationFailure((s) => s.failure);
  const [busy, setBusy] = useState<'export' | 'retry' | null>(null);

  if (!failure) return null;

  const exportRaw = async () => {
    setBusy('export');
    try {
      const raw = await readRawStoredData();
      if (!raw) {
        showMessage('مفيش بيانات', 'مفيش بيانات محفوظة على الموبايل نصدّرها.');
        return;
      }
      // "*.backup.json" is git-ignored; the file is the stored JSON as is (not encrypted).
      await saveBackupFile(`wealth-raw-${toDateKey(new Date())}.backup.json`, raw);
    } catch (error) {
      showMessage('تعذّر التصدير', errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const retry = async () => {
    setBusy('retry');
    try {
      await retryHydration();
    } catch (error) {
      showMessage('تعذّر المحاولة', errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    // onRequestClose: the Android back button must not dismiss it.
    <Modal visible animationType="none" presentationStyle="fullScreen" statusBarTranslucent navigationBarTranslucent onRequestClose={() => {}}>
      <AppBackground />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xl, paddingLeft: insets.left + space.lg, paddingRight: insets.right + space.lg },
        ]}>
        <View style={styles.disc}>
          <MaterialIcons name="error-outline" size={36} color={colors.warning} />
        </View>
        <AppText variant="title" align="center">
          مش قادرين نفتح بياناتك
        </AppText>
        <AppText variant="body" align="center" color="textSecondary">
          {explanation(failure)}
        </AppText>
        <AppText variant="bodyStrong" align="center">
          ماتقلقش: مفيش حاجة اتمسحت ولا اتغيّرت، وبياناتك لسه زي ما هي على الموبايل.
        </AppText>
        <AppText variant="secondary" align="center" color="textSecondary">
          قبل أي حاجة تانية، صدّر نسخة من البيانات واحتفظ بيها. الملف مش مشفّر، فخلّيه عندك بس.
        </AppText>
        <View style={styles.actions}>
          <Button label="صدّر البيانات الخام" icon="file-download" block loading={busy === 'export'} disabled={busy !== null} onPress={exportRaw} />
          <Button label="حاول تاني" variant="secondary" icon="refresh" block loading={busy === 'retry'} disabled={busy !== null} onPress={retry} />
        </View>
        <AppText variant="micro" align="left" color="textMuted" style={styles.detail} selectable>
          {failure.message}
        </AppText>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', gap: space.md },
  disc: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    backgroundColor: colors.warningSurface,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: space.sm,
  },
  actions: { gap: space.sm, marginTop: space.lg },
  // Technical detail, left-to-right like the error text itself.
  detail: { marginTop: space.lg, writingDirection: 'ltr' },
});
