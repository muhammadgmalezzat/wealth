import { StyleSheet } from 'react-native';

import { Card } from '@/components/ui/Card';
import { colors, space } from '@/constants/theme';
import { formatCurrency } from '@/utils/formatters';

import { AppText } from './AppText';

interface StatCardProps {
  label: string;
  amountEGP: number;
  /** @deprecated ignored — plain metric look (no colored accent). */
  accentColor?: string;
  // Overrides the default text color of the amount (e.g. for a net figure).
  amountColor?: string;
}

// Small metric tile: amount on top, label underneath. Replaced on Home in phase 2.
export function StatCard({ label, amountEGP, amountColor }: StatCardProps) {
  return (
    <Card style={styles.card}>
      <AppText
        variant="moneyRow"
        style={[styles.amount, amountColor ? { color: amountColor } : null]}
        numberOfLines={1}
        adjustsFontSizeToFit>
        {formatCurrency(amountEGP, 'EGP')}
      </AppText>
      <AppText variant="micro" color="textSecondary">
        {label}
      </AppText>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    gap: 2,
  },
  amount: { fontVariant: ['tabular-nums'], color: colors.text },
});
