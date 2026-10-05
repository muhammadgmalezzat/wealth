import { colors, radius, space, type } from '@/constants/theme';

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
        marginTop: space.sm,
        minHeight: 48,
        padding: space.md,
        fontSize: type.body.fontSize,
        borderRadius: radius.md,
        border: `1px solid ${colors.borderStrong}`,
        backgroundColor: colors.surface,
        color: colors.text,
        direction: 'rtl',
      }}
    />
  );
}
