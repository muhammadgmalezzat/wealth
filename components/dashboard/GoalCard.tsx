import { StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { formatCurrency } from '@/utils/formatters';
import type { Goal } from '@/store/types';

interface GoalCardProps {
  goal: Goal;
}

export function GoalCard({ goal }: GoalCardProps) {
  const progress = goal.currentAmount / goal.targetAmount;
  const percent = Math.round(progress * 100);

  return (
    <Card>
      <View style={styles.header}>
        <Text style={styles.name}>{goal.name}</Text>
        <Text style={styles.percent}>{percent}%</Text>
      </View>
      <ProgressBar progress={progress} />
      <View style={styles.footer}>
        <Text style={styles.sub}>{formatCurrency(goal.currentAmount, goal.currency)}</Text>
        <Text style={styles.sub}>{formatCurrency(goal.targetAmount, goal.currency)}</Text>
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
