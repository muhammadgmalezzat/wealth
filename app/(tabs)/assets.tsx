import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { Card } from '@/components/ui/Card';
import { Colors, FinanceColors } from '@/constants/theme';
import type { Asset, ExchangeRates } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { toEGP } from '@/utils/currency';
import { formatCurrency } from '@/utils/formatters';
import { goldValueEGP } from '@/utils/gold';

// Placeholder until a live gold-price feed is wired up.
// Derived from seed purchase prices (~6,102 EGP/g); set slightly higher to show demo PnL.
const GOLD_PRICE_24K = 6_500; // EGP per gram of 24k gold

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type AssetType = 'cash' | 'bank' | 'gold';
type CurrencyCode = 'EGP' | 'SAR' | 'USD';

interface FormState {
  type: AssetType;
  name: string;
  amount: string;
  currency: CurrencyCode;
  weightGrams: string;
  karat: '21' | '24';
  purchasePrice: string;
}

const INITIAL_FORM: FormState = {
  type: 'cash',
  name: '',
  amount: '',
  currency: 'EGP',
  weightGrams: '',
  karat: '24',
  purchasePrice: '',
};

// ---------------------------------------------------------------------------
// Local sub-components
// ---------------------------------------------------------------------------

interface SummaryCardProps {
  label: string;
  amountEGP: number;
  accentColor: string;
}

function SummaryCard({ label, amountEGP, accentColor }: SummaryCardProps) {
  return (
    <Card style={styles.summaryCard}>
      <View style={[styles.summaryAccent, { backgroundColor: accentColor }]} />
      <Text style={styles.summaryAmount} numberOfLines={1} adjustsFontSizeToFit>
        {formatCurrency(amountEGP, 'EGP')}
      </Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </Card>
  );
}

interface LiquidRowProps {
  asset: Asset;
  valueEGP: number;
  onDelete: () => void;
}

function LiquidRow({ asset, valueEGP, onDelete }: LiquidRowProps) {
  const isBank = asset.type === 'bank';
  return (
    <View style={styles.assetRow}>
      {/* Left: amount */}
      <View style={styles.assetLeft}>
        <Text style={styles.assetAmount}>{formatCurrency(asset.amount, asset.currency)}</Text>
        <Text style={styles.assetEGP}>{formatCurrency(valueEGP, 'EGP')}</Text>
      </View>
      {/* Right: name + badge */}
      <View style={styles.assetRight}>
        <Text style={styles.assetName}>{asset.name}</Text>
        <View style={[styles.badge, { backgroundColor: Colors.light.tint + '22' }]}>
          <Text style={[styles.badgeText, { color: Colors.light.tint }]}>
            {isBank ? 'بنك' : 'نقدي'}
          </Text>
        </View>
      </View>
      {/* Delete */}
      <TouchableOpacity onPress={onDelete} style={styles.deleteBtn} hitSlop={8}>
        <MaterialIcons name="delete-outline" size={20} color={FinanceColors.expense} />
      </TouchableOpacity>
    </View>
  );
}

interface GoldRowProps {
  asset: Asset;
  rates: ExchangeRates;
  onDelete: () => void;
}

function GoldRow({ asset, rates, onDelete }: GoldRowProps) {
  const currentValue = goldValueEGP(asset, GOLD_PRICE_24K);
  const costEGP = toEGP(asset.purchasePrice ?? 0, asset.currency, rates);
  const pnl = currentValue - costEGP;
  const hasCost = costEGP > 0;
  const isProfit = pnl >= 0;

  return (
    <View style={styles.assetRow}>
      {/* Left: specs + PnL */}
      <View style={styles.assetLeft}>
        <Text style={styles.goldSpec}>
          {asset.weightGrams ?? '?'}g {'•'} {asset.karat ?? '?'}k
        </Text>
        {hasCost && (
          <View
            style={[
              styles.pnlBadge,
              { backgroundColor: isProfit ? FinanceColors.income + '20' : FinanceColors.expense + '20' },
            ]}>
            <Text style={[styles.pnlText, { color: isProfit ? FinanceColors.income : FinanceColors.expense }]}>
              {isProfit ? '+' : ''}
              {formatCurrency(pnl, 'EGP')}
            </Text>
          </View>
        )}
      </View>
      {/* Right: name + cost */}
      <View style={styles.assetRight}>
        <Text style={styles.assetName}>{asset.name}</Text>
        {hasCost && (
          <Text style={styles.assetEGP}>{formatCurrency(costEGP, 'EGP')}</Text>
        )}
      </View>
      {/* Delete */}
      <TouchableOpacity onPress={onDelete} style={styles.deleteBtn} hitSlop={8}>
        <MaterialIcons name="delete-outline" size={20} color={FinanceColors.expense} />
      </TouchableOpacity>
    </View>
  );
}

