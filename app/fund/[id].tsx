import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FundSheet } from '@/components/funds/FundSheet';
import { FREQUENCY_LABELS, FUND_TYPE_LABELS, STATUS_BADGES } from '@/components/funds/labels';
import { MoveMoneySheet } from '@/components/funds/MoveMoneySheet';
import { PaySinkingSheet } from '@/components/funds/PaySinkingSheet';
import { Card } from '@/components/ui/Card';
import { LoadingView } from '@/components/ui/LoadingView';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Colors, FinanceColors } from '@/constants/theme';
import {
  fundAllocated,
  fundCurrent,
  fundDueDate,
  fundProgress,
  fundRequiredMonthly,
  fundStatus,
  holdingValueEGP,
} from '@/store/selectors';
import { useFinanceStore } from '@/store/useFinanceStore';
import { monthsUntil } from '@/utils/dates';
import { formatCurrency, formatDate } from '@/utils/formatters';

type SheetKind = 'edit' | 'allocate' | 'withdraw' | 'pay' | null;

export default function FundDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const state = useFinanceStore();
  const [sheet, setSheet] = useState<SheetKind>(null);

  if (!state.hasHydrated) return <LoadingView />;

  const fund = state.funds.find((f) => f.id === id);
  if (!fund) {
    return (
      <View style={styles.missing}>
        <Stack.Screen options={{ title: 'الصندوق' }} />
        <Text style={styles.muted}>الصندوق غير موجود</Text>
      </View>
    );
  }

  const progress = fundProgress(state, fund.id);
  const status = STATUS_BADGES[fundStatus(state, fund.id)];
  const due = fundDueDate(fund);
  const requiredMonthly = fundRequiredMonthly(state, fund.id);
  const movements = state.fundMovements
    .map((m, index) => ({ m, index }))
    .filter(({ m }) => m.fundId === fund.id)
    // Newest first; movements recorded later on the same day come first.
    .sort((a, b) => (a.m.date !== b.m.date ? (a.m.date < b.m.date ? 1 : -1) : b.index - a.index))
    .map(({ m }) => m);
  const linkedHoldings = state.holdings.filter((h) => fund.linkedHoldingIds.includes(h.id));

  const facts = [
    { label: 'النوع', value: FUND_TYPE_LABELS[fund.type] },
    fund.type === 'sinking' && fund.frequency
      ? { label: 'التكرار', value: FREQUENCY_LABELS[fund.frequency] }
      : null,
    due ? { label: fund.type === 'sinking' ? 'الاستحقاق القادم' : 'الموعد', value: formatDate(due) } : null,
    due ? { label: 'الشهور المتبقية', value: String(monthsUntil(due, new Date())) } : null,
    requiredMonthly !== null
      ? { label: 'مطلوب شهرياً', value: formatCurrency(requiredMonthly, fund.currency) }
      : null,
    { label: 'نقداً في الصندوق', value: formatCurrency(fundAllocated(state, fund.id), fund.currency) },
  ].filter((fact): fact is { label: string; value: string } => fact !== null);

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          title: fund.name,
          headerRight: () => (
            <TouchableOpacity onPress={() => setSheet('edit')} hitSlop={8}>
              <Text style={styles.headerAction}>تعديل</Text>
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        {/* ── Summary ── */}
        <Card>
          <View style={styles.titleRow}>
            <View style={[styles.badge, { backgroundColor: status.color + '1F' }]}>
              <Text style={[styles.badgeText, { color: status.color }]}>{status.label}</Text>
            </View>
            <Text style={styles.percent}>{Math.round(progress * 100)}%</Text>
          </View>
          <ProgressBar progress={progress} height={10} />
          <Text style={styles.amounts}>
            {formatCurrency(fundCurrent(state, fund.id), fund.currency)} /{' '}
            {formatCurrency(fund.targetAmount, fund.currency)}
          </Text>
          {facts.map((fact) => (
            <View key={fact.label} style={styles.factRow}>
              <Text style={styles.factValue}>{fact.value}</Text>
              <Text style={styles.muted}>{fact.label}</Text>
            </View>
          ))}
        </Card>

        {/* ── Actions ── */}
        <View style={styles.actions}>
          <TouchableOpacity style={[styles.action, styles.actionSecondary]} onPress={() => setSheet('withdraw')}>
            <Text style={[styles.actionText, styles.actionTextSecondary]}>سحب</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.action} onPress={() => setSheet('allocate')}>
            <Text style={styles.actionText}>إضافة</Text>
          </TouchableOpacity>
        </View>
        {fund.type === 'sinking' && (
          <TouchableOpacity style={[styles.action, styles.payAction]} onPress={() => setSheet('pay')}>
            <Text style={styles.actionText}>اتدفعت</Text>
          </TouchableOpacity>
        )}

        {/* ── Linked holdings ── */}
        {linkedHoldings.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>الذهب المربوط</Text>
            <Card style={styles.listCard}>
              {linkedHoldings.map((h, i) => (
                <View key={h.id} style={[styles.listRow, i < linkedHoldings.length - 1 && styles.rowBorder]}>
                  <Text style={styles.factValue}>{formatCurrency(holdingValueEGP(state, h), 'EGP')}</Text>
                  <Text style={styles.listTitle}>{h.name}</Text>
                </View>
              ))}
            </Card>
          </>
        )}

        {/* ── Movements ── */}
        <Text style={styles.sectionTitle}>الحركات</Text>
        <Card style={styles.listCard}>
          {movements.length === 0 ? (
            <Text style={[styles.muted, styles.empty]}>لا توجد حركات بعد</Text>
          ) : (
            movements.map((m, i) => (
              <View key={m.id} style={[styles.listRow, i < movements.length - 1 && styles.rowBorder]}>
                <Text
                  style={[
                    styles.factValue,
                    { color: m.amount >= 0 ? FinanceColors.income : FinanceColors.expense },
                  ]}>
                  {m.amount >= 0 ? '+' : '−'}
                  {formatCurrency(Math.abs(m.amount), fund.currency)}
                </Text>
                <View style={styles.movementText}>
                  <Text style={styles.listTitle}>{formatDate(m.date)}</Text>
                  {m.note ? <Text style={styles.muted}>{m.note}</Text> : null}
                </View>
              </View>
            ))
          )}
        </Card>
      </ScrollView>

      {sheet === 'edit' && (
        <FundSheet fund={fund} onClose={() => setSheet(null)} onDeleted={() => router.back()} />
      )}
      {(sheet === 'allocate' || sheet === 'withdraw') && (
        <MoveMoneySheet fund={fund} mode={sheet} onClose={() => setSheet(null)} />
      )}
      {sheet === 'pay' && <PaySinkingSheet fund={fund} onClose={() => setSheet(null)} />}
    </View>
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
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAction: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.light.tint,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  percent: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.light.tint,
  },
  amounts: {
    marginTop: 8,
    marginBottom: 6,
    fontSize: 14,
    color: Colors.light.text,
    textAlign: 'right',
  },
  factRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  factValue: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.text,
  },
  muted: {
    fontSize: 13,
    color: Colors.light.icon,
    textAlign: 'right',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  action: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: Colors.light.tint,
  },
  actionSecondary: {
    backgroundColor: Colors.light.tint + '15',
  },
  payAction: {
    flex: 0,
    marginTop: 10,
    backgroundColor: FinanceColors.income,
  },
  actionText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  actionTextSecondary: {
    color: Colors.light.tint,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.light.text,
    textAlign: 'right',
    marginTop: 24,
    marginBottom: 10,
  },
  listCard: {
    padding: 0,
    overflow: 'hidden',
  },
  listRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: FinanceColors.progressTrack,
  },
  listTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.light.text,
    textAlign: 'right',
  },
  movementText: {
    alignItems: 'flex-end',
    gap: 2,
  },
  empty: {
    textAlign: 'center',
    paddingVertical: 24,
  },
});
