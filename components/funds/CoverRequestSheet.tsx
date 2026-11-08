import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { FormSheet } from '@/components/ui/FormSheet';
import { formatMoney } from '@/components/ui/formatMoney';
import { space } from '@/constants/theme';
import { proposedOptions, reservationsOn, type CoverSelection, type OpOptions, type Shortfall } from '@/store/cover';
import { useFinanceStore } from '@/store/useFinanceStore';
import type { CoverRequest } from '@/utils/runActionCore';

interface CoverRequestSheetProps {
  request: CoverRequest;
  onClose: () => void;
}

// What runAction opens INSTEAD of an error message when an operation would eat into money reserved for funds (or
// take an account below zero): the account, the shortfall, and what to do about it. "تأكيد" runs the same action
// again with the decision; "إلغاء" leaves everything as it was.
//  - cover: which funds give the money back (the lowest-priority fund is chosen first; tap to change);
//  - conversion: an exchange would convert reserved money at its own rate (a confirmation);
//  - negative: the balance would go below zero (a confirmation).
export function CoverRequestSheet({ request, onClose }: CoverRequestSheetProps) {
  const state = useFinanceStore();
  const { shortfalls } = request.error;
  const accountName = (id: string) => state.accounts.find((a) => a.id === id)?.name ?? '—';
  const fundName = (id: string) => state.funds.find((f) => f.id === id)?.name ?? '—';

  // Per account with a cover shortfall: the funds the user lets give money back (starts at the proposal).
  const proposal = proposedOptions(request.error);
  const [chosen, setChosen] = useState<Record<string, string[]>>(() => {
    const initial: Record<string, string[]> = {};
    for (const s of shortfalls) {
      if (s.kind === 'cover') initial[s.accountId] = s.suggested.map((x) => x.fundId);
    }
    return initial;
  });

  // The cover of one account from the chosen funds, lowest priority first, exactly the shortfall when they hold enough.
  const coverFor = (s: Shortfall): CoverSelection[] => {
    const allowed = new Set(chosen[s.accountId] ?? []);
    const picks: CoverSelection[] = [];
    let left = s.amount;
    for (const r of reservationsOn(state, s.accountId)) {
      if (left <= 0.005) break;
      if (!allowed.has(r.fundId)) continue;
      const take = Math.min(left, r.amount);
      picks.push({ fundId: r.fundId, accountId: s.accountId, amount: Math.round(take * 100) / 100 });
      left = Math.round((left - take) * 100) / 100;
    }
    return left > 0.005 ? [] : picks;
  };

  const covers = shortfalls.filter((s) => s.kind === 'cover');
  const selection = covers.flatMap(coverFor);
  const complete = covers.every((s) => coverFor(s).length > 0);

  const toggle = (accountId: string, fundId: string) =>
    setChosen((prev) => {
      const current = prev[accountId] ?? [];
      return { ...prev, [accountId]: current.includes(fundId) ? current.filter((f) => f !== fundId) : [...current, fundId] };
    });

  const handleSave = () => {
    const options: OpOptions = {
      ...(selection.length > 0 ? { cover: selection } : {}),
      ...(proposal.follow ? { follow: proposal.follow } : {}),
      confirm: proposal.confirm ?? {},
    };
    onClose();
    request.retry(options);
  };

  return (
    <FormSheet visible title="محتاج تغطية" onCancel={onClose} onSave={handleSave} saveLabel="تأكيد" saveDisabled={!complete}>
      {shortfalls.map((s) => (
        <Card key={`${s.kind}-${s.accountId}`} variant="subtle" style={styles.card}>
          {s.kind === 'cover' && (
            <>
              <AppText variant="bodyStrong">
                العملية دي أكبر من المتاح في «{accountName(s.accountId)}» بـ {formatMoney(s.amount, s.currency)}.
              </AppText>
              <AppText variant="secondary" color="textSecondary">
                اختار الصناديق اللي هترجّع الفلوس دي (الأقل أولوية أول):
              </AppText>
              <ChipRow>
                {reservationsOn(state, s.accountId).map((r) => (
                  <Chip
                    key={r.fundId}
                    label={`${fundName(r.fundId)} · ${formatMoney(r.amount, s.currency)}`}
                    selected={(chosen[s.accountId] ?? []).includes(r.fundId)}
                    onPress={() => toggle(s.accountId, r.fundId)}
                  />
                ))}
              </ChipRow>
              <View accessibilityLabel="هتتاخد من">
                {coverFor(s).map((c) => (
                  <AppText key={c.fundId} variant="secondary">
                    {fundName(c.fundId)}: {formatMoney(c.amount, s.currency)}
                  </AppText>
                ))}
                {coverFor(s).length === 0 && (
                  <AppText variant="caption" color="danger">
                    الصناديق المختارة مش كفاية: لازم تغطي {formatMoney(s.amount, s.currency)} بالظبط.
                  </AppText>
                )}
              </View>
            </>
          )}
          {s.kind === 'conversion' && (
            <>
              <AppText variant="bodyStrong">
                {formatMoney(s.amount, s.currency)} من فلوس الصناديق في «{accountName(s.accountId)}» هتتحوّل مع التحويل بنفس سعره.
              </AppText>
              {s.suggested.map((x) => (
                <AppText key={x.fundId} variant="secondary">
                  {fundName(x.fundId)}: {formatMoney(x.amount, s.currency)}
                </AppText>
              ))}
            </>
          )}
          {s.kind === 'negative' && (
            <AppText variant="bodyStrong">
              رصيد «{accountName(s.accountId)}» هيبقى سالب بـ {formatMoney(s.amount, s.currency)}. تكمّل؟
            </AppText>
          )}
        </Card>
      ))}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.xs, marginBottom: space.sm },
});
