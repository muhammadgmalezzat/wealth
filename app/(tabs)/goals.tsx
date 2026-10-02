import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FundCard } from '@/components/funds/FundCard';
import { FundSheet } from '@/components/funds/FundSheet';
import { FUND_SECTION_TITLES } from '@/components/funds/labels';
import { UnassignedPanel } from '@/components/funds/UnassignedPanel';
import { LoadingView } from '@/components/ui/LoadingView';
import { Colors } from '@/constants/theme';
import { fundsByPriority } from '@/store/selectors';
import type { Fund } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';

const SECTION_ORDER: Fund['type'][] = ['emergency', 'goal', 'sinking'];

export default function FundsScreen() {
  const insets = useSafeAreaInsets();
  const state = useFinanceStore();
  // Type preselected in the create sheet (e.g. from the emergency hint).
  const [creating, setCreating] = useState<Fund['type'] | null>(null);

  if (!state.hasHydrated) return <LoadingView />;

  const funds = fundsByPriority(state);

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 96 },
        ]}
        showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>الصناديق</Text>

        <UnassignedPanel state={state} />

        {SECTION_ORDER.map((type) => {
          const sectionFunds = funds.filter((f) => f.type === type);
          if (sectionFunds.length === 0 && type !== 'emergency') return null;
          return (
            <View key={type} style={styles.section}>
              <Text style={styles.sectionTitle}>{FUND_SECTION_TITLES[type]}</Text>
              {sectionFunds.length === 0 ? (
                <TouchableOpacity style={styles.emptyHint} onPress={() => setCreating('emergency')} activeOpacity={0.8}>
                  <Text style={styles.emptyText}>لسه معملتش صندوق طوارئ</Text>
                  <Text style={styles.emptyAction}>+ أنشئه دلوقتي</Text>
                </TouchableOpacity>
              ) : (
                sectionFunds.map((fund) => (
                  <View key={fund.id} style={styles.cardGap}>
                    <FundCard
                      fund={fund}
                      state={state}
                      onPress={() => router.push({ pathname: '/fund/[id]', params: { id: fund.id } })}
                    />
                  </View>
                ))
              )}
            </View>
          );
        })}
      </ScrollView>

      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 24 }]}
        onPress={() => setCreating('goal')}
        activeOpacity={0.85}
        accessibilityLabel="صندوق جديد">
        <MaterialIcons name="add" size={30} color="#fff" />
      </TouchableOpacity>

      {creating && <FundSheet initialType={creating} onClose={() => setCreating(null)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  content: {
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: Colors.light.text,
    textAlign: 'right',
    marginBottom: 16,
  },
  section: {
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.light.text,
    textAlign: 'right',
    marginBottom: 10,
  },
  cardGap: {
    marginBottom: 10,
  },
  emptyHint: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.light.icon,
    alignItems: 'flex-end',
    gap: 4,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.light.icon,
  },
  emptyAction: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.light.tint,
  },
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.light.tint,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
});
