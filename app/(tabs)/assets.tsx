import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ACCOUNT_TYPE_ICONS, groupAccounts, holdingTitle, LOCATION_LABELS, signedDifference } from '@/components/assets/assetsUi';
import { EditAccountSheet } from '@/components/assets/EditAccountSheet';
import { HoldingSheet } from '@/components/assets/HoldingSheet';
import { TransactionSheet } from '@/components/transactions/TransactionSheet';
import { AmountInput } from '@/components/ui/AmountInput';
import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Fab, FAB_CLEARANCE } from '@/components/ui/Fab';
import { FormField } from '@/components/ui/FormField';
import { FormInput, FormSheet } from '@/components/ui/FormSheet';
import { formatMoney } from '@/components/ui/formatMoney';
import { ListGroup, ListRow } from '@/components/ui/ListRow';
import { LoadingView } from '@/components/ui/LoadingView';
import { MetricGroup } from '@/components/ui/MetricGroup';
import { Money } from '@/components/ui/Money';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Segment } from '@/components/ui/Segment';
import { StatusChip } from '@/components/ui/StatusChip';
import { colors, opacity, space } from '@/constants/theme';
import {
  accountBalance,
  accountBalanceEGP,
  goldTotals,
  holdingPnlEGP,
  holdingsTotalEGP,
  holdingValueEGP,
  liabilitiesTotalEGP,
  liabilityRemaining,
  liquidTotalEGP,
  totalAssetsEGP,
} from '@/store/selectors';
import type { Account, CurrencyCode, GoldKarat, Holding, Location } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { toEGP } from '@/utils/currency';
import { showMessage } from '@/utils/dialogs';
import { currencySymbol } from '@/utils/formatters';
import { runAction } from '@/utils/runAction';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type FormType = Account['type'] | 'gold';
type KaratOption = `${GoldKarat}`;

interface FormState {
  type: FormType;
  name: string;
  amount: string;
  currency: CurrencyCode;
  weightGrams: string;
  karat: KaratOption;
  purchasePrice: string;
  location: Location;
}

const INITIAL_FORM: FormState = {
  type: 'cash',
  name: '',
  amount: '',
  currency: 'EGP',
  weightGrams: '',
  karat: '24',
  purchasePrice: '',
  location: 'EG',
};

