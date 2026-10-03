import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Colors } from '@/constants/theme';
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
      <TouchableOpacity onPress={() => onChange(shiftMonth(month, 1))} hitSlop={10} accessibilityLabel="الشهر التالي">
        <MaterialIcons name="chevron-left" size={28} color={Colors.light.tint} />
      </TouchableOpacity>
      <Text style={styles.label}>{formatMonthLabel(month)}</Text>
      <TouchableOpacity onPress={() => onChange(shiftMonth(month, -1))} hitSlop={10} accessibilityLabel="الشهر السابق">
        <MaterialIcons name="chevron-right" size={28} color={Colors.light.tint} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  label: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.light.text,
  },
});
