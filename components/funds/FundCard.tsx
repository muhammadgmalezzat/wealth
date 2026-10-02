import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { STATUS_BADGES } from '@/components/funds/labels';
import { Card } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Colors } from '@/constants/theme';
import {
  fundCurrent,
  fundDueDate,
  fundLinkedValue,
  fundProgress,
  fundRequiredMonthly,
  fundStatus,
} from '@/store/selectors';
import type { FinanceState, Fund } from '@/store/types';
import { formatCurrency, formatDate } from '@/utils/formatters';

interface FundCardProps {
  fund: Fund;
  state: FinanceState;
  onPress: () => void;
}

export function FundCard({ fund, state, onPress }: FundCardProps) {
  const progress = fundProgress(state, fund.id);
  const status = STATUS_BADGES[fundStatus(state, fund.id)];
  const due = fundDueDate(fund);
  const requiredMonthly = fundRequiredMonthly(state, fund.id);
  const linked = fundLinkedValue(state, fund.id);

  const details = [
    due ? `الموعد: ${formatDate(due)}` : null,
    requiredMonthly !== null ? `مطلوب شهرياً: ${formatCurrency(requiredMonthly, fund.currency)}` : null,
    linked > 0 ? `منها ذهب: ${formatCurrency(linked, fund.currency)}` : null,
  ].filter(Boolean);

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
      <Card>
        <View style={styles.header}>
          <View style={[styles.badge, { backgroundColor: status.color + '1F' }]}>
            <Text style={[styles.badgeText, { color: status.color }]}>{status.label}</Text>
          </View>
          <Text style={styles.name}>{fund.name}</Text>
        </View>
        <ProgressBar progress={progress} />
        <View style={styles.amounts}>
          <Text style={styles.percent}>{Math.round(progress * 100)}%</Text>
          <Text style={styles.sub}>
            {formatCurrency(fundCurrent(state, fund.id), fund.currency)} /{' '}
            {formatCurrency(fund.targetAmount, fund.currency)}
          </Text>
        </View>
        {details.map((line) => (
          <Text key={line} style={styles.detail}>
            {line}
          </Text>
        ))}
      </Card>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  name: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: Colors.light.text,
    textAlign: 'right',
    marginLeft: 8,
  },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  amounts: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  percent: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.light.tint,
  },
  sub: {
    fontSize: 12,
    color: Colors.light.icon,
  },
  detail: {
    fontSize: 12,
    color: Colors.light.icon,
    textAlign: 'right',
    marginTop: 4,
  },
});
