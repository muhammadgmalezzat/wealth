import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { FormSheet } from '@/components/ui/FormSheet';
import { formatMoney } from '@/components/ui/formatMoney';
import { space } from '@/constants/theme';
import { accountAvailable } from '@/store/selectors';
import type { CurrencyCode, UnresolvedReason } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { runAction } from '@/utils/runAction';

const REASONS: Record<UnresolvedReason, string> = {
  ambiguous: 'أكتر من حساب ممكن يشيلها، ومعرفتش أختار لوحدي.',
  insufficient: 'مفيش حساب بالعملة دي يكفيها لوحده.',
  negative: 'صافيها سالب (سحب أكتر من اللي اتحط).',
  no_account: 'مفيش حساب بالعملة دي.',
};

interface Group {
  key: string;
  fundId: string;
  currency: CurrencyCode;
  amount: number;
  reason: UnresolvedReason;
}

interface ResolveSheetProps {
  onClose: () => void;
}

// "حدّد الحساب": a fund's money that the v7 → v8 migration could not place on ONE account without guessing. Pick the
// account that holds it (it must hold it: reservations never exceed a balance); saving is the one confirmation. Until
// then the money counts toward the fund and is its own line, "محجوز ومش محدد حسابه".
export function ResolveSheet({ onClose }: ResolveSheetProps) {
  const state = useFinanceStore();
  const groups: Group[] = [];
  for (const m of state.unresolvedMovements) {
    const key = `${m.fundId}|${m.currency}`;
    const group = groups.find((g) => g.key === key);
    if (group) group.amount = Math.round((group.amount + m.amount) * 100) / 100;
    else groups.push({ key, fundId: m.fundId, currency: m.currency, amount: m.amount, reason: m.reason });
  }
  const [picked, setPicked] = useState<Record<string, string>>({});
  const fundName = (id: string) => state.funds.find((f) => f.id === id)?.name ?? '—';

  // An account can take it only if it holds it free (a release of a negative net needs the reservation to exist).
  const fits = (g: Group, accountId: string) =>
    g.amount >= 0 ? accountAvailable(state, accountId) >= g.amount - 0.005 : true;

  const handleSave = () => {
    for (const g of groups) {
      const accountId = picked[g.key];
      if (!accountId) continue;
      if (!runAction('تعذّر الحفظ', () => state.resolveUnresolved({ fundId: g.fundId, currency: g.currency, accountId }))) return;
    }
    onClose();
  };

  return (
    <FormSheet visible title="حدّد الحساب" onCancel={onClose} onSave={handleSave} saveLabel="تأكيد" saveDisabled={Object.keys(picked).length === 0}>
      <AppText variant="secondary" color="textSecondary">
        الفلوس دي محجوزة لصناديق من البيانات القديمة ومتعرفش على أنهي حساب. اختار الحساب لكل واحدة.
      </AppText>
      {groups.map((g) => {
        const accounts = state.accounts.filter((a) => a.currency === g.currency && !a.archived);
        return (
          <Card key={g.key} variant="subtle" style={styles.card}>
            <AppText variant="bodyStrong">
              {fundName(g.fundId)} · {formatMoney(g.amount, g.currency)}
            </AppText>
            <AppText variant="caption" color="textSecondary">
              {REASONS[g.reason]}
            </AppText>
            {accounts.length === 0 ? (
              <AppText variant="caption" color="danger">
                أضف حساب بالعملة دي الأول.
              </AppText>
            ) : (
              <View>
                <ChipRow>
                  {accounts.map((a) => (
                    <Chip
                      key={a.id}
                      label={`${a.name} · متاح ${formatMoney(Math.max(0, accountAvailable(state, a.id)), a.currency)}`}
                      selected={picked[g.key] === a.id}
                      disabled={!fits(g, a.id)}
                      onPress={() => setPicked((prev) => ({ ...prev, [g.key]: a.id }))}
                    />
                  ))}
                </ChipRow>
              </View>
            )}
          </Card>
        );
      })}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.xs, marginTop: space.sm },
});
