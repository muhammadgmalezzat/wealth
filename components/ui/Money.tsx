import { StyleSheet, View } from 'react-native';

import type { ColorToken, TypeVariant } from '@/constants/theme';
import type { CurrencyCode } from '@/store/types';

import { AppText } from './AppText';
import { formatMoney } from './formatMoney';

export { formatMoney };

export type MoneySize = 'hero' | 'lg' | 'md' | 'row';
export type MoneyTone = 'default' | 'positive' | 'danger' | 'muted';

interface MoneyProps {
  amount: number;
  currency: CurrencyCode;
  size?: MoneySize;
  // Color is chosen by meaning, never by sign: an ordinary expense stays 'default'.
  tone?: MoneyTone;
  // Prefix "+" / "−" (the amount itself is shown without a minus).
  showSign?: boolean;
  // Secondary line, e.g. the EGP value of a SAR amount: "≈ ج.م 12,500".
  converted?: { amount: number; currency: CurrencyCode };
  align?: 'right' | 'left' | 'center';
}

const VARIANT: Record<MoneySize, TypeVariant> = { hero: 'moneyHero', lg: 'moneyLg', md: 'moneyMd', row: 'moneyRow' };
const TONE: Record<MoneyTone, ColorToken> = {
  default: 'text',
  positive: 'primary700',
  danger: 'danger',
  muted: 'textSecondary',
};

// A money amount in tabular figures.
export function Money({ amount, currency, size = 'row', tone = 'default', showSign = false, converted, align = 'right' }: MoneyProps) {
  const main = (
    <AppText variant={VARIANT[size]} color={TONE[tone]} align={align} style={styles.tabular} numberOfLines={1}>
      {formatMoney(amount, currency, showSign)}
    </AppText>
  );
  if (!converted) return main;
  return (
    <View>
      {main}
      <AppText variant="caption" color="textSecondary" align={align} style={styles.tabular}>
        ≈ {formatMoney(converted.amount, converted.currency)}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  tabular: { fontVariant: ['tabular-nums'] },
});
