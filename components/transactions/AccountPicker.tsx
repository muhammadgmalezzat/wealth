import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { colors, opacity, radius, space } from '@/constants/theme';
import type { Account } from '@/store/types';
import { currencySymbol } from '@/utils/formatters';

interface AccountPickerProps {
  // "من" / "إلى" / "دفعت من".
  label: string;
  accounts: Account[];
  selectedId: string;
  onSelect: (id: string) => void;
  // E.g. the other side of a transfer.
  disabledId?: string;
  error?: string | null;
}

// One compact line "{label} {account} · {currency}"; tapping it expands the account chips inline.
export function AccountPicker({ label, accounts, selectedId, onSelect, disabledId, error }: AccountPickerProps) {
  const selected = accounts.find((a) => a.id === selectedId);
  const [open, setOpen] = useState(!selected);

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${label} ${selected?.name ?? 'اختار حساب'}`}
        style={({ pressed }) => [styles.line, error ? styles.lineError : null, pressed && { opacity: opacity.pressed }]}>
        <AppText variant="secondary" color="textSecondary">
          {label}
        </AppText>
        <AppText variant="bodyStrong" style={styles.name} numberOfLines={1}>
          {selected ? `${selected.name} · ${currencySymbol(selected.currency)}` : 'اختار حساب'}
        </AppText>
        <MaterialIcons name={open ? 'expand-less' : 'expand-more'} size={22} color={colors.textSecondary} />
      </Pressable>
      {open && (
        <ChipRow>
          {accounts.map((a) => (
            <Chip
              key={a.id}
              label={`${a.name} · ${currencySymbol(a.currency)}`}
              selected={a.id === selectedId}
              disabled={a.id === disabledId}
              onPress={() => {
                onSelect(a.id);
                setOpen(false);
              }}
            />
          ))}
        </ChipRow>
      )}
      {error ? (
        <AppText variant="caption" color="danger">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: space.md, gap: space.sm },
  // RTL: label on the right, chevron on the left.
  line: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 48,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  lineError: { borderColor: colors.danger, backgroundColor: colors.dangerSurface },
  name: { flex: 1 },
});
