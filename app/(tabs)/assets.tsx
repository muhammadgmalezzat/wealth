import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { EditAccountSheet } from '@/components/assets/EditAccountSheet';
import { Card } from '@/components/ui/Card';
import { FieldLabel, FormInput, FormSheet } from '@/components/ui/FormSheet';
import { LoadingView } from '@/components/ui/LoadingView';
import { Segment } from '@/components/ui/Segment';
import { StatCard } from '@/components/ui/StatCard';
import { Colors, FinanceColors } from '@/constants/theme';
import {
  accountBalance,
  accountBalanceEGP,
  holdingPnlEGP,
  holdingsTotalEGP,
  liquidTotalEGP,
  totalAssetsEGP,
} from '@/store/selectors';
import type { Account, CurrencyCode, GoldKarat, Holding, Location } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { toEGP } from '@/utils/currency';
import { confirmAction, showMessage } from '@/utils/dialogs';
import { formatCurrency } from '@/utils/formatters';
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

const ACCOUNT_TYPE_LABELS: Record<Account['type'], string> = {
  cash: 'نقدي',
  bank: 'بنك',
  wallet: 'محفظة',
};

// ---------------------------------------------------------------------------
// Local sub-components
// ---------------------------------------------------------------------------

interface AccountRowProps {
  account: Account;
  balance: number;
  balanceEGP: number;
  onEdit: () => void;
  onDelete: () => void;
}

