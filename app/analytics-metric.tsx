import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet } from 'react-native';

import { FLOW_LABELS, POINT_LABELS } from '@/components/analytics/overviewUi';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import { space } from '@/constants/theme';

// Placeholder for an Overview card's details (Phase 2): income and spending already open their transactions; the other
// cards get their own screens in a later phase.
export default function AnalyticsMetricScreen() {
  const { metric } = useLocalSearchParams<{ metric?: string }>();
  const title =
    (metric && metric in FLOW_LABELS ? FLOW_LABELS[metric as keyof typeof FLOW_LABELS] : undefined) ??
    (metric && metric in POINT_LABELS ? POINT_LABELS[metric as keyof typeof POINT_LABELS] : undefined) ??
    'التفاصيل';
  return (
    <Screen edges={['bottom']} contentStyle={styles.content}>
      <Stack.Screen options={{ title }} />
      <EmptyState icon="insights" title="التفاصيل جاية قريب." body="الرقم ده ومقارنته موجودين في «نظرة عامة»، والتفاصيل هتنزل في تحديث جاي." />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg },
});
