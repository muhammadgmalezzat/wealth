import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { FormInput, FormSheet } from '@/components/ui/FormSheet';
import { formatMoney } from '@/components/ui/formatMoney';
import { colors, opacity, radius, space } from '@/constants/theme';
import {
  defaultExpensePicks,
  expenseSplit,
  proposedOptions,
  reservationsOn,
  type CoverSelection,
  type ExpenseChoice,
  type OpOptions,
  type Shortfall,
} from '@/store/cover';
import { useFinanceStore } from '@/store/useFinanceStore';
import { parseAmount } from '@/utils/parseAmount';
import type { CoverRequest } from '@/utils/runActionCore';

import { coverPicks, splitProblemText } from './goalsUi';

interface CoverRequestSheetProps {
  request: CoverRequest;
  onClose: () => void;
}

// What runAction opens INSTEAD of an error message when an operation would eat into money reserved for funds (or
// take an account below zero). "تأكيد" runs the same action again with the decision; "إلغاء" leaves everything as it
// was (AC-10).
//  - an EXPENSE bigger than the free money («تدفعه منين؟», FUND_SPEND §5.2): two cards, neither preselected (Q1) —
//    «من صندوق» (spend: the purchase was the fund's purpose; editable total between the bounds) and
//    «من الفلوس الحرة الأول» (cover: free money first, exactly the shortfall from the funds you tick);
//  - any other cover: which funds give the money back (the lowest-priority fund first; tap to change);
//  - conversion: an exchange would convert reserved money at its own rate (a confirmation);
//  - negative: the balance would go below zero (a confirmation).
export function CoverRequestSheet({ request, onClose }: CoverRequestSheetProps) {
  const state = useFinanceStore();
  const { shortfalls } = request.error;
  const accountName = (id: string) => state.accounts.find((a) => a.id === id)?.name ?? '—';
  const fundName = (id: string) => state.funds.find((f) => f.id === id)?.name ?? '—';
  const proposal = proposedOptions(request.error);

  const covers = shortfalls.filter((s) => s.kind === 'cover');
  const plainCovers = covers.filter((s) => !s.expense);
  const expenseCovers = covers.filter((s) => s.expense);

  // Plain covers: per account, the funds the user lets give money back (starts at the proposal).
  const [chosen, setChosen] = useState<Record<string, string[]>>(() => {
    const initial: Record<string, string[]> = {};
    for (const s of plainCovers) initial[s.accountId] = s.suggested.map((x) => x.fundId);
    return initial;
  });
  // Expense covers: per account, the card (none at first), the «من صندوق» amounts, the «الفلوس الحرة الأول» funds.
  const [choice, setChoice] = useState<Record<string, ExpenseChoice | null>>({});
  const [spendText, setSpendText] = useState<Record<string, Record<string, string>>>(() => {
    const initial: Record<string, Record<string, string>> = {};
    for (const s of expenseCovers) {
      initial[s.accountId] = Object.fromEntries(defaultExpensePicks(s.expense!, 'spend').map((p) => [p.fundId, String(p.amount)]));
    }
    return initial;
  });
  const [coverFunds, setCoverFunds] = useState<Record<string, string[]>>(() => {
    const initial: Record<string, string[]> = {};
    for (const s of expenseCovers) initial[s.accountId] = defaultExpensePicks(s.expense!, 'cover').map((p) => p.fundId);
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

  const splitFor = (s: Shortfall) => {
    const context = s.expense!;
    const card = choice[s.accountId] ?? null;
    const picks =
      card === 'spend'
        ? Object.entries(spendText[s.accountId] ?? {})
            .filter(([, text]) => text.trim() !== '')
            .map(([fundId, text]) => ({ fundId, amount: parseAmount(text) ?? NaN }))
        : card === 'cover'
          ? coverPicks(context, coverFunds[s.accountId] ?? [])
          : [];
    return expenseSplit(context, s.accountId, s.currency, card, picks);
  };

  const plainSelection = plainCovers.flatMap(coverFor);
  const plainComplete = plainCovers.every((s) => coverFor(s).length > 0);
  const splits = expenseCovers.map((s) => ({ s, split: splitFor(s) }));
  const complete = plainComplete && splits.every(({ split }) => !split.problem);

  const toggle = (accountId: string, fundId: string) =>
    setChosen((prev) => {
      const current = prev[accountId] ?? [];
      return { ...prev, [accountId]: current.includes(fundId) ? current.filter((f) => f !== fundId) : [...current, fundId] };
    });
  const toggleCoverFund = (accountId: string, fundId: string) =>
    setCoverFunds((prev) => {
      const current = prev[accountId] ?? [];
      return { ...prev, [accountId]: current.includes(fundId) ? current.filter((f) => f !== fundId) : [...current, fundId] };
    });

  const handleSave = () => {
    const spend = splits.flatMap(({ split }) => split.options.spend ?? []);
    const cover = [...plainSelection, ...splits.flatMap(({ split }) => split.options.cover ?? [])];
    const options: OpOptions = {
      ...(cover.length > 0 ? { cover } : {}),
      ...(spend.length > 0 ? { spend } : {}),
      ...(proposal.follow ? { follow: proposal.follow } : {}),
      confirm: proposal.confirm ?? {},
    };
    onClose();
    request.retry(options);
  };

  const title = expenseCovers.length > 0 ? 'تدفعه منين؟' : 'محتاج تغطية';

  return (
    <FormSheet visible title={title} onCancel={onClose} onSave={handleSave} saveLabel="تأكيد" saveDisabled={!complete}>
      {splits.map(({ s, split }) => {
        const context = s.expense!;
        const card = choice[s.accountId] ?? null;
        const pick = (next: ExpenseChoice) => setChoice((prev) => ({ ...prev, [s.accountId]: next }));
        const freeAfter = Math.round((context.freeBefore - split.fromFree) * 100) / 100;
        return (
          <View key={`expense-${s.accountId}`} style={styles.expense}>
            <AppText variant="bodyStrong">
              المصروف {formatMoney(context.amount, s.currency)} والفلوس الحرة في «{accountName(s.accountId)}» {formatMoney(context.freeBefore, s.currency)} بس.
            </AppText>

            {/* «من صندوق»: spend — counts toward the goal; deleting the expense gives it back. */}
            <ChoiceCard
              selected={card === 'spend'}
              onPress={() => pick('spend')}
              title="من صندوق"
              body="اصرف من فلوس صندوق كنت محوّش لها.">
              {card === 'spend' && (
                <View style={styles.inside}>
                  {context.funds.map((f) => (
                    <View key={f.fundId} style={styles.fundRow}>
                      <AppText variant="secondary" style={styles.flex}>
                        {fundName(f.fundId)} · فيه {formatMoney(f.amount, s.currency)}
                      </AppText>
                      <FormInput
                        value={spendText[s.accountId]?.[f.fundId] ?? ''}
                        onChangeText={(text) => setSpendText((prev) => ({ ...prev, [s.accountId]: { ...(prev[s.accountId] ?? {}), [f.fundId]: text } }))}
                        placeholder="0"
                        keyboardType="decimal-pad"
                        accessibilityLabel={`من ${fundName(f.fundId)}`}
                        style={styles.input}
                      />
                    </View>
                  ))}
                  <AppText variant="caption" color="textSecondary" style={styles.tabular}>
                    من الصناديق {formatMoney(split.fromFunds, s.currency)} · من الفلوس الحرة {formatMoney(split.fromFree, s.currency)} · فلوسك الحرة هتفضل {formatMoney(Math.max(0, freeAfter), s.currency)}
                  </AppText>
                </View>
              )}
            </ChoiceCard>

            {/* «من الفلوس الحرة الأول»: cover — free money first, exactly the shortfall borrowed from funds. */}
            <ChoiceCard
              selected={card === 'cover'}
              onPress={() => pick('cover')}
              title="من الفلوس الحرة الأول"
              body={`ادفع ${formatMoney(context.freeBefore, s.currency)} من الفلوس الحرة، والـ ${formatMoney(context.minFromFunds, s.currency)} الباقيين سلفة من صندوق.`}>
              {card === 'cover' && (
                <View style={styles.inside}>
                  <ChipRow>
                    {context.funds.map((f) => (
                      <Chip
                        key={f.fundId}
                        label={`${fundName(f.fundId)} · ${formatMoney(f.amount, s.currency)}`}
                        selected={(coverFunds[s.accountId] ?? []).includes(f.fundId)}
                        onPress={() => toggleCoverFund(s.accountId, f.fundId)}
                      />
                    ))}
                  </ChipRow>
                  {(split.options.cover ?? []).map((c) => (
                    <AppText key={c.fundId} variant="secondary" style={styles.tabular}>
                      {fundName(c.fundId)}: {formatMoney(c.amount, s.currency)}
                    </AppText>
                  ))}
                  <AppText variant="caption" color="textSecondary">
                    فلوسك الحرة هتبقى صفر.
                  </AppText>
                </View>
              )}
            </ChoiceCard>

            {split.problem && split.problem !== 'NOTHING_CHOSEN' && (
              <AppText variant="caption" color="danger">
                {splitProblemText(split.problem, context, s.currency)}
              </AppText>
            )}
          </View>
        );
      })}

      {shortfalls
        .filter((s) => !(s.kind === 'cover' && s.expense))
        .map((s) => (
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

// A selectable card (radio-like): the border shows the choice; the label says it too (never colour alone).
function ChoiceCard({ selected, onPress, title, body, children }: { selected: boolean; onPress: () => void; title: string; body: string; children?: React.ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={title}
      style={({ pressed }) => [styles.choice, selected && styles.choiceSelected, pressed && { opacity: opacity.pressed }]}>
      <View style={styles.choiceHeader}>
        <View style={[styles.radio, selected && styles.radioOn]} />
        <AppText variant="bodyStrong" style={styles.flex}>
          {title}
        </AppText>
      </View>
      <AppText variant="secondary" color="textSecondary">
        {body}
      </AppText>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.xs, marginBottom: space.sm },
  expense: { gap: space.sm, marginBottom: space.md },
  choice: {
    gap: space.xs,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSubtle,
  },
  choiceSelected: { borderColor: colors.primary600, borderWidth: 2 },
  choiceHeader: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.sm },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.borderStrong },
  radioOn: { borderColor: colors.primary600, backgroundColor: colors.primary600 },
  inside: { gap: space.sm, marginTop: space.sm },
  fundRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.sm },
  input: { width: 110 },
  flex: { flex: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
});
