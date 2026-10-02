import { StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { formatCurrency } from '@/utils/formatters';
import type { Fund } from '@/store/types';

interface FundCardProps {
  fund: Fund;
  current: number; // fund currency
  progress: number; // 0..∞
}

export function FundCard({ fund, current, progress }: FundCardProps) {
  const percent = Math.round(progress * 100);

  return (
    <Card>
      <View style={styles.header}>
        <Text style={styles.name}>{fund.name}</Text>
        <Text style={styles.percent}>{percent}%</Text>
      </View>
      <ProgressBar progress={progress} />
      <View style={styles.footer}>
        <Text style={styles.sub}>{formatCurrency(current, fund.currency)}</Text>
        <Text style={styles.sub}>{formatCurrency(fund.targetAmount, fund.currency)}</Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  name: { fontSize: 15, fontWeight: '600' },
  percent: { fontSize: 14, color: '#0a7ea4', fontWeight: '600' },
  sub: { fontSize: 12, color: '#687076' },
});
