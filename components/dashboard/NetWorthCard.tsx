import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { Money } from '@/components/ui/Money';
import { colors, radius, space } from '@/constants/theme';
import { holdingsTotalEGP, liquidTotalEGP, netWorthByLocation, netWorthEGP } from '@/store/selectors';
import type { FinanceState } from '@/store/types';

// "صافي الثروة": total, the Egypt / Saudi split, and liquid vs gold & investments (all EGP).
export function NetWorthCard({ state }: { state: FinanceState }) {
  const byLocation = netWorthByLocation(state);
  return (
    <Card style={styles.card}>
      <AppText variant="secondary" color="textSecondary">
        صافي الثروة
      </AppText>
      <Money amount={netWorthEGP(state)} currency="EGP" size="lg" />

      <View style={styles.lines}>
        <Line label="مصر" amount={byLocation.EG} />
        <View style={styles.separator} />
        <Line label="السعودية" amount={byLocation.SA} />
      </View>

      <View style={styles.split}>
        <Part label="سيولة" amount={liquidTotalEGP(state)} />
        <Part label="ذهب واستثمارات" amount={holdingsTotalEGP(state)} gold />
      </View>
    </Card>
  );
}

function Line({ label, amount }: { label: string; amount: number }) {
  return (
    <View style={styles.line}>
      <AppText variant="body" style={styles.flex}>
        {label}
      </AppText>
      <Money amount={amount} currency="EGP" size="row" />
    </View>
  );
}

function Part({ label, amount, gold = false }: { label: string; amount: number; gold?: boolean }) {
  return (
    <View style={styles.part}>
      <View style={styles.partLabel}>
        {gold && <View style={styles.goldDot} />}
        <AppText variant="caption" color={gold ? 'goldText' : 'textSecondary'}>
          {label}
        </AppText>
      </View>
      <Money amount={amount} currency="EGP" size="row" />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.xs },
  lines: { marginTop: space.md },
  line: { flexDirection: 'row-reverse', alignItems: 'center', minHeight: 44, gap: space.sm },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  flex: { flex: 1 },
  split: {
    flexDirection: 'row-reverse',
    marginTop: space.md,
    padding: space.md,
    gap: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  part: { flex: 1, minWidth: 0, gap: space.xxs },
  partLabel: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.xs + space.xxs },
  goldDot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.gold },
});
