import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { FormField } from '@/components/ui/FormField';
import { FormInput } from '@/components/ui/FormSheet';
import { Segment } from '@/components/ui/Segment';
import { colors, space } from '@/constants/theme';
import type { GoldKarat, Location } from '@/store/types';

export type KaratOption = `${GoldKarat}`;

interface GoldFieldsProps {
  weightText: string;
  onWeightText: (text: string) => void;
  karat: KaratOption;
  onKarat: (karat: KaratOption) => void;
  location: Location;
  onLocation: (location: Location) => void;
  name: string;
  onName: (name: string) => void;
}

// Gold purchase details: weight, karat, location and an optional name (the auto-name is the
// placeholder). The purchase cost is the amount at the top of the sheet.
export function GoldFields({ weightText, onWeightText, karat, onKarat, location, onLocation, name, onName }: GoldFieldsProps) {
  return (
    <View style={styles.section}>
      <View style={styles.titleRow}>
        <View style={styles.dot} />
        <AppText variant="caption" color="goldText" style={styles.title}>
          تفاصيل الذهب
        </AppText>
      </View>

      <FormField label="الوزن (جرام)">
        <FormInput value={weightText} onChangeText={onWeightText} placeholder="0" keyboardType="decimal-pad" />
      </FormField>

      <FormField label="العيار">
        <Segment<KaratOption>
          options={[
            { label: 'عيار 24', value: '24' },
            { label: 'عيار 21', value: '21' },
            { label: 'عيار 18', value: '18' },
          ]}
          value={karat}
          onChange={onKarat}
        />
      </FormField>

      <FormField label="مكانه">
        <Segment<Location>
          options={[
            { label: 'مصر', value: 'EG' },
            { label: 'السعودية', value: 'SA' },
          ]}
          value={location}
          onChange={onLocation}
        />
      </FormField>

      <FormField label="الاسم (اختياري)" helper="شراء الذهب مش مصروف: الفلوس بتتحول من الحساب لذهب بنفس التكلفة.">
        <FormInput value={name} onChangeText={onName} placeholder={`ذهب ${weightText.trim() || '…'} جم عيار ${karat}`} />
      </FormField>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: space.xl },
  titleRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.gold },
  title: { fontWeight: '700' },
});
