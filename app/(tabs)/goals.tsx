import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { FundCard } from '@/components/funds/FundCard';
import { FundSheet } from '@/components/funds/FundSheet';
import { FUND_SECTION_TITLES } from '@/components/funds/labels';
import { UnassignedPanel } from '@/components/funds/UnassignedPanel';
import { Fab, FAB_CLEARANCE } from '@/components/ui/Fab';
import { LoadingView } from '@/components/ui/LoadingView';
import { Screen } from '@/components/ui/Screen';
import { Colors } from '@/constants/theme';
import { fundsByPriority } from '@/store/selectors';
import type { Fund } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';

const SECTION_ORDER: Fund['type'][] = ['emergency', 'goal', 'sinking'];

export default function FundsScreen() {
  const state = useFinanceStore();
  // Type preselected in the create sheet (e.g. from the emergency hint).
  const [creating, setCreating] = useState<Fund['type'] | null>(null);

  if (!state.hasHydrated) return <LoadingView />;

  const funds = fundsByPriority(state);

  return (
    <Screen
      scroll
      contentStyle={styles.content}
      overlay={<Fab placement="tab" onPress={() => setCreating('goal')} accessibilityLabel="صندوق جديد" />}>
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
      {creating && <FundSheet initialType={creating} onClose={() => setCreating(null)} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: FAB_CLEARANCE,
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
});
