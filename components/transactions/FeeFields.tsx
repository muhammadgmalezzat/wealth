import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { FormInput } from '@/components/ui/FormSheet';
import { Segment } from '@/components/ui/Segment';
import { space } from '@/constants/theme';
import type { Account } from '@/store/types';
import { currencySymbol } from '@/utils/formatters';

// Which of the two accounts a fee is charged to.
export type FeeSide = 'from' | 'to';
export interface FeeDraft {
  key: number;
  amountText: string;
  side: FeeSide;
}

interface FeeFieldsProps {
  fees: FeeDraft[];
  onChange: (fees: FeeDraft[]) => void;
  from: Account | undefined;
  to: Account | undefined;
}

// Optional charges of a transfer or exchange. Each one leaves the source or the target account, in that
// account's currency, and counts as spending ("رسوم").
export function FeeFields({ fees, onChange, from, to }: FeeFieldsProps) {
  const update = (key: number, patch: Partial<FeeDraft>) =>
    onChange(fees.map((fee) => (fee.key === key ? { ...fee, ...patch } : fee)));
  const next = fees.reduce((max, fee) => Math.max(max, fee.key), 0) + 1;
  const sideLabel = (account: Account | undefined, name: string) =>
    account ? `${name} · ${currencySymbol(account.currency)}` : name;
  return (
    <View style={styles.wrap}>
      {fees.map((fee) => (
        <View key={fee.key} style={styles.row} accessibilityLabel="رسوم">
          <AppText variant="secondary" color="textSecondary">
            رسوم
          </AppText>
          <FormInput
            value={fee.amountText}
            onChangeText={(text) => update(fee.key, { amountText: text })}
            placeholder="0"
            keyboardType="decimal-pad"
          />
          <Segment<FeeSide>
            options={[
              { label: sideLabel(from, 'من المرسل'), value: 'from' },
              { label: sideLabel(to, 'من المستلم'), value: 'to' },
            ]}
            value={fee.side}
            onChange={(side) => update(fee.key, { side })}
          />
          <Button
            label="شيل الرسوم"
            variant="tertiary"
            icon="close"
            onPress={() => onChange(fees.filter((f) => f.key !== fee.key))}
          />
        </View>
      ))}
      <Button
        label="إضافة رسوم"
        variant="tertiary"
        icon="add"
        onPress={() => onChange([...fees, { key: next, amountText: '', side: 'from' }])}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm, marginTop: space.md },
  row: { gap: space.xs },
});
