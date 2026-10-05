import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { CategorySheet } from '@/components/categories/CategorySheet';
import { BUCKET_TITLES } from '@/components/plan/labels';
import { AppText } from '@/components/ui/AppText';
import { Fab, FAB_CLEARANCE } from '@/components/ui/Fab';
import { ListGroup, ListRow } from '@/components/ui/ListRow';
import { LoadingView } from '@/components/ui/LoadingView';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { StatusChip } from '@/components/ui/StatusChip';
import { space } from '@/constants/theme';
import type { Category, ExpenseBucket } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';

const BUCKETS = Object.keys(BUCKET_TITLES) as ExpenseBucket[];

// "البنود": a dense utility list — أساسيات · رفاهيات · عطاء · دخل · مؤرشفة (empty sections skipped).
export default function CategoriesScreen() {
  const state = useFinanceStore();
  const [sheet, setSheet] = useState<'add' | { id: string } | null>(null);

  if (!state.hasHydrated) return <LoadingView />;

  const active = state.categories.filter((c) => !c.archived);
  const archived = state.categories.filter((c) => c.archived);
  const editing = sheet && sheet !== 'add' ? state.categories.find((c) => c.id === sheet.id) : undefined;

  const sections: { title: string; items: Category[]; hint?: string }[] = [
    ...BUCKETS.map((bucket) => ({
      title: BUCKET_TITLES[bucket],
      items: active.filter((c) => c.kind === 'expense' && c.bucket === bucket),
    })),
    { title: 'دخل', items: active.filter((c) => c.kind === 'income') },
    { title: 'مؤرشفة', items: archived, hint: 'مش بتظهر في الاختيارات، بس معاملاتها لسه في السجل والتقارير.' },
  ];

  return (
    <Screen
      scroll
      edges={['bottom']}
      contentStyle={styles.content}
      overlay={<Fab placement="stack" onPress={() => setSheet('add')} accessibilityLabel="بند جديد" />}>
      {sections.map((section) =>
        section.items.length === 0 ? null : (
          <View key={section.title}>
            <SectionHeader title={section.title} />
            {section.hint && (
              <AppText variant="caption" color="textSecondary" style={styles.hint}>
                {section.hint}
              </AppText>
            )}
            <ListGroup>
              {section.items.map((c) => (
                <ListRow
                  key={c.id}
                  title={c.name}
                  titleColor={c.archived ? 'textMuted' : undefined}
                  subtitle={c.archived && c.kind === 'expense' ? BUCKET_TITLES[c.bucket as ExpenseBucket] : undefined}
                  subtitleLines={1}
                  trailing={c.isDefault ? <StatusChip label="أساسي" tone="neutral" /> : undefined}
                  chevron
                  onPress={() => setSheet({ id: c.id })}
                />
              ))}
            </ListGroup>
          </View>
        )
      )}

      {sheet === 'add' && <CategorySheet onClose={() => setSheet(null)} />}
      {editing && <CategorySheet key={editing.id} category={editing} onClose={() => setSheet(null)} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, paddingBottom: FAB_CLEARANCE, gap: space.sm },
  hint: { marginBottom: space.sm },
});
