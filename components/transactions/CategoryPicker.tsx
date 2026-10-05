import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { space } from '@/constants/theme';
import { BUCKET_TITLES } from '@/components/plan/labels';
import type { Category, ExpenseBucket } from '@/store/types';

import { quickCategories } from './transactionUi';

interface CategoryPickerProps {
  categories: Category[];
  selectedId: string;
  lastUsedId?: string;
  onSelect: (id: string) => void;
  error?: string | null;
  // Show the full (grouped) list right away, e.g. while searching.
  forceExpanded?: boolean;
  // Defaults to "البند"; null hides it.
  label?: string | null;
}

const BUCKETS: ExpenseBucket[] = ['essentials', 'lifestyle', 'giving'];

// Up to 6 quick chips (last used first, the selected one always shown; flat) and "كل البنود",
// which expands the full list inline — grouped under أساسيات / رفاهيات / عطاء for expenses.
export function CategoryPicker({
  categories,
  selectedId,
  lastUsedId,
  onSelect,
  error,
  forceExpanded = false,
  label = 'البند',
}: CategoryPickerProps) {
  const [expandedState, setExpanded] = useState(false);
  const expanded = forceExpanded || expandedState;
  const { visible, hiddenCount } = quickCategories(categories, { lastUsedId, selectedId });
  const chip = (c: Category) => <Chip key={c.id} label={c.name} selected={c.id === selectedId} onPress={() => onSelect(c.id)} />;
  const grouped = categories.some((c) => c.kind === 'expense');

  return (
    <View style={styles.wrap}>
      {label !== null && (
        <AppText variant="caption" color="textSecondary">
          {label}
        </AppText>
      )}
      {!expanded ? (
        <ChipRow>
          {visible.map(chip)}
          {hiddenCount > 0 && <Chip label="كل البنود" onPress={() => setExpanded(true)} />}
        </ChipRow>
      ) : grouped ? (
        <>
          {BUCKETS.map((bucket) => {
            const inBucket = categories.filter((c) => c.bucket === bucket);
            if (inBucket.length === 0) return null;
            return (
              <View key={bucket} style={styles.group}>
                <AppText variant="micro" color="textSecondary">
                  {BUCKET_TITLES[bucket]}
                </AppText>
                <ChipRow>{inBucket.map(chip)}</ChipRow>
              </View>
            );
          })}
          {!forceExpanded && hiddenCount > 0 && (
            <ChipRow>
              <Chip label="أقل" onPress={() => setExpanded(false)} />
            </ChipRow>
          )}
        </>
      ) : (
        <ChipRow>
          {categories.map(chip)}
          {!forceExpanded && hiddenCount > 0 && <Chip label="أقل" onPress={() => setExpanded(false)} />}
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
  wrap: { marginTop: space.lg, gap: space.sm },
  group: { gap: 6 },
});
