import { useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { PastDateField } from '@/components/ui/DateFields';
import { FormField } from '@/components/ui/FormField';
import { formatDateAr } from '@/components/ui/formatDateAr';
import { FormSheet } from '@/components/ui/FormSheet';
import { colors, opacity, radius, space } from '@/constants/theme';
import type { Alignment } from '@/store/comparison';
import type { AnalyticsPeriod, PeriodPreset } from '@/store/periods';
import { toDateKey } from '@/utils/dates';

import { periodLine, pillLabel, PRESET_LABELS, PRESET_ORDER, previousPillLabel } from './overviewUi';

// The pill at the top of Overview / Compare: «الشهر ده ▾», with the dates under it.
// `previous`: the period is "the one before" another (its preset's name would be wrong, e.g. «الشهر ده» for October).
export function PeriodPill({ period, onPress, label, previous = false }: { period: AnalyticsPeriod; onPress: () => void; label?: string; previous?: boolean }) {
  const text = previous ? previousPillLabel() : pillLabel(period);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label ? `${label}: ` : ''}الفترة: ${text}`} style={({ pressed }) => [styles.pillWrap, pressed && styles.pressed]}>
      <View style={styles.pill}>
        <AppText variant="bodyStrong" color="primary800">
          {label ? `${label}: ${text}` : text}
        </AppText>
      </View>
      <AppText variant="caption" color="textSecondary">
        {periodLine(period)}
      </AppText>
    </Pressable>
  );
}

export interface PeriodChoice {
  preset: PeriodPreset;
  custom?: { from: string; to: string };
  alignment: Alignment;
  // undefined = leave the manual pay-cycle start as it is; null = back to automatic; a date = start the cycle there.
  payCycleStart?: string | null;
}

interface PeriodSheetProps {
  title?: string;
  initial: PeriodChoice;
  // Resolves a draft choice with the engine (shows the pay cycle it would give, and whether it is in progress).
  resolve: (choice: PeriodChoice) => AnalyticsPeriod;
  // The current manual pay-cycle start (a preference), if any.
  payCycleOverride?: string;
  // Offer the pay-cycle start and the alignment switch (the Overview does; Compare's period A doesn't need them).
  showCycleStart?: boolean;
  showAlignment?: boolean;
  onCancel: () => void;
  onSave: (choice: PeriodChoice) => void;
}

// Every preset (incl. دورة الراتب and a custom range), and for periods still running: compare with the same days of the
// previous period (default) or all of it.
export function PeriodSheet({ title = 'الفترة', initial, resolve, payCycleOverride, showCycleStart = true, showAlignment = true, onCancel, onSave }: PeriodSheetProps) {
  const today = toDateKey(new Date());
  const [draft, setDraft] = useState<PeriodChoice>(() => ({
    ...initial,
    custom: initial.custom ?? { from: `${today.slice(0, 7)}-01`, to: today },
  }));
  const [editingStart, setEditingStart] = useState(false);
  const override = draft.payCycleStart === undefined ? payCycleOverride : draft.payCycleStart ?? undefined;
  const preview = resolve({ ...draft, payCycleStart: draft.payCycleStart });

  return (
    <FormSheet visible title={title} onCancel={onCancel} onSave={() => onSave(draft)} saveLabel="تمام">
      <ChipRow>
        {PRESET_ORDER.map((preset) => (
          <Chip key={preset} label={PRESET_LABELS[preset]} selected={draft.preset === preset} onPress={() => setDraft({ ...draft, preset })} />
        ))}
      </ChipRow>

      {draft.preset === 'custom' && draft.custom && (
        <View style={styles.block}>
          <FormField label="من">
            <PastDateField value={draft.custom.from} onChange={(from) => setDraft({ ...draft, custom: { ...draft.custom!, from } })} />
          </FormField>
          <FormField label="إلى">
            <PastDateField value={draft.custom.to} onChange={(to) => setDraft({ ...draft, custom: { ...draft.custom!, to } })} />
          </FormField>
        </View>
      )}

      {draft.preset === 'payCycle' && showCycleStart && (
        <View style={styles.block}>
          <AppText variant="secondary" color="textSecondary">
            الدورة بتبدأ من يوم ما الراتب بيوصل فعلاً، مش من يوم ثابت.
          </AppText>
          <AppText variant="secondary">{`الدورة دي: ${periodLine(preview)}`}</AppText>
          <ChipRow>
            <Chip label={override ? `البداية: ${formatDateAr(override)}` : 'غيّر بداية الدورة'} selected={!!override} onPress={() => setEditingStart(true)} />
            {override && <Chip label="رجّعها تلقائي" onPress={() => setDraft({ ...draft, payCycleStart: null })} />}
          </ChipRow>
          {editingStart && (
            <FormField label="الدورة الحالية بدأت يوم">
              <PastDateField
                value={override ?? today}
                onChange={(date) => {
                  setDraft({ ...draft, payCycleStart: date });
                  setEditingStart(false);
                }}
              />
            </FormField>
          )}
        </View>
      )}

      {showAlignment && preview.inProgress && (
        <View style={styles.switchRow}>
          <AppText variant="secondary" style={styles.flex}>
            قارن بالفترة اللي فاتت كلها (مش لحد نفس اليوم)
          </AppText>
          <Switch
            value={draft.alignment === 'full'}
            onValueChange={(full) => setDraft({ ...draft, alignment: full ? 'full' : 'elapsed' })}
            trackColor={{ true: colors.primary600, false: colors.borderStrong }}
            thumbColor={colors.text}
            accessibilityLabel="قارن بالفترة اللي فاتت كلها"
          />
        </View>
      )}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  pillWrap: { alignItems: 'flex-end', gap: space.xxs },
  pill: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.primary700,
    backgroundColor: colors.primary50,
  },
  pressed: { opacity: opacity.pressed },
  block: { marginTop: space.lg, gap: space.sm },
  switchRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.md, marginTop: space.lg },
  flex: { flex: 1 },
});
