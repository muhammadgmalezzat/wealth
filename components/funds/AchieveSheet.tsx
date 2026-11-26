import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { FormSheet } from '@/components/ui/FormSheet';
import { formatMoney } from '@/components/ui/formatMoney';
import { space } from '@/constants/theme';
import type { Fund } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { runAction } from '@/utils/runAction';

import { achieveSummary } from './goalsUi';

interface AchieveSheetProps {
  fund: Fund;
  onClose: () => void;
}

// «مبروك! 🎉» (FUND_SPEND §5.3): the user's explicit confirmation that a goal is done (AC-2). When money is still
// reserved for it, the user must choose: give it back to free money, or keep it in the fund (no default; never
// released by itself, AC-4). Saved in one step (achieveFund).
export function AchieveSheet({ fund, onClose }: AchieveSheetProps) {
  const state = useFinanceStore();
  const { targetLine, leftover } = achieveSummary(state, fund);
  const hasLeftover = leftover.length > 0;
  const [choice, setChoice] = useState<'release' | 'keep' | null>(null);

  const handleSave = () => {
    const releaseLeftover = hasLeftover && choice === 'release';
    if (runAction('تعذّر الحفظ', () => state.achieveFund(fund.id, { releaseLeftover }))) onClose();
  };

  return (
    <FormSheet visible title="مبروك! 🎉" onCancel={onClose} onSave={handleSave} saveLabel="تم" saveDisabled={hasLeftover && choice === null}>
      <Card variant="subtle" style={styles.card}>
        <AppText variant="bodyStrong">{fund.name}</AppText>
        <AppText variant="secondary" color="textSecondary">
          {targetLine}
        </AppText>
      </Card>

      {hasLeftover ? (
        <View style={styles.leftover}>
          {leftover.map((l) => (
            <AppText key={l.accountId} variant="secondary">
              لسه محجوز {formatMoney(l.amount, l.currency)} في «{l.name}»
            </AppText>
          ))}
          <AppText variant="secondary" color="textSecondary">
            تعمل إيه بالباقي؟
          </AppText>
          <ChipRow>
            <Chip label="رجّع الباقي للفلوس الحرة" selected={choice === 'release'} onPress={() => setChoice('release')} />
            <Chip label="سيبه في الصندوق" selected={choice === 'keep'} onPress={() => setChoice('keep')} />
          </ChipRow>
          {choice === 'keep' && (
            <AppText variant="caption" color="textSecondary">
              هيفضل محجوز وظاهر في الصندوق، وتقدر ترجّعه أو تنقله لصندوق تاني بعدين.
            </AppText>
          )}
        </View>
      ) : (
        <AppText variant="secondary" color="textSecondary" style={styles.leftover}>
          مفيش فلوس لسه محجوزة للهدف ده.
        </AppText>
      )}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.xs },
  leftover: { marginTop: space.md, gap: space.sm },
});
