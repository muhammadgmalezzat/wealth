import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CategorySheet } from '@/components/categories/CategorySheet';
import { BUCKET_TITLES } from '@/components/plan/labels';
import { Card } from '@/components/ui/Card';
import { LoadingView } from '@/components/ui/LoadingView';
import { Colors, FinanceColors } from '@/constants/theme';
import type { Category, ExpenseBucket } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';

const BUCKETS = Object.keys(BUCKET_TITLES) as ExpenseBucket[];

// "البنود": expense categories by bucket, income categories, and archived ones.
export default function CategoriesScreen() {
  const insets = useSafeAreaInsets();
  const state = useFinanceStore();
  const [sheet, setSheet] = useState<'add' | { id: string } | null>(null);

  if (!state.hasHydrated) return <LoadingView />;

  const active = state.categories.filter((c) => !c.archived);
  const archived = state.categories.filter((c) => c.archived);
  const editing = sheet && sheet !== 'add' ? state.categories.find((c) => c.id === sheet.id) : undefined;

  const list = (categories: Category[]) =>
    categories.length === 0 ? (
      <Text style={styles.muted}>مفيش بنود</Text>
    ) : (
      <Card style={styles.listCard}>
        {categories.map((c, i) => (
          <TouchableOpacity
            key={c.id}
            style={[styles.row, i < categories.length - 1 && styles.rowBorder]}
            onPress={() => setSheet({ id: c.id })}
            activeOpacity={0.8}>
            <Text style={styles.chevron}>‹</Text>
            {c.isDefault && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>أساسي</Text>
              </View>
            )}
            {c.archived && c.kind === 'expense' && (
              <Text style={styles.muted}>{BUCKET_TITLES[c.bucket as ExpenseBucket]}</Text>
            )}
            <Text style={styles.name}>{c.name}</Text>
          </TouchableOpacity>
        ))}
      </Card>
    );

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 96 }]}>
        <Text style={styles.sectionTitle}>مصروفات</Text>
        {BUCKETS.map((bucket) => (
          <View key={bucket}>
            <Text style={styles.bucketTitle}>{BUCKET_TITLES[bucket]}</Text>
            {list(active.filter((c) => c.kind === 'expense' && c.bucket === bucket))}
          </View>
        ))}

        <Text style={styles.sectionTitle}>دخل</Text>
        {list(active.filter((c) => c.kind === 'income'))}

        {archived.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>مؤرشفة</Text>
            <Text style={[styles.muted, styles.archivedHint]}>
              مش بتظهر في الاختيارات، بس معاملاتها لسه في السجل والتقارير.
            </Text>
            {list(archived)}
          </>
        )}
      </ScrollView>

      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 24 }]}
        onPress={() => setSheet('add')}
        activeOpacity={0.85}
        accessibilityLabel="بند جديد">
        <MaterialIcons name="add" size={30} color="#fff" />
      </TouchableOpacity>

      {sheet === 'add' && <CategorySheet onClose={() => setSheet(null)} />}
      {editing && <CategorySheet key={editing.id} category={editing} onClose={() => setSheet(null)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.light.background },
  content: { padding: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: Colors.light.text, textAlign: 'right', marginTop: 18, marginBottom: 6 },
  bucketTitle: { fontSize: 14, fontWeight: '600', color: Colors.light.icon, textAlign: 'right', marginTop: 10, marginBottom: 6 },
  listCard: { padding: 0, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 12 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: FinanceColors.progressTrack },
  chevron: { fontSize: 18, color: Colors.light.icon },
  name: { flex: 1, fontSize: 15, color: Colors.light.text, textAlign: 'right' },
  badge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1, backgroundColor: Colors.light.icon + '22' },
  badgeText: { fontSize: 10, fontWeight: '700', color: Colors.light.icon },
  muted: { fontSize: 12, color: Colors.light.icon, textAlign: 'right' },
  archivedHint: { marginBottom: 8 },
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.light.tint,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
});
