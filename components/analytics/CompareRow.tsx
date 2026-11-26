import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { StatusChip } from '@/components/ui/StatusChip';
import { space } from '@/constants/theme';

import type { ChangeLine } from './overviewUi';

interface CompareRowProps {
  title: string;
  // Already formatted (an amount, a rate, or why there is none).
  a: string;
  b: string;
  // null when there is nothing to compare with (the screen says why once, above).
  change: ChangeLine | null;
  // qualityLabel of the change; null for recorded figures.
  quality: string | null;
}

// One metric of the Compare screen: A and B side by side (A on the right, as read), then the change from A to B.
export function CompareRow({ title, a, b, change, quality }: CompareRowProps) {
  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <AppText variant="bodyStrong" style={styles.flex}>
          {title}
        </AppText>
        {quality && <StatusChip label={quality} tone={quality === 'مش متاح' ? 'neutral' : 'attention'} />}
      </View>
      <View style={styles.values}>
        <View style={styles.side}>
          <AppText variant="micro" color="textMuted">
            أ
          </AppText>
          <AppText variant="moneyRow">{a}</AppText>
        </View>
        <View style={styles.side}>
          <AppText variant="micro" color="textMuted">
            ب
          </AppText>
          <AppText variant="moneyRow">{b}</AppText>
        </View>
      </View>
      {change && (
        <AppText variant="caption" color={change.color}>
          {change.text}
        </AppText>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.xs, padding: space.md },
  head: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  values: { flexDirection: 'row-reverse', gap: space.md },
  side: { flex: 1, gap: space.xxs, alignItems: 'flex-end' },
});
