import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { ComponentProps } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { colors, radius, space } from '@/constants/theme';
import type { CurrencyCode } from '@/store/types';
import { currencySymbol } from '@/utils/formatters';
import { parseAmount } from '@/utils/parseAmount';

import { AppText } from './AppText';

export interface AmountHint {
  tone: 'neutral' | 'attention';
  text: string;
  icon?: ComponentProps<typeof MaterialIcons>['name'];
}

interface AmountInputProps {
  value: string;
  onChangeText: (text: string) => void;
  // Parsed with utils/parseAmount (Arabic or Western digits); null while empty or invalid.
  onChangeAmount?: (amount: number | null) => void;
  currency: CurrencyCode;
  hint?: AmountHint;
  allowZero?: boolean;
  autoFocus?: boolean;
  accessibilityLabel?: string;
}

// Large, centred amount entry with its currency label and an optional hint underneath.
export function AmountInput({
  value,
  onChangeText,
  onChangeAmount,
  currency,
  hint,
  allowZero = false,
  autoFocus,
  accessibilityLabel = 'المبلغ',
}: AmountInputProps) {
  const handleChange = (text: string) => {
    onChangeText(text);
    onChangeAmount?.(parseAmount(text, { allowZero }));
  };
  return (
    <View style={styles.wrap}>
      {/* LTR row: number, then currency — numbers read left to right in Arabic too. */}
      <View style={styles.row}>
        <TextInput
          value={value}
          onChangeText={handleChange}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={colors.textMuted}
          autoFocus={autoFocus}
          accessibilityLabel={accessibilityLabel}
          style={[styles.input, value.length > 7 && styles.inputSmall]}
          textAlign="center"
        />
        <AppText variant="section" color="textSecondary" align="center">
          {currencySymbol(currency)}
        </AppText>
      </View>
      {hint && (
        <View style={[styles.hint, hint.tone === 'attention' && styles.hintAttention]}>
          {hint.icon && (
            <MaterialIcons name={hint.icon} size={16} color={hint.tone === 'attention' ? colors.warning : colors.primary700} />
          )}
          <AppText variant="caption" color={hint.tone === 'attention' ? 'warning' : 'textSecondary'} align="center">
            {hint.text}
          </AppText>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: space.sm, paddingVertical: space.md },
  // Stretched to the sheet width with a flexing input: a web <input> otherwise takes its
  // intrinsic width (hundreds of px at 48px) and pushes the number off-screen.
  row: { flexDirection: 'row', alignItems: 'baseline', alignSelf: 'stretch', gap: space.sm },
  input: {
    fontSize: 48,
    lineHeight: 58,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
    minWidth: 0,
    padding: 0,
    // In the style too: react-native-web ignores the textAlign prop on inputs.
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  inputSmall: { fontSize: 40, lineHeight: 50 },
  // RTL: icon first, on the right.
  hint: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
  },
  hintAttention: { backgroundColor: colors.warningSurface },
});
