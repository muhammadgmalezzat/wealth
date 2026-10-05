import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { space } from '@/constants/theme';
import type { Category } from '@/store/types';

import { quickCategories } from './transactionUi';

interface CategoryPickerProps {
  categories: Category[];
  selectedId: string;
  lastUsedId?: string;
  onSelect: (id: string) => void;
  error?: string | null;
}

// Up to 6 quick chips (last used first, the selected one always shown) and "كل البنود", which
// expands the full list inline.
export function CategoryPicker({ categories, selectedId, lastUsedId, onSelect, error }: CategoryPickerProps) {
  const [expanded, setExpanded] = useState(false);
  const { visible, hiddenCount } = quickCategories(categories, { lastUsedId, selectedId });
  const shown = expanded ? categories : visible;

  return (
    <View style={styles.wrap}>
      <AppText variant="caption" color="textSecondary">
        البند
      </AppText>
      <ChipRow>
        {shown.map((c) => (
          <Chip key={c.id} label={c.name} selected={c.id === selectedId} onPress={() => onSelect(c.id)} />
        ))}
        {!expanded && hiddenCount > 0 && <Chip label="كل البنود" onPress={() => setExpanded(true)} />}
        {expanded && categories.length > visible.length && <Chip label="أقل" onPress={() => setExpanded(false)} />}
      </ChipRow>
      {error ? (
        <AppText variant="caption" color="danger">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: space.lg, gap: space.sm },
});
