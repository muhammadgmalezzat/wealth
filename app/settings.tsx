import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Switch, View } from 'react-native';

import { ExportSheet } from '@/components/settings/ExportSheet';
import { RestoreSheet } from '@/components/settings/RestoreSheet';
import {
  BACKUP_NUDGE,
  backupAgeLabel,
  parsePremiumPct,
  PRICE_SOURCE_OPTIONS,
  priceErrorMessage,
  priceStatusLine,
} from '@/components/settings/settingsUi';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FutureDateField } from '@/components/ui/DateFields';
import { FormField } from '@/components/ui/FormField';
import { FormInput } from '@/components/ui/FormSheet';
import { formatDateAr } from '@/components/ui/formatDateAr';
import { formatMoney } from '@/components/ui/formatMoney';
import { ListGroup, ListRow } from '@/components/ui/ListRow';
import { LoadingView } from '@/components/ui/LoadingView';
import { Money } from '@/components/ui/Money';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Segment } from '@/components/ui/Segment';
import { StatusChip } from '@/components/ui/StatusChip';
import { colors, opacity, space } from '@/constants/theme';
import { openBackup, parseBackup, type BackupFile, type OpenedBackup } from '@/store/backup';
import { daysSinceBackup, needsBackupReminder } from '@/store/nextActions';
import type { PriceSource } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { appInfo } from '@/utils/appInfo';
import { appLockAvailability, authenticate, type LockAvailability } from '@/utils/appLock';
import { pickBackupFile } from '@/utils/backupFiles';
import { confirmAction, showMessage } from '@/utils/dialogs';
import { errorMessage } from '@/utils/errorMessages';
import { newId } from '@/utils/id';
import { enableReminders, notificationsAvailable } from '@/utils/notifications';
import { parseAmount } from '@/utils/parseAmount';
import { isValidPremiumPct } from '@/utils/prices/calc';
import { FX_ATTRIBUTION_URL, priceSourceOf } from '@/utils/prices/fetchPrices';

import { runAction } from '@/utils/runAction';

