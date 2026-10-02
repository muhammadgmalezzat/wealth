import { Colors, FinanceColors } from '@/constants/theme';

interface DatePickerProps {
  value: string; // 'YYYY-MM-DD'
  onChange: (dateKey: string) => void;
  onClose: () => void;
}

// @react-native-community/datetimepicker has no web implementation; the browser's
// native date input already speaks 'YYYY-MM-DD'.
export function DatePicker({ value, onChange, onClose }: DatePickerProps) {
  return (
    <input
      type="date"
      value={value}
      autoFocus
      onChange={(event) => {
        if (event.target.value) {
          onChange(event.target.value);
          onClose();
        }
      }}
      style={{
        marginTop: 10,
        padding: 10,
        fontSize: 15,
        borderRadius: 10,
        border: `1px solid ${FinanceColors.progressTrack}`,
        backgroundColor: FinanceColors.cardBackground,
        color: Colors.light.text,
      }}
    />
  );
}