// Generic segmented control
interface SegmentOption<T extends string> {
  label: string;
  value: T;
}

interface SegmentProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
}

function Segment<T extends string>({ options, value, onChange }: SegmentProps<T>) {
  return (
    <View style={styles.segment}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <TouchableOpacity
            key={opt.value}
            style={[styles.segmentItem, active && styles.segmentItemActive]}
            onPress={() => onChange(opt.value)}
            activeOpacity={0.75}>
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------
export default function AssetsScreen() {
  const insets = useSafeAreaInsets();
  const { assets, exchangeRates, addAsset, deleteAsset } = useFinanceStore();

  const [modalVisible, setModalVisible] = useState(false);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);

  // Derived data
  const liquidAssets = assets.filter((a) => a.type === 'cash' || a.type === 'bank');
  const goldAssets = assets.filter((a) => a.type === 'gold');

  const liquidEGP = liquidAssets.reduce(
    (sum, a) => sum + toEGP(a.amount, a.currency, exchangeRates),
    0
  );
  const goldEGP = goldAssets.reduce((sum, a) => {
    const v = goldValueEGP(a, GOLD_PRICE_24K);
    return sum + (v > 0 ? v : toEGP(a.purchasePrice ?? 0, a.currency, exchangeRates));
  }, 0);
  const totalEGP = liquidEGP + goldEGP;

  // Helpers
  const set = <K extends keyof FormState>(key: K, val: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  const handleDelete = (asset: Asset) => {
    Alert.alert('حذف الأصل', `هل تريد حذف "${asset.name}"؟`, [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'حذف', style: 'destructive', onPress: () => deleteAsset(asset.id) },
    ]);
  };

  const handleSubmit = () => {
    const name = form.name.trim();
    if (!name) {
      Alert.alert('تنبيه', 'الرجاء إدخال اسم الأصل');
      return;
    }

    const isGold = form.type === 'gold';
    const newAsset: Asset = {
      id: Date.now().toString(),
      type: form.type,
      name,
      amount: isGold ? 0 : parseFloat(form.amount) || 0,
      currency: form.currency,
      ...(isGold && {
        weightGrams: parseFloat(form.weightGrams) || 0,
        karat: (parseInt(form.karat, 10) as 21 | 24),
        purchasePrice: parseFloat(form.purchasePrice) || 0,
      }),
    };

    addAsset(newAsset);
    setForm(INITIAL_FORM);
    setModalVisible(false);
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
          <SummaryCard label="إجمالي الأصول" amountEGP={totalEGP} accentColor={Colors.light.tint} />
          <SummaryCard label="السيولة" amountEGP={liquidEGP} accentColor={Colors.light.tint} />
          <SummaryCard label="الذهب" amountEGP={goldEGP} accentColor={FinanceColors.gold} />
        </View>

        {/* ── Cash & bank ───────────────────────────────────── */}
        <Text style={styles.sectionTitle}>السيولة والبنوك</Text>
        <Card style={styles.listCard}>
          {liquidAssets.length === 0 ? (
            <Text style={styles.emptyText}>لا توجد أصول</Text>
          ) : (
            liquidAssets.map((asset, idx) => (
              <React.Fragment key={asset.id}>
                <LiquidRow
                  asset={asset}
                  valueEGP={toEGP(asset.amount, asset.currency, exchangeRates)}
                  onDelete={() => handleDelete(asset)}
                />
                {idx < liquidAssets.length - 1 && <View style={styles.divider} />}
              </React.Fragment>
            ))
          )}
        </Card>

        {/* ── Gold ─────────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>الذهب</Text>
        <Card style={styles.listCard}>
          {goldAssets.length === 0 ? (
            <Text style={styles.emptyText}>لا توجد أصول ذهبية</Text>
          ) : (
            goldAssets.map((asset, idx) => (
              <React.Fragment key={asset.id}>
                <GoldRow
                  asset={asset}
                  rates={exchangeRates}
                  onDelete={() => handleDelete(asset)}
                />
                {idx < goldAssets.length - 1 && <View style={styles.divider} />}
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

      {/* ── Add asset modal ───────────────────────────────── */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setModalVisible(false)}>
        <KeyboardAvoidingView
          style={styles.modalRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setModalVisible(false)} hitSlop={8}>
              <Text style={styles.modalCancel}>إلغاء</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>إضافة أصل</Text>
            <TouchableOpacity onPress={handleSubmit} hitSlop={8}>
              <Text style={styles.modalSave}>حفظ</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalBody}
            keyboardShouldPersistTaps="handled">

            {/* Type */}
            <Text style={styles.fieldLabel}>النوع</Text>
            <Segment<AssetType>
              options={[
                { label: 'نقدي', value: 'cash' },
                { label: 'بنك', value: 'bank' },
                { label: 'ذهب', value: 'gold' },
              ]}
              value={form.type}
              onChange={(v) => set('type', v)}
            />

            {/* Name */}
            <Text style={styles.fieldLabel}>الاسم</Text>
            <TextInput
              style={styles.input}
              value={form.name}
              onChangeText={(v) => set('name', v)}
              placeholder="مثال: محفظة ريالات"
              placeholderTextColor={Colors.light.icon}
              textAlign="right"
            />

            {/* Amount — not for gold */}
            {form.type !== 'gold' && (
              <>
                <Text style={styles.fieldLabel}>المبلغ</Text>
                <TextInput
                  style={styles.input}
                  value={form.amount}
                  onChangeText={(v) => set('amount', v)}
                  placeholder="0"
                  placeholderTextColor={Colors.light.icon}
                  keyboardType="decimal-pad"
                  textAlign="right"
                />
              </>
            )}

            {/* Currency */}
            <Text style={styles.fieldLabel}>العملة</Text>
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
                <Text style={styles.fieldLabel}>الوزن (جرام)</Text>
                <TextInput
                  style={styles.input}
                  value={form.weightGrams}
                  onChangeText={(v) => set('weightGrams', v)}
                  placeholder="0"
                  placeholderTextColor={Colors.light.icon}
                  keyboardType="decimal-pad"
                  textAlign="right"
                />

                <Text style={styles.fieldLabel}>العيار</Text>
                <Segment<'21' | '24'>
                  options={[
                    { label: '21k', value: '21' },
                    { label: '24k', value: '24' },
                  ]}
                  value={form.karat}
                  onChange={(v) => set('karat', v)}
                />

                <Text style={styles.fieldLabel}>سعر الشراء (بالعملة المختارة)</Text>
                <TextInput
                  style={styles.input}
                  value={form.purchasePrice}
                  onChangeText={(v) => set('purchasePrice', v)}
                  placeholder="0"
                  placeholderTextColor={Colors.light.icon}
                  keyboardType="decimal-pad"
                  textAlign="right"
                />
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
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
  summaryCard: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 12,
    overflow: 'hidden',
    minWidth: 0,
  },
  summaryAccent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  summaryAmount: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.light.text,
    marginTop: 8,
    textAlign: 'right',
  },
  summaryLabel: {
    fontSize: 11,
    color: Colors.light.icon,
    marginTop: 3,
    textAlign: 'right',
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

  // Modal
  modalRoot: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: FinanceColors.progressTrack,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.light.text,
  },
  modalCancel: {
    fontSize: 16,
    color: Colors.light.icon,
  },
  modalSave: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.light.tint,
  },
  modalScroll: {
    flex: 1,
  },
  modalBody: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
    gap: 4,
  },

  // Form
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.light.icon,
    textAlign: 'right',
    marginBottom: 6,
    marginTop: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: FinanceColors.progressTrack,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.light.text,
    backgroundColor: FinanceColors.cardBackground,
  },

  // Segmented control
  segment: {
    flexDirection: 'row',
    backgroundColor: FinanceColors.cardBackground,
    borderRadius: 10,
    padding: 3,
    borderWidth: 1,
    borderColor: FinanceColors.progressTrack,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  segmentItemActive: {
    backgroundColor: Colors.light.background,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  segmentText: {
    fontSize: 14,
    color: Colors.light.icon,
    fontWeight: '500',
  },
  segmentTextActive: {
    color: Colors.light.tint,
    fontWeight: '700',
  },
});
