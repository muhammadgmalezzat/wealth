import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { Colors } from '@/constants/theme';
import { formatCurrency } from '@/utils/formatters';

interface StatCardProps {
  label: string;
  amountEGP: number;
  accentColor: string;
}

export function StatCard({ label, amountEGP, accentColor }: StatCardProps) {
  return (
    <Card style={styles.card}>
      <View style={[styles.accent, { backgroundColor: accentColor }]} />
      <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit>
        {formatCurrency(amountEGP, 'EGP')}
      </Text>
      <Text style={styles.label}>{label}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 12,
    overflow: 'hidden',
    minWidth: 0,
  },
  accent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  amount: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.light.text,
    marginTop: 8,
    textAlign: 'right',
  },
  label: {
    fontSize: 11,
    color: Colors.light.icon,
    marginTop: 3,
    textAlign: 'right',
  },
});
