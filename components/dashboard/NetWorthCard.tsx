import { StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/ui/Card';
import { formatCurrency } from '@/utils/formatters';

interface NetWorthCardProps {
  totalEGP: number;
}

export function NetWorthCard({ totalEGP }: NetWorthCardProps) {
  return (
    <Card style={styles.card}>
      <Text style={styles.label}>Net Worth</Text>
      <Text style={styles.amount}>{formatCurrency(totalEGP, 'EGP')}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#0a7ea4' },
  label: { color: 'rgba(255,255,255,0.8)', fontSize: 14, marginBottom: 4 },
  amount: { color: '#fff', fontSize: 32, fontWeight: 'bold' },
});