// ---------------------------------------------------------------------------
// Main screen — "What do I own?": balances first, value differences secondary.
// ---------------------------------------------------------------------------
export default function AssetsScreen() {
  const state = useFinanceStore();
  const { accounts, holdings, addAccount, addHolding } = state;

  const [modalVisible, setModalVisible] = useState(false);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [holdingId, setHoldingId] = useState<string | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [buyingGold, setBuyingGold] = useState(false);

  if (!state.hasHydrated) return <LoadingView />;

  const editingAccount = accounts.find((a) => a.id === editingAccountId);
  const openHolding = holdings.find((h) => h.id === holdingId);
  const groups = groupAccounts(accounts);
  const gold = holdings.filter((h) => h.type === 'gold');
  const otherHoldings = holdings.filter((h) => h.type !== 'gold');
  const totals = goldTotals(state);
  const fundOf = (holdingIdToFind: string) => state.funds.find((f) => f.linkedHoldingIds.includes(holdingIdToFind))?.name;

  // Helpers
  const set = <K extends keyof FormState>(key: K, val: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  const handleSubmit = () => {
    const name = form.name.trim();
    if (!name) {
      showMessage('تنبيه', 'الرجاء إدخال اسم الأصل');
      return;
    }
    const { type } = form;
    const saved =
      type === 'gold'
        ? runAction('تعذّر الحفظ', () =>
            addHolding({
              type: 'gold',
              name,
              weightGrams: parseFloat(form.weightGrams) || 0,
              karat: Number(form.karat) as GoldKarat,
              location: form.location,
              // Entered in the selected currency; holdings store cost in EGP.
              purchaseCostEGP: toEGP(
                parseFloat(form.purchasePrice) || 0,
                form.currency,
                state.settings.exchangeRates
              ),
            })
          )
        : runAction('تعذّر الحفظ', () =>
            addAccount({
              name,
              type,
              currency: form.currency,
              openingBalance: parseFloat(form.amount) || 0,
              location: form.location,
            })
          );
    if (saved) {
      setForm(INITIAL_FORM);
      setModalVisible(false);
    }
  };

  const openModal = (type: FormType = INITIAL_FORM.type) => {
    setForm({ ...INITIAL_FORM, type });
    setModalVisible(true);
  };

  const accountRow = (account: Account) => (
    <ListRow
      key={account.id}
      title={account.name}
      subtitle={`${LOCATION_LABELS[account.location]} · ${currencySymbol(account.currency)}`}
      subtitleLines={1}
      icon={ACCOUNT_TYPE_ICONS[account.type]}
      archived={account.archived}
      trailing={
        <Money
          amount={accountBalance(state, account.id)}
          currency={account.currency}
          align="left"
          converted={account.currency !== 'EGP' ? { amount: accountBalanceEGP(state, account), currency: 'EGP' } : undefined}
        />
      }
      onPress={() => setEditingAccountId(account.id)}
    />
  );

  const holdingRow = (holding: Holding) => {
    const fundName = fundOf(holding.id);
    const hasCost = holding.purchaseCostEGP > 0;
    return (
      <ListRow
        key={holding.id}
        title={holdingTitle(holding)}
        subtitle={`${LOCATION_LABELS[holding.location ?? 'EG']} · القيمة الحالية`}
        subtitleLines={1}
        icon={holding.type === 'gold' ? 'diamond' : 'payments'}
        iconTone={holding.type === 'gold' ? 'gold' : 'neutral'}
        trailing={<Money amount={holdingValueEGP(state, holding)} currency="EGP" align="left" />}
        accessory={
          hasCost || fundName ? (
            <View style={styles.holdingMeta}>
              {hasCost && (
                <AppText variant="caption" color="textSecondary" style={styles.tabular}>
                  تكلفة الشراء {formatMoney(holding.purchaseCostEGP, 'EGP')} · فرق القيمة{' '}
                  {signedDifference(holdingPnlEGP(state, holding))}
                </AppText>
              )}
              {fundName && <StatusChip label={`مربوط بـ ${fundName}`} tone="gold" icon="link" />}
            </View>
          ) : undefined
        }
        onPress={() => setHoldingId(holding.id)}
      />
    );
  };

  return (
    <Screen
      scroll
      contentStyle={styles.content}
      overlay={<Fab placement="tab" onPress={() => openModal()} accessibilityLabel="إضافة أصل" />}>
      {/* ── Hero ── */}
      <Card variant="hero" style={styles.hero}>
        <AppText variant="secondary" color="textSecondary">
          إجمالي الأصول
        </AppText>
        <Money amount={totalAssetsEGP(state)} currency="EGP" size="lg" />
        <MetricGroup
          metrics={[
            { label: 'سيولة', value: <Money amount={liquidTotalEGP(state)} currency="EGP" align="center" /> },
            {
              label: 'ذهب واستثمارات',
              tone: 'gold',
              value: <Money amount={holdingsTotalEGP(state)} currency="EGP" align="center" />,
            },
            ...(state.liabilities.length > 0
              ? [{ label: 'التزامات', value: <Money amount={liabilitiesTotalEGP(state)} currency="EGP" align="center" /> }]
              : []),
          ]}
        />
      </Card>

      {/* ── Accounts ── */}
      <View>
        <SectionHeader title="الحسابات" actionLabel="+ حساب" onAction={() => openModal('cash')} />
        {accounts.length === 0 ? (
          <AppText variant="secondary" color="textSecondary">
            لسه مفيش حسابات.
          </AppText>
        ) : (
          <View style={styles.groups}>
            {(['EG', 'SA'] as Location[]).map((loc) =>
              groups[loc].length === 0 ? null : (
                <View key={loc} style={styles.group}>
                  <AppText variant="caption" color="textSecondary">
                    {LOCATION_LABELS[loc]}
                  </AppText>
                  <ListGroup>{groups[loc].map(accountRow)}</ListGroup>
                </View>
              )
            )}
            {groups.archived.length > 0 && (
              <View style={styles.group}>
                <Pressable
                  onPress={() => setArchivedOpen((v) => !v)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: archivedOpen }}
                  style={({ pressed }) => [styles.toggle, pressed && { opacity: opacity.pressed }]}>
                  <AppText variant="caption" color="textSecondary">
                    مؤرشفة ({groups.archived.length})
                  </AppText>
                  <MaterialIcons name={archivedOpen ? 'expand-less' : 'expand-more'} size={20} color={colors.textSecondary} />
                </Pressable>
                {archivedOpen && <ListGroup>{groups.archived.map(accountRow)}</ListGroup>}
              </View>
            )}
          </View>
        )}
      </View>

      {/* ── Gold ── */}
      <View>
        <SectionHeader
          title="الذهب"
          trailing={
            gold.length > 0 ? (
              <AppText variant="secondary" color="textSecondary" style={styles.tabular}>
                {totals.totalGrams} جم
              </AppText>
            ) : undefined
          }
        />
        {gold.length === 0 ? (
          <Card variant="subtle">
            <EmptyState
              icon="diamond"
              title="لسه معندكش ذهب مسجل."
              body="سجّل شراء الذهب كأصل عشان يتحسب في ثروتك ويدعم أهدافك."
              actionLabel="سجّل شراء ذهب"
              onAction={() => setBuyingGold(true)}
            />
          </Card>
        ) : (
          <ListGroup>{gold.map(holdingRow)}</ListGroup>
        )}
      </View>

      {/* ── Other investments (only if present) ── */}
      {otherHoldings.length > 0 && (
        <View>
          <SectionHeader title="استثمارات تانية" />
          <ListGroup>{otherHoldings.map(holdingRow)}</ListGroup>
        </View>
      )}

      {/* ── Liabilities (only if present) ── */}
      {state.liabilities.length > 0 && (
        <View>
          <SectionHeader title="الالتزامات" />
          <ListGroup>
            {state.liabilities.map((l) => (
              <ListRow
                key={l.id}
                title={l.name}
                subtitle={
                  l.monthlyPayment
                    ? `قسط شهري ${formatMoney(l.monthlyPayment, l.currency)} · من أصل ${formatMoney(l.principal, l.currency)}`
                    : `من أصل ${formatMoney(l.principal, l.currency)}`
                }
                subtitleLines={2}
                icon="event-note"
                trailing={<Money amount={liabilityRemaining(state, l)} currency={l.currency} align="left" />}
              />
            ))}
          </ListGroup>
        </View>
      )}

      {editingAccount && (
        <EditAccountSheet key={editingAccount.id} account={editingAccount} onClose={() => setEditingAccountId(null)} />
      )}
      {openHolding && (
        <HoldingSheet
          key={openHolding.id}
          holding={openHolding}
          fundName={fundOf(openHolding.id)}
          onClose={() => setHoldingId(null)}
        />
      )}
      {buyingGold && <TransactionSheet initialType="asset_purchase" onClose={() => setBuyingGold(false)} />}

      {/* ── Add asset (opening balance / gold you already own) ── */}
      <FormSheet visible={modalVisible} title="إضافة أصل" onCancel={() => setModalVisible(false)} onSave={handleSubmit}>
        <Segment<FormType>
          options={[
            { label: 'نقدي', value: 'cash' },
            { label: 'بنك', value: 'bank' },
            { label: 'محفظة', value: 'wallet' },
            { label: 'ذهب', value: 'gold' },
          ]}
          value={form.type}
          onChange={(v) => set('type', v)}
        />

        <FormField label="الاسم">
          <FormInput value={form.name} onChangeText={(v) => set('name', v)} placeholder="مثال: محفظة ريالات" />
        </FormField>

        {form.type !== 'gold' && (
          <FormField label="المبلغ">
            <AmountInput value={form.amount} onChangeText={(v) => set('amount', v)} currency={form.currency} allowZero />
          </FormField>
        )}

        <FormField label="المكان">
          <Segment<Location>
            options={[
              { label: 'مصر', value: 'EG' },
              { label: 'السعودية', value: 'SA' },
            ]}
            value={form.location}
            onChange={(v) => set('location', v)}
          />
        </FormField>

        <FormField label="العملة">
          <Segment<CurrencyCode>
            options={[
              { label: 'ج.م', value: 'EGP' },
              { label: 'ر.س', value: 'SAR' },
              { label: '$', value: 'USD' },
            ]}
            value={form.currency}
            onChange={(v) => set('currency', v)}
          />
        </FormField>

        {form.type === 'gold' && (
          <>
            <FormField label="الوزن (جرام)">
              <FormInput value={form.weightGrams} onChangeText={(v) => set('weightGrams', v)} placeholder="0" keyboardType="decimal-pad" />
            </FormField>
            <FormField label="العيار">
              <Segment<KaratOption>
                options={[
                  { label: 'عيار 24', value: '24' },
                  { label: 'عيار 21', value: '21' },
                  { label: 'عيار 18', value: '18' },
                ]}
                value={form.karat}
                onChange={(v) => set('karat', v)}
              />
            </FormField>
            <FormField label="سعر الشراء (بالعملة المختارة)" helper="ذهب عندك من قبل؛ لو اشتريته دلوقتي سجّله من «شراء ذهب» في المعاملات.">
              <FormInput value={form.purchasePrice} onChangeText={(v) => set('purchasePrice', v)} placeholder="0" keyboardType="decimal-pad" />
            </FormField>
          </>
        )}
      </FormSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: FAB_CLEARANCE, gap: space.xl },
  hero: { gap: space.sm },
  groups: { gap: space.md },
  group: { gap: space.xs },
  toggle: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.xs, minHeight: 36 },
  holdingMeta: { gap: space.xs, marginTop: 2 },
  tabular: { fontVariant: ['tabular-nums'] },
});
