import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { formatMoney } from '@/components/ui/formatMoney';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { StatusChip } from '@/components/ui/StatusChip';
import { colors, opacity, space } from '@/constants/theme';
import type { LineProgress } from '@/store/planning';
import type { CurrencyCode } from '@/store/types';

import { lineState } from './planUi';

interface PlanLineRowProps {
  line: LineProgress;
  name: string;
  currency: CurrencyCode;
  archived?: boolean;
  onPress: () => void;
}

// One plan line: name + ثابت/مرن · "{spent} من {limit}" + remaining (or "عدى الخطة بـ …") ·
// a thin progress bar. Approaching (flexible ≥ 85 %) is amber with "قرب الحد"; over is the one
// genuinely red state; a fixed bill paid to its limit shows "اتدفع".
export function PlanLineRow({ line, name, currency, archived = false, onPress }: PlanLineRowProps) {
  const state = lineState(line);
  const kindLabel = line.kind === 'fixed' ? 'ثابت' : 'مرن';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}، ${kindLabel}، ${formatMoney(line.spent, currency)} من ${formatMoney(line.limit, currency)}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.line1}>
        <AppText variant="bodyStrong" color={archived ? 'textMuted' : 'text'} numberOfLines={1} style={styles.flex}>
          {name}
        </AppText>
        {state === 'approaching' && <StatusChip label="قرب الحد" tone="attention" />}
        {state === 'paid' && <StatusChip label="اتدفع" tone="ok" />}
        <StatusChip label={kindLabel} tone="neutral" />
      </View>

      <View style={styles.line2}>
        <AppText variant="secondary" color="textSecondary" style={styles.flex} numberOfLines={1}>
          {formatMoney(line.spent, currency)} من {formatMoney(line.limit, currency)}
        </AppText>
        {state === 'over' ? (
          <View style={styles.over}>
            <MaterialIcons name="error-outline" size={16} color={colors.danger} />
            <AppText variant="secondary" color="danger">
              عدى الخطة بـ {formatMoney(line.spent - line.limit, currency)}
            </AppText>
          </View>
        ) : state === 'paid' ? null : (
          <AppText variant="secondary" color="textSecondary">
            متبقي {formatMoney(line.remaining, currency)}
          </AppText>
        )}
      </View>

      <ProgressBar
        progress={line.pct}
        height={6}
        tone={state === 'over' ? 'over' : state === 'approaching' ? 'attention' : 'normal'}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 64, paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.xs + space.xxs },
  pressed: { backgroundColor: colors.surfaceSubtle, opacity: opacity.pressed },
  line1: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.sm },
  line2: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  over: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.xs },
});