export default function SettingsScreen() {
  const state = useFinanceStore();
  const { settings } = state;
  // Home's backup action links here with ?export=1.
  const params = useLocalSearchParams<{ export?: string }>();

  const [sarText, setSarText] = useState(String(settings.exchangeRates.SAR_EGP));
  const [usdText, setUsdText] = useState(String(settings.exchangeRates.USD_EGP));
  const [gold24Text, setGold24Text] = useState(String(settings.goldPrice24kEGP));
  const [gold21Text, setGold21Text] = useState(String(settings.goldPrice21kEGP));
  const [premiumText, setPremiumText] = useState(String(settings.localPremiumPct ?? 0));
  const [refreshing, setRefreshing] = useState(false);
  const [trackingStart, setTrackingStart] = useState<string | undefined>(settings.trackingStartDate);
  const [importing, setImporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(params.export === '1');
  const [restore, setRestore] = useState<{ file: BackupFile; opened?: OpenedBackup } | null>(null);
  const [lock, setLock] = useState<LockAvailability | null>(null);
  // "تفاصيل تقنية" (runtime / channel / update) stays collapsed by default.
  const [techOpen, setTechOpen] = useState(false);

  useEffect(() => {
    appLockAvailability().then(setLock);
  }, []);

  if (!state.hasHydrated) return <LoadingView />;

  const gold24 = parseAmount(gold24Text);
  const priceSource = priceSourceOf(settings);
  const auto = priceSource === 'auto';

  const handleSave = () => {
    const tracking = trackingStart ? { trackingStartDate: trackingStart } : {};
    const saved = runAction('تعذّر الحفظ', () => {
      if (auto) {
        // Prices come from the APIs; only the premium and the tracking start are the user's.
        state.setPricePreferences({ localPremiumPct: parsePremiumPct(premiumText) ?? NaN });
        state.updateSettings(tracking);
      } else {
        state.updateSettings({
          exchangeRates: { SAR_EGP: parseAmount(sarText) ?? NaN, USD_EGP: parseAmount(usdText) ?? NaN },
          goldPrice24kEGP: gold24 ?? NaN,
          goldPrice21kEGP: parseAmount(gold21Text) ?? NaN,
          ...tracking,
        });
      }
    });
    if (saved) showMessage('تم', 'اتحفظت الإعدادات');
  };

  const changePriceSource = (next: PriceSource) => {
    if (next === priceSource) return;
    if (!runAction('تعذّر الحفظ', () => state.setPricePreferences({ priceSource: next }))) return;
    if (next === 'auto') {
      refreshNow();
    } else {
      // Manual starts from the prices currently in use.
      const current = useFinanceStore.getState().settings;
      setSarText(String(current.exchangeRates.SAR_EGP));
      setUsdText(String(current.exchangeRates.USD_EGP));
      setGold24Text(String(current.goldPrice24kEGP));
      setGold21Text(String(current.goldPrice21kEGP));
    }
  };

  // refreshPrices never throws; the result shows through settings (status line / error).
  const refreshNow = async () => {
    // A premium typed but not saved yet applies to this refresh too.
    const premium = parsePremiumPct(premiumText);
    if (premium !== null && isValidPremiumPct(premium)) state.setPricePreferences({ localPremiumPct: premium });
    setRefreshing(true);
    await useFinanceStore.getState().refreshPrices({ force: true });
    setRefreshing(false);
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

  const toggleDueReminders = async (enabled: boolean) => {
    if (enabled && !(await enableReminders())) {
      showMessage('التنبيهات مقفولة', 'اسمح للتطبيق بالإشعارات من إعدادات الموبايل وجرب تاني');
      return;
    }
    state.setDueNotifications(enabled);
  };

  const info = appInfo();
  const techLine = [
    `runtime ${info.runtimeVersion ?? '—'}`,
    info.channel ? `القناة ${info.channel}` : null,
    `التحديث ${info.updateId ? info.updateId.slice(0, 8) : 'المدمج في التطبيق'}`,
  ]
    .filter(Boolean)
    .join(' · ');

  // Same rule as Home's backup action.
  const backupDays = daysSinceBackup(settings.lastBackupAt);
  const backupOverdue = needsBackupReminder(settings.lastBackupAt);

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
    <Screen scroll edges={['bottom']} contentStyle={styles.content}>
      {/* ── السوق ── */}
      <View>
        <SectionHeader title="السوق" />
        <View style={styles.source}>
          <Segment options={PRICE_SOURCE_OPTIONS} value={priceSource} onChange={changePriceSource} />
        </View>
        {auto ? (
          <View style={styles.market}>
            <ListGroup>
              <ListRow title="ريال سعودي ← جنيه" trailing={<Money amount={settings.exchangeRates.SAR_EGP} currency="EGP" />} />
              <ListRow title="دولار ← جنيه" trailing={<Money amount={settings.exchangeRates.USD_EGP} currency="EGP" />} />
              <ListRow
                title="جرام ذهب عيار 24"
                trailing={<Money amount={settings.goldPrice24kEGP} currency="EGP" />}
              />
              <ListRow
                title="جرام ذهب عيار 21"
                subtitle={`عيار 18 (محسوب): ${formatMoney(settings.goldPrice24kEGP * 0.75, 'EGP')}`}
                trailing={<Money amount={settings.goldPrice21kEGP} currency="EGP" />}
              />
            </ListGroup>
            <View style={styles.status}>
              <AppText variant="caption" color="textSecondary">
                {priceStatusLine(settings)}
              </AppText>
              {settings.lastPriceFetchError && (
                <AppText variant="caption" color="warning">
                  {priceErrorMessage(settings.lastPriceFetchError)}
                </AppText>
              )}
              <AppText variant="caption" color="textSecondary">
                السعر محسوب من السعر العالمي، مش شامل المصنعية.
              </AppText>
              {settings.fxSource === 'open.er-api' && (
                <Pressable
                  onPress={() => Linking.openURL(FX_ATTRIBUTION_URL)}
                  accessibilityRole="link"
                  hitSlop={8}
                  style={({ pressed }) => pressed && { opacity: opacity.pressed }}>
                  <AppText variant="caption" color="primary700">
                    أسعار العملات من ExchangeRate-API
                  </AppText>
                </Pressable>
              )}
            </View>
            <Card style={styles.market}>
            <FormField
              label="فرق السوق المحلي %"
              helper="السعر العالمي بيختلف عن سعر محلات الذهب؛ زوّد أو قلّل النسبة لحد ما يقرب من السعر اللي بتشتري بيه">
              <FormInput value={premiumText} onChangeText={setPremiumText} keyboardType="numbers-and-punctuation" />
            </FormField>
            <Button label="تحديث الأسعار الآن" variant="secondary" icon="refresh" block loading={refreshing} onPress={refreshNow} />
            </Card>
          </View>
        ) : (
          <Card>
            <FormField label="ريال سعودي ← جنيه">
              <FormInput value={sarText} onChangeText={setSarText} keyboardType="decimal-pad" />
            </FormField>
            <FormField label="دولار ← جنيه" helper={`آخر تحديث: ${formatDateAr(settings.exchangeRates.lastUpdated)}`}>
              <FormInput value={usdText} onChangeText={setUsdText} keyboardType="decimal-pad" />
            </FormField>
            <FormField label="سعر جرام الذهب عيار 24 (جنيه)">
              <FormInput value={gold24Text} onChangeText={setGold24Text} keyboardType="decimal-pad" />
            </FormField>
            <FormField label="سعر جرام الذهب عيار 21 (جنيه)">
              <FormInput value={gold21Text} onChangeText={setGold21Text} keyboardType="decimal-pad" />
            </FormField>
            <View style={styles.helpers}>
              {gold24 !== null && (
                <AppText variant="caption" color="textSecondary">
                  عيار 18 (محسوب): {formatMoney(gold24 * 0.75, 'EGP')}
                </AppText>
              )}
              <AppText variant="caption" color="textSecondary">
                آخر تحديث للذهب: {formatDateAr(settings.goldPriceUpdatedAt)}
              </AppText>
            </View>
          </Card>
        )}
      </View>

      {/* ── التخطيط ── */}
      <View>
        <SectionHeader title="التخطيط" />
        <Card>
          <FormField label="بداية التتبع" helper="المعاملات قبل التاريخ ده مش بتدخل في ملخص الشهر.">
            <FutureDateField value={trackingStart} onChange={setTrackingStart} />
          </FormField>
          {/* The only primary on the screen: saves rates, gold prices and the tracking start. */}
          <View style={styles.save}>
            <Button label="حفظ الإعدادات" block onPress={handleSave} />
          </View>
        </Card>
        <View style={styles.listGap}>
          <ListGroup>
            <ListRow title="الأصول" subtitle="الحسابات والذهب" icon="account-balance-wallet" chevron onPress={() => router.push('/assets')} />
            <ListRow title="إدارة البنود" icon="category" chevron onPress={() => router.push('/categories')} />
            <ListRow title="المعاملات المتكررة" icon="repeat" chevron onPress={() => router.push('/recurring')} />
            <ListRow
              title="تنبيهات المستحقات"
              subtitle={
                notificationsAvailable()
                  ? 'تنبيه الساعة 10 الصبح يوم استحقاق أي معاملة متكررة بتأكيد'
                  : Platform.OS === 'web'
                    ? 'التنبيهات متاحة على الموبايل بس'
                    : 'متاحة في التطبيق المثبت بس، مش في Expo Go'
              }
              icon="notifications-none"
              trailing={
                <Switch
                  value={notificationsAvailable() && !!settings.dueNotificationsEnabled}
                  onValueChange={toggleDueReminders}
                  disabled={!notificationsAvailable()}
                  trackColor={{ true: colors.primary600, false: colors.borderStrong }}
                  thumbColor={colors.text}
                  accessibilityLabel="تنبيهات المستحقات"
                />
              }
            />
          </ListGroup>
        </View>
      </View>

      {/* ── البيانات ── */}
      <View>
        <SectionHeader title="البيانات" />
        <Card style={styles.backup}>
          <View style={styles.backupRow}>
            <AppText variant="bodyStrong" style={styles.flex}>
              آخر نسخة احتياطية
            </AppText>
            <AppText variant="secondary" color="textSecondary">
              {backupAgeLabel(backupDays)}
            </AppText>
          </View>
          {backupOverdue && (
            <View style={styles.overdue}>
              <StatusChip label="محتاج نسخة" tone="attention" icon="schedule" />
              <AppText variant="secondary">{BACKUP_NUDGE}</AppText>
            </View>
          )}
          <Button label="تصدير نسخة" variant="secondary" icon="file-upload" block onPress={() => setExportOpen(true)} />
        </Card>
        <View style={styles.listGap}>
          <ListGroup>
            <ListRow title="استعادة نسخة" icon="restore" chevron onPress={handlePickBackup} />
            <ListRow
              title={importing ? 'جاري الاستيراد…' : 'استيراد البيانات الافتتاحية'}
              subtitle="استبدال كل البيانات بالوضع الافتتاحي (الحسابات والذهب والمعاملات الأولى)."
              icon="download"
              chevron
              onPress={importing ? undefined : handleImport}
            />
          </ListGroup>
        </View>
      </View>

      {/* ── الأمان ── */}
      <View>
        <SectionHeader title="الأمان" />
        <ListGroup>
          <ListRow
            title="قفل التطبيق"
            subtitle={lock && !lock.available ? lock.reason : 'بيستخدم قفل الجهاز (بصمة أو رقم سري).'}
            icon="lock-outline"
            trailing={
              <Switch
                value={!!settings.appLockEnabled}
                onValueChange={toggleAppLock}
                disabled={!lock?.available}
                trackColor={{ true: colors.primary600, false: colors.borderStrong }}
                thumbColor={colors.text}
                accessibilityLabel="قفل التطبيق"
              />
            }
          />
        </ListGroup>
      </View>

      {/* ── عن التطبيق ── */}
      <View>
        <SectionHeader title="عن التطبيق" />
        <ListGroup>
          <ListRow
            title="الإصدار"
            trailing={
              <AppText variant="bodyStrong" align="left" style={styles.tabular}>
                {info.version}
              </AppText>
            }
          />
          <ListRow
            title="تفاصيل تقنية"
            icon={techOpen ? 'expand-less' : 'expand-more'}
            onPress={() => setTechOpen((v) => !v)}
            accessibilityLabel={techOpen ? 'إخفاء التفاصيل التقنية' : 'عرض التفاصيل التقنية'}
          />
        </ListGroup>
        {techOpen && (
          <AppText variant="caption" color="textSecondary" style={styles.tech}>
            {techLine}
          </AppText>
        )}
      </View>

      {exportOpen && <ExportSheet onClose={() => setExportOpen(false)} />}
      {restore && (
        <RestoreSheet file={restore.file} initialOpened={restore.opened} onClose={() => setRestore(null)} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.lg },
  helpers: { marginTop: space.md, gap: space.xxs },
  status: { gap: space.xxs },
  source: { marginBottom: space.md },
  market: { gap: space.md },
  save: { marginTop: space.lg },
  listGap: { marginTop: space.md },
  backup: { gap: space.md },
  backupRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.sm },
  overdue: { gap: space.xs },
  flex: { flex: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
  tech: { marginTop: space.sm, paddingHorizontal: space.sm },
});