function AccountRow({ account, balance, balanceEGP, onEdit, onDelete }: AccountRowProps) {
  return (
    <TouchableOpacity style={styles.assetRow} onPress={onEdit} activeOpacity={0.7}>
      {/* Left: derived balance */}
      <View style={styles.assetLeft}>
        <Text style={styles.assetAmount}>{formatCurrency(balance, account.currency)}</Text>
        <Text style={styles.assetEGP}>{formatCurrency(balanceEGP, 'EGP')}</Text>
      </View>
      {/* Right: name + badge */}
      <View style={styles.assetRight}>
        <Text style={styles.assetName}>{account.name}</Text>
        <View style={[styles.badge, { backgroundColor: Colors.light.tint + '22' }]}>
          <Text style={[styles.badgeText, { color: Colors.light.tint }]}>
            {ACCOUNT_TYPE_LABELS[account.type]}
          </Text>
        </View>
      </View>
      {/* Delete */}
      <TouchableOpacity onPress={onDelete} style={styles.deleteBtn} hitSlop={8}>
        <MaterialIcons name="delete-outline" size={20} color={FinanceColors.expense} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

interface HoldingRowProps {
  holding: Holding;
  pnlEGP: number;
  onDelete: () => void;
}

function HoldingRow({ holding, pnlEGP, onDelete }: HoldingRowProps) {
  const hasCost = holding.purchaseCostEGP > 0;
  const isProfit = pnlEGP >= 0;

  return (
    <View style={styles.assetRow}>
      {/* Left: specs + PnL */}
      <View style={styles.assetLeft}>
        <Text style={styles.goldSpec}>
          {holding.type === 'gold'
            ? `${holding.weightGrams}g • ${holding.karat}k`
            : formatCurrency(holding.quantity, holding.currency)}
        </Text>
        {hasCost && (
          <View
            style={[
              styles.pnlBadge,
              { backgroundColor: isProfit ? FinanceColors.income + '20' : FinanceColors.expense + '20' },
            ]}>
            <Text style={[styles.pnlText, { color: isProfit ? FinanceColors.income : FinanceColors.expense }]}>
              {isProfit ? '+' : ''}
              {formatCurrency(pnlEGP, 'EGP')}
            </Text>
          </View>
        )}
      </View>
      {/* Right: name + cost */}
      <View style={styles.assetRight}>
        <Text style={styles.assetName}>{holding.name}</Text>
        {hasCost && (
          <Text style={styles.assetEGP}>{formatCurrency(holding.purchaseCostEGP, 'EGP')}</Text>
        )}
      </View>
      {/* Delete */}
      <TouchableOpacity onPress={onDelete} style={styles.deleteBtn} hitSlop={8}>
        <MaterialIcons name="delete-outline" size={20} color={FinanceColors.expense} />
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------
export default function AssetsScreen() {
  const insets = useSafeAreaInsets();
  const state = useFinanceStore();
  const { accounts, holdings, addAccount, addHolding, deleteAccount, deleteHolding } = state;

  const [modalVisible, setModalVisible] = useState(false);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);

  if (!state.hasHydrated) return <LoadingView />;

  const editingAccount = accounts.find((a) => a.id === editingAccountId);

  // Helpers
  const set = <K extends keyof FormState>(key: K, val: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  const confirmDelete = (name: string, onConfirm: () => void) => {
    confirmAction({
      title: 'حذف الأصل',
      message: `هل تريد حذف "${name}"؟`,
      confirmText: 'حذف',
      cancelText: 'إلغاء',
      onConfirm: () => runAction('تعذّر الحذف', onConfirm),
    });
  };

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

  const openModal = () => {
    setForm(INITIAL_FORM);
    setModalVisible(true);
  };

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
        showsVerticalScrollIndicator={false}>

        {/* ── Summary row ──────────────────────────────────── */}
        <View style={styles.summaryRow}>
          <StatCard label="إجمالي الأصول" amountEGP={totalAssetsEGP(state)} accentColor={Colors.light.tint} />
          <StatCard label="السيولة" amountEGP={liquidTotalEGP(state)} accentColor={Colors.light.tint} />
          <StatCard label="الاستثمارات" amountEGP={holdingsTotalEGP(state)} accentColor={FinanceColors.gold} />
        </View>

        {/* ── Accounts ──────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>الحسابات</Text>
        <Card style={styles.listCard}>
          {accounts.length === 0 ? (
            <Text style={styles.emptyText}>لا توجد حسابات</Text>
          ) : (
            accounts.map((account, idx) => (
              <React.Fragment key={account.id}>
                <AccountRow
                  account={account}
                  balance={accountBalance(state, account.id)}
                  balanceEGP={accountBalanceEGP(state, account)}
                  onEdit={() => setEditingAccountId(account.id)}
                  onDelete={() => confirmDelete(account.name, () => deleteAccount(account.id))}
                />
                {idx < accounts.length - 1 && <View style={styles.divider} />}
              </React.Fragment>
            ))
          )}
        </Card>

        {/* ── Holdings ─────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>الاستثمارات</Text>
        <Card style={styles.listCard}>
          {holdings.length === 0 ? (
            <Text style={styles.emptyText}>لا توجد استثمارات</Text>
          ) : (
            holdings.map((holding, idx) => (
              <React.Fragment key={holding.id}>
                <HoldingRow
                  holding={holding}
                  pnlEGP={holdingPnlEGP(state, holding)}
                  onDelete={() => confirmDelete(holding.name, () => deleteHolding(holding.id))}
                />
                {idx < holdings.length - 1 && <View style={styles.divider} />}
              </React.Fragment>
            ))
          )}
        </Card>

        <View style={{ height: insets.bottom + 88 }} />
      </ScrollView>

      {/* ── FAB ──────────────────────────────────────────── */}
      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 24 }]}
        onPress={openModal}
        activeOpacity={0.85}>
        <MaterialIcons name="add" size={30} color="#fff" />
      </TouchableOpacity>

      {/* ── Edit account modal ────────────────────────────── */}
      {editingAccount && (
        <EditAccountSheet
          key={editingAccount.id}
          account={editingAccount}
          onClose={() => setEditingAccountId(null)}
        />
      )}

      {/* ── Add asset modal ───────────────────────────────── */}
      <FormSheet
        visible={modalVisible}
        title="إضافة أصل"
        onCancel={() => setModalVisible(false)}
        onSave={handleSubmit}>
        {/* Type */}
        <FieldLabel>النوع</FieldLabel>
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

        {/* Name */}
        <FieldLabel>الاسم</FieldLabel>
        <FormInput
          value={form.name}
          onChangeText={(v) => set('name', v)}
          placeholder="مثال: محفظة ريالات"
        />

        {/* Opening balance — accounts only */}
        {form.type !== 'gold' && (
          <>
            <FieldLabel>المبلغ</FieldLabel>
            <FormInput
              value={form.amount}
              onChangeText={(v) => set('amount', v)}
              placeholder="0"
              keyboardType="decimal-pad"
            />
          </>
        )}

        {/* Location */}
        <FieldLabel>المكان</FieldLabel>
        <Segment<Location>
          options={[
            { label: 'مصر', value: 'EG' },
            { label: 'السعودية', value: 'SA' },
          ]}
          value={form.location}
          onChange={(v) => set('location', v)}
        />

        {/* Currency */}
        <FieldLabel>العملة</FieldLabel>
        <Segment<CurrencyCode>
          options={[
            { label: 'ج.م', value: 'EGP' },
            { label: 'ر.س', value: 'SAR' },
            { label: '$', value: 'USD' },
          ]}
          value={form.currency}
          onChange={(v) => set('currency', v)}
        />

        {/* Gold-only fields */}
        {form.type === 'gold' && (
          <>
            <FieldLabel>الوزن (جرام)</FieldLabel>
            <FormInput
              value={form.weightGrams}
              onChangeText={(v) => set('weightGrams', v)}
              placeholder="0"
              keyboardType="decimal-pad"
            />

            <FieldLabel>العيار</FieldLabel>
            <Segment<KaratOption>
              options={[
                { label: '18k', value: '18' },
                { label: '21k', value: '21' },
                { label: '24k', value: '24' },
              ]}
              value={form.karat}
              onChange={(v) => set('karat', v)}
            />

            <FieldLabel>سعر الشراء (بالعملة المختارة)</FieldLabel>
            <FormInput
              value={form.purchasePrice}
              onChangeText={(v) => set('purchasePrice', v)}
              placeholder="0"
              keyboardType="decimal-pad"
            />
          </>
        )}
      </FormSheet>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
  },

  // Summary
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },

  // Section
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.light.text,
    textAlign: 'right',
    marginBottom: 10,
  },
  listCard: {
    padding: 0,
    marginBottom: 20,
    overflow: 'hidden',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: FinanceColors.progressTrack,
    marginHorizontal: 16,
  },
  emptyText: {
    textAlign: 'center',
    color: Colors.light.icon,
    fontSize: 14,
    paddingVertical: 24,
  },

  // Asset rows
  assetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  assetLeft: {
    flex: 1,
    alignItems: 'flex-start',
    gap: 4,
  },
  assetRight: {
    alignItems: 'flex-end',
    marginHorizontal: 12,
    gap: 4,
  },
  assetName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.light.text,
    textAlign: 'right',
  },
  assetAmount: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.light.text,
  },
  assetEGP: {
    fontSize: 12,
    color: Colors.light.icon,
  },
  badge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  deleteBtn: {
    padding: 4,
  },

  // Gold rows
  goldSpec: {
    fontSize: 14,
    fontWeight: '500',
    color: FinanceColors.gold,
  },
  pnlBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  pnlText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // FAB
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.light.tint,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
});
