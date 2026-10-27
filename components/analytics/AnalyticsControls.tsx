import { StyleSheet, Switch, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { Segment } from '@/components/ui/Segment';
import { colors, space } from '@/constants/theme';
import type { DisplayCurrency, Period, PeriodKind } from '@/store/analytics';

import { CURRENCY_OPTIONS, PERIOD_OPTIONS, periodLabel } from './analyticsUi';

interface AnalyticsControlsProps {
  kind: PeriodKind;
  period: Period;
  onKindChange: (kind: PeriodKind) => void;
  currency: DisplayCurrency;
  onCurrencyChange: (currency: DisplayCurrency) => void;
  includeOneTime: boolean;
  onIncludeOneTimeChange: (include: boolean) => void;
}

// The sticky controls: period, display currency and the one-time toggle. Everything below
// recalculates from these.
export function AnalyticsControls({
  kind,
  period,
  onKindChange,
  currency,
  onCurrencyChange,
  includeOneTime,
  onIncludeOneTimeChange,
}: AnalyticsControlsProps) {
  return (
    <View style={styles.wrap}>
      <ChipRow>
        {PERIOD_OPTIONS.map((o) => (
          <Chip key={o.value} label={o.label} selected={kind === o.value} onPress={() => onKindChange(o.value)} />
        ))}
      </ChipRow>
      <AppText variant="caption" color="textSecondary">
        {periodLabel(period)}
      </AppText>
      <View style={styles.row}>
        <View style={styles.currency}>
          <Segment<DisplayCurrency> options={CURRENCY_OPTIONS} value={currency} onChange={onCurrencyChange} />
        </View>
        <AppText variant="caption" style={styles.flex}>
          اشمل المصاريف اللي لمرة واحدة
        </AppText>
        <Switch
          value={includeOneTime}
          onValueChange={onIncludeOneTimeChange}
          trackColor={{ true: colors.primary600, false: colors.borderStrong }}
          thumbColor={colors.surface}
          accessibilityLabel="اشمل المصاريف اللي لمرة واحدة"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.md,
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.md },
  currency: { width: 112 },
  flex: { flex: 1 },
});
