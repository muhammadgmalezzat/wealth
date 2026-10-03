import { useState } from 'react';
import { StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';

import { KIND_SECTION_TITLES, MODE_LABELS, frequencyLabel } from '@/components/recurring/labels';
import { RuleSheet } from '@/components/recurring/RuleSheet';
import { Card } from '@/components/ui/Card';
import { Fab, FAB_CLEARANCE } from '@/components/ui/Fab';
import { LoadingView } from '@/components/ui/LoadingView';
import { Screen } from '@/components/ui/Screen';
import { Colors, FinanceColors } from '@/constants/theme';
import { upcoming, type CurrencyTotals } from '@/store/recurring';
import type { CurrencyCode, RecurringRule } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { toDateKey } from '@/utils/dates';
import { formatCurrency, formatDate } from '@/utils/formatters';
import { runAction } from '@/utils/runAction';

const KINDS: RecurringRule['kind'][] = ['income', 'expense', 'transfer'];

const totalsLine = (totals: CurrencyTotals) =>
  (Object.entries(totals) as [CurrencyCode, number][])
    .filter(([, v]) => v > 0)
    .map(([currency, v]) => formatCurrency(v, currency))
    .join(' + ');

export default function RecurringScreen() {
  const state = useFinanceStore();
  const [sheet, setSheet] = useState<'add' | { id: string } | null>(null);

  if (!state.hasHydrated) return <LoadingView />;

  const today = toDateKey(new Date());
  const next30 = upcoming(state, 30, today);
  const editing = sheet && sheet !== 'add' ? state.recurringRules.find((r) => r.id === sheet.id) : undefined;
  const accountName = (id?: string) => state.accounts.find((a) => a.id === id)?.name ?? '—';

  return (
    <Screen
      scroll
      edges={['bottom']}
      contentStyle={styles.content}
      overlay={<Fab placement="stack" onPress={() => setSheet('add')} accessibilityLabel="معاملة متكررة جديدة" />}>
        {/* ── Next 30 days ── */}
        <Text style={styles.sectionTitle}>جاي خلال 30 يوم</Text>
        <Card>
          {next30.items.length === 0 ? (
            <Text style={styles.muted}>مفيش حاجة جاية</Text>
          ) : (
            <>
              {next30.items.slice(0, 12).map(({ rule, date }) => (
                <View key={`${rule.id}-${date}`} style={styles.upcomingRow}>
                  <Text style={[styles.amount, { color: amountColor(rule) }]}>{formatCurrency(rule.amount, rule.currency)}</Text>
                  <Text style={styles.upcomingName}>
                    {rule.name} · {formatDate(date)}
                  </Text>
                </View>
              ))}
              {totalsLine(next30.income) ? <Text style={styles.total}>دخل: {totalsLine(next30.income)}</Text> : null}
              {totalsLine(next30.expense) ? <Text style={styles.total}>مصروفات: {totalsLine(next30.expense)}</Text> : null}
            </>
          )}
        </Card>

        {/* ── Rules by kind ── */}
        {KINDS.map((kind) => {
          const rules = state.recurringRules.filter((r) => r.kind === kind);
          if (rules.length === 0) return null;
          return (
            <View key={kind}>
              <Text style={styles.sectionTitle}>{KIND_SECTION_TITLES[kind]}</Text>
              <Card style={styles.listCard}>
                {rules.map((rule, i) => (
                  <TouchableOpacity
                    key={rule.id}
                    style={[styles.ruleRow, i < rules.length - 1 && styles.rowBorder, !rule.active && styles.paused]}
                    onPress={() => setSheet({ id: rule.id })}
                    activeOpacity={0.8}>
                    <Switch
                      value={rule.active}
                      onValueChange={(active) => {
                        runAction('تعذّر التعديل', () => state.setRecurringActive(rule.id, active));
                      }}
                    />
                    <View style={styles.ruleText}>
                      <View style={styles.ruleTitle}>
                        <View style={[styles.badge, rule.mode === 'auto' && styles.badgeAuto]}>
                          <Text style={styles.badgeText}>{MODE_LABELS[rule.mode]}</Text>
                        </View>
                        <Text style={styles.ruleName}>{rule.name}</Text>
                      </View>
                      <Text style={[styles.amount, { color: amountColor(rule) }]}>
                        {formatCurrency(rule.amount, rule.currency)}
                        {rule.variableAmount ? ' (تقريباً)' : ''}
                      </Text>
                      <Text style={styles.muted}>
                        {frequencyLabel(rule)} ·{' '}
                        {kind === 'transfer'
                          ? `من ${accountName(rule.accountId)} إلى ${accountName(rule.toAccountId)}`
                          : accountName(rule.accountId)}
                      </Text>
                      <Text style={styles.muted}>
                        {!rule.active ? 'متوقف' : rule.nextDate ? `الجاي: ${formatDate(rule.nextDate)}` : 'انتهى'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </Card>
            </View>
          );
        })}

        {state.recurringRules.length === 0 && (
          <Text style={[styles.muted, styles.empty]}>
            ضيف الإيجار والمرتب والفواتير اللي بتتكرر، والتطبيق يفكرك بيها أو يسجلها لوحده.
          </Text>
        )}

      {sheet === 'add' && <RuleSheet onClose={() => setSheet(null)} />}
      {editing && <RuleSheet key={editing.id} rule={editing} onClose={() => setSheet(null)} />}
    </Screen>
  );
}

function amountColor(rule: RecurringRule) {
  return rule.kind === 'income' ? FinanceColors.income : rule.kind === 'expense' ? FinanceColors.expense : Colors.light.text;
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: FAB_CLEARANCE },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: Colors.light.text, textAlign: 'right', marginTop: 16, marginBottom: 10 },
  listCard: { padding: 0, overflow: 'hidden' },
  upcomingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  upcomingName: { fontSize: 14, color: Colors.light.text, textAlign: 'right', flex: 1, marginLeft: 8 },
  total: { marginTop: 8, fontSize: 13, fontWeight: '600', color: Colors.light.text, textAlign: 'right' },
  ruleRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: FinanceColors.progressTrack },
  paused: { opacity: 0.55 },
  ruleText: { flex: 1, alignItems: 'flex-end', gap: 2 },
  ruleTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ruleName: { fontSize: 15, fontWeight: '600', color: Colors.light.text },
  badge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1, backgroundColor: Colors.light.icon + '22' },
  badgeAuto: { backgroundColor: Colors.light.tint + '22' },
  badgeText: { fontSize: 10, fontWeight: '700', color: Colors.light.icon },
  amount: { fontSize: 14, fontWeight: '600' },
  muted: { fontSize: 12, color: Colors.light.icon, textAlign: 'right' },
  empty: { marginTop: 32, textAlign: 'center', lineHeight: 20 },
});
