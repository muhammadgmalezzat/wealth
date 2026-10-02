import DateTimePicker from '@react-native-community/datetimepicker';
import { Platform } from 'react-native';

import { fromDateKey, toDateKey } from '@/utils/dates';

interface DatePickerProps {
  value: string; // 'YYYY-MM-DD'
  onChange: (dateKey: string) => void;
  onClose: () => void;
}

// Native date picker, mounted only while open. Android shows a dialog; iOS shows an
// inline calendar. Picking a day closes it. See DatePicker.web.tsx for web.
export function DatePicker({ value, onChange, onClose }: DatePickerProps) {
  return (
    <DateTimePicker
      value={fromDateKey(value)}
      mode="date"
      display={Platform.OS === 'ios' ? 'inline' : 'default'}
      onValueChange={(_event, date) => {
        onChange(toDateKey(date));
        onClose();
      }}
      onDismiss={onClose}
    />
  );
}
