import { useState } from 'react';

import { Chip, ChipRow } from '@/components/ui/Chip';
import { DatePicker } from '@/components/ui/DatePicker';
import { shiftDate, toDateKey } from '@/utils/dates';
import { formatDateAr } from './formatDateAr';

interface PastDateFieldProps {
  value: string; // 'YYYY-MM-DD'
  onChange: (dateKey: string) => void;
}

// For when something happened: النهارده / امبارح / تاريخ تاني.
export function PastDateField({ value, onChange }: PastDateFieldProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const today = toDateKey(new Date());
  const yesterday = shiftDate(today, -1);
  const other = value !== today && value !== yesterday;

  return (
    <>
      <ChipRow>
        <Chip label="النهارده" selected={value === today} onPress={() => onChange(today)} />
        <Chip label="امبارح" selected={value === yesterday} onPress={() => onChange(yesterday)} />
        <Chip label={other ? formatDateAr(value) : 'تاريخ تاني'} selected={other} onPress={() => setPickerOpen(true)} />
      </ChipRow>
      {pickerOpen && <DatePicker value={value} onChange={onChange} onClose={() => setPickerOpen(false)} />}
    </>
  );
}

interface FutureDateFieldProps {
  value: string | undefined;
  onChange: (dateKey: string | undefined) => void;
  // Shows a chip that clears the date (e.g. "بدون موعد").
  clearLabel?: string;
}

// For deadlines and due dates: pick a date, optionally none.
export function FutureDateField({ value, onChange, clearLabel }: FutureDateFieldProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <>
      <ChipRow>
        {clearLabel && <Chip label={clearLabel} selected={!value} onPress={() => onChange(undefined)} />}
        <Chip label={value ? formatDateAr(value) : 'اختر تاريخ'} selected={!!value} onPress={() => setPickerOpen(true)} />
      </ChipRow>
      {pickerOpen && (
        <DatePicker
          value={value ?? toDateKey(new Date())}
          onChange={onChange}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  );
}
