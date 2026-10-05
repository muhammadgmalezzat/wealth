import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors, space, type } from '@/constants/theme';
import { shiftMonth } from '@/utils/dates';
import { formatMonthLabel } from '@/utils/formatters';

interface MonthSwitcherProps {
  month: string; // 'YYYY-MM'
  onChange: (month: string) => void;
}

// ‹ أكتوبر ٢٠٢٦ › — RTL: previous month on the right, next on the left.
export function MonthSwitcher({ month, onChange }: MonthSwitcherProps) {
  return (
    <View style={styles.row}>
      <TouchableOpacity onPress={() => onChange(shiftMonth(month, 1))} hitSlop={10} style={styles.arrow} accessibilityLabel="الشهر التالي">
        <MaterialIcons name="chevron-left" size={28} color={colors.primary700} />
      </TouchableOpacity>
      <Text style={styles.label}>{formatMonthLabel(month)}</Text>
      <TouchableOpacity onPress={() => onChange(shiftMonth(month, -1))} hitSlop={10} style={styles.arrow} accessibilityLabel="الشهر السابق">
        <MaterialIcons name="chevron-right" size={28} color={colors.primary700} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.lg,
  },
  arrow: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  label: {
    ...type.title,
    color: colors.text,
  },
});
