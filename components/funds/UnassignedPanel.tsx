import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AssignSheet } from '@/components/funds/AssignSheet';
import { ResolveSheet } from '@/components/funds/ResolveSheet';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Money } from '@/components/ui/Money';
import { currencyNameAr } from '@/constants/currencies';
import { colors, space } from '@/constants/theme';
import { currencyList, unassignedSummary } from '@/store/selectors';
import type { FinanceState } from '@/store/types';

const EPSILON = 0.005;

// "فلوس بدون وظيفة": money no fund has set aside, per currency (each in its own currency, so
// 1000 SAR stays 1000 SAR) with the total in EGP at today's rate. Surplus → distribute
// (AssignSheet). Migrated reservations without an account get their own line and a "حدّد الحساب" button
// (ResolveSheet). Reserved money can no longer be spent without a cover (the cover sheet opens from the operation
// itself); a shortfall can only be old data, and it is shown as danger. Nothing at all: nothing shown. Owns the
// sheets it opens.
export function UnassignedPanel({ state }: { state: FinanceState }) {
  const [sheet, setSheet] = useState<'assign' | 'resolve' | null>(null);
  const summary = unassignedSummary(state);
  const rows = currencyList(state).filter((c) => Math.abs(summary.byCurrency[c]) > EPSILON || summary.unresolved.some((u) => u.currency === c));
  const short = summary.deficits.length > 0;
  const spare = summary.surpluses.length > 0;

  const sheets = (
    <>
      {sheet === 'assign' && <AssignSheet onClose={() => setSheet(null)} />}
      {sheet === 'resolve' && <ResolveSheet onClose={() => setSheet(null)} />}
    </>
  );

  if (rows.length === 0) return sheets;

  // The EGP total is only worth a line when it adds something: several currencies, or one that
  // isn't EGP.
  const showTotal = rows.length > 1 || rows[0] !== 'EGP';

  return (
    <>
      <Card style={short ? styles.negative : styles.card}>
        <AppText variant="secondary" color="textSecondary">
          فلوس بدون وظيفة
        </AppText>
        <View accessibilityLabel="فلوس بدون وظيفة بكل عملة">
          {rows.map((currency) => (
            <View key={currency} style={styles.row}>
              <AppText variant="body" style={styles.flex}>
                {currencyNameAr(currency)}
              </AppText>
              <Money
                amount={summary.byCurrency[currency]}
                currency={currency}
                size="md"
                tone={summary.byCurrency[currency] < 0 ? 'danger' : 'default'}
                align="left"
              />
            </View>
          ))}
          {showTotal && (
            <View style={[styles.row, styles.total]}>
              <AppText variant="secondary" color="textSecondary" style={styles.flex}>
                الإجمالي بالجنيه
              </AppText>
              <Money
                amount={summary.totalEGP}
                currency="EGP"
                size="row"
                tone={summary.totalEGP < -EPSILON ? 'danger' : 'muted'}
                align="left"
              />
            </View>
          )}
        </View>
        {summary.unresolved.length > 0 && (
          <View accessibilityLabel="محجوز ومش محدد حسابه">
            {summary.unresolved.map((u) => (
              <View key={u.currency} style={styles.row}>
                <AppText variant="secondary" color="textSecondary" style={styles.flex}>
                  محجوز ومش محدد حسابه · {currencyNameAr(u.currency)}
                </AppText>
                <Money amount={u.amount} currency={u.currency} size="row" tone="muted" align="left" />
              </View>
            ))}
          </View>
        )}
        {short && (
          <AppText variant="bodyStrong" color="danger">
            المحجوز للصناديق أكتر من الرصيد. راجع الصناديق.
          </AppText>
        )}
        {spare && !short && <AppText variant="secondary">ممكن توزّع جزء منها على أهدافك القادمة.</AppText>}
        <View style={styles.actions}>
          {summary.unresolved.length > 0 && <Button label="حدّد الحساب" variant="secondary" onPress={() => setSheet('resolve')} />}
          {/* Secondary: Home and the Funds tab keep their own single primary. */}
          {spare && <Button label="وزّع أموالك" variant="secondary" onPress={() => setSheet('assign')} />}
        </View>
      </Card>
      {sheets}
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.xs },
  negative: { gap: space.xs, backgroundColor: colors.dangerSurface, borderColor: colors.dangerSurface },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.sm, minHeight: 36 },
  total: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: space.xs },
  flex: { flex: 1 },
  // RTL: first button on the right.
  actions: { flexDirection: 'row-reverse', gap: space.sm, marginTop: space.sm, flexWrap: 'wrap' },
});
