import { Pressable, StyleSheet, View } from 'react-native';

import { fundPercent } from '@/components/funds/fundsUi';
import { FUND_STATUS, fundStatusSentence } from '@/components/funds/labels';
import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { Money } from '@/components/ui/Money';
import { formatMoney } from '@/components/ui/formatMoney';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { StatusChip } from '@/components/ui/StatusChip';
import { opacity, space } from '@/constants/theme';
import {
  fundCurrent,
  fundDueDate,
  fundLinkedValue,
  fundProgress,
  fundRequiredMonthly,
  fundStatus,
} from '@/store/selectors';
import type { FinanceState, Fund } from '@/store/types';
import { formatDateAr } from '@/components/ui/formatDateAr';

interface FundCardProps {
  fund: Fund;
  state: FinanceState;
  onPress: () => void;
}

// Name + status · "current من target" · progress (gold part for linked gold) · one action
// sentence + percent · due date.
export function FundCard({ fund, state, onPress }: FundCardProps) {
  const status = fundStatus(state, fund.id);
  const chip = FUND_STATUS[status];
  const current = fundCurrent(state, fund.id);
  const progress = fundProgress(state, fund.id);
  // Capped at 100% ("تخطيت الهدف" past the target).
  const pct = fundPercent(progress);
  const linked = fundLinkedValue(state, fund.id);
  const due = fundDueDate(fund);
  const sentence = fundStatusSentence(status, {
    requiredMonthly: fundRequiredMonthly(state, fund.id),
    remaining: fund.targetAmount - current,
    currency: fund.currency,
  });

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${fund.name}، ${chip.label}`}
      style={({ pressed }) => pressed && { opacity: opacity.pressed }}>
      <Card style={styles.card}>
        <View style={styles.header}>
          <AppText variant="bodyStrong" style={styles.name} numberOfLines={2}>
            {fund.name}
          </AppText>
          {pct.over && <StatusChip label="تخطيت الهدف" tone="ok" />}
          <StatusChip label={chip.label} tone={chip.tone} />
        </View>

        <View style={styles.amounts}>
          <Money amount={current} currency={fund.currency} size="md" />
          <AppText variant="secondary" color="textSecondary">
            من {formatMoney(fund.targetAmount, fund.currency)}
          </AppText>
        </View>

        <ProgressBar
          progress={progress}
          tone={status === 'behind' ? 'attention' : 'normal'}
          goldPortion={linked > 0 && fund.targetAmount > 0 ? linked / fund.targetAmount : 0}
        />

        <View style={styles.footer}>
          <AppText variant="secondary" color="textSecondary" style={styles.sentence}>
            {sentence ?? ''}
          </AppText>
          <AppText variant="caption" color="textSecondary" style={styles.percent}>
            {`\u2066${pct.shown}%\u2069`}
          </AppText>
        </View>

        {due && (
          <AppText variant="secondary" color="textSecondary">
            الموعد: {formatDateAr(due)}
          </AppText>
        )}
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm },
  header: { flexDirection: 'row-reverse', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.sm },
  name: { flex: 1 },
  amounts: { flexDirection: 'row-reverse', alignItems: 'baseline', flexWrap: 'wrap', gap: space.sm },
  footer: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.sm },
  sentence: { flex: 1 },
  percent: { fontVariant: ['tabular-nums'] },
});
