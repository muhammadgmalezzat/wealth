import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AssignSheet } from '@/components/funds/AssignSheet';
import { CoverSheet } from '@/components/funds/CoverSheet';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Money } from '@/components/ui/Money';
import { colors, space } from '@/constants/theme';
import { unassignedEGP } from '@/store/selectors';
import type { FinanceState } from '@/store/types';

// Money without a job. Positive: "فلوس متاحة للتخطيط" → distribute (AssignSheet). Negative:
// fund money was spent → cover the gap (CoverSheet); the only state styled as danger. Zero:
// nothing. Owns the sheets it opens.
export function UnassignedPanel({ state }: { state: FinanceState }) {
  const [sheet, setSheet] = useState<'assign' | 'cover' | null>(null);
  const amount = unassignedEGP(state);
  const negative = amount < -0.005;
  const positive = amount > 0.005;

  const sheets = (
    <>
      {sheet === 'assign' && <AssignSheet onClose={() => setSheet(null)} />}
      {sheet === 'cover' && <CoverSheet onClose={() => setSheet(null)} />}
    </>
  );

  if (negative) {
    return (
      <>
        <Card style={styles.negative}>
          <AppText variant="bodyStrong" color="danger">
            استخدمت جزء من فلوس الصناديق.
          </AppText>
          <Money amount={-amount} currency="EGP" size="md" tone="danger" />
          <View style={styles.action}>
            <Button label="غطّي الفرق" variant="destructive" onPress={() => setSheet('cover')} />
          </View>
        </Card>
        {sheets}
      </>
    );
  }

  if (!positive) return sheets;

  return (
    <>
      <Card style={styles.card}>
        <AppText variant="secondary" color="textSecondary">
          فلوس متاحة للتخطيط
        </AppText>
        <Money amount={amount} currency="EGP" size="md" />
        <AppText variant="secondary">ممكن توزّع جزء منها على أهدافك القادمة.</AppText>
        <View style={styles.action}>
          <Button label="وزّع أموالك" onPress={() => setSheet('assign')} />
        </View>
      </Card>
      {sheets}
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.xs },
  negative: { gap: space.xs, backgroundColor: colors.dangerSurface, borderColor: colors.dangerSurface },
  action: { marginTop: space.sm },
});
