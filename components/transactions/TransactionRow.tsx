import type MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { ListRow, type IconTone } from '@/components/ui/ListRow';
import { Money } from '@/components/ui/Money';
import { formatMoney } from '@/components/ui/formatMoney';
import { formatDateAr } from '@/components/ui/formatDateAr';
import { StatusChip } from '@/components/ui/StatusChip';
import { space } from '@/constants/theme';
import type { CurrencyCode, FinanceState, Transaction } from '@/store/types';

import { transferTitle } from './transactionUi';

type IconName = ComponentProps<typeof MaterialIcons>['name'];

interface TransactionRowProps {
  tx: Transaction;
  state: Pick<FinanceState, 'accounts' | 'categories' | 'holdings'>;
  onPress: () => void;
  showDate?: boolean;
  /** @deprecated separators come from ListGroup; still accepted. */
  isLast?: boolean;
}

interface Description {
  title: string;
  account: string;
  currency: CurrencyCode;
  icon: IconName;
  iconTone: IconTone;
  archivedCategory: boolean;
}

function describe(state: TransactionRowProps['state'], tx: Transaction): Description {
  const accountName = (id: string) => state.accounts.find((a) => a.id === id)?.name ?? '—';
  if (tx.type === 'transfer') {
    const from = state.accounts.find((a) => a.id === tx.fromAccountId);
    return {
      title: transferTitle(from?.name ?? '—', accountName(tx.toAccountId)),
      account: 'تحويل بين حساباتك',
      // Shown in the source account's currency.
      currency: from?.currency ?? 'EGP',
      icon: 'swap-horiz',
      iconTone: 'neutral',
      archivedCategory: false,
    };
  }
  if (tx.type === 'asset_purchase') {
    const holding = state.holdings.find((h) => h.id === tx.holdingId);
    return {
      title: holding?.name ?? 'شراء ذهب',
      account: accountName(tx.accountId),
      currency: tx.currency,
      icon: 'diamond',
      iconTone: 'gold',
      archivedCategory: false,
    };
  }
  const category = state.categories.find((c) => c.id === tx.categoryId);
  return {
    title: category?.name ?? '—',
    account: accountName(tx.accountId),
    currency: tx.currency,
    icon: tx.type === 'income' ? 'south-west' : 'north-east',
    iconTone: tx.type === 'income' ? 'ok' : 'neutral',
    archivedCategory: !!category?.archived,
  };
}

// One transaction: icon tile · title (category / "from ← to" / holding) · account · note ·
// date · chips (لمرة واحدة / متكرر / مؤرشف) · amount (+ EGP at the snapshot rate). Expenses in
// the regular text color, income green with "+".
export function TransactionRow({ tx, state, onPress, showDate = false }: TransactionRowProps) {
  const d = describe(state, tx);
  const subtitle = [d.account, tx.note?.trim() || null, showDate ? formatDateAr(tx.date, { year: false }) : null]
    .filter(Boolean)
    .join(' · ');
  const chips = [
    tx.type === 'expense' && tx.oneTime ? 'لمرة واحدة' : null,
    tx.recurringRuleId ? 'متكرر' : null,
    d.archivedCategory ? 'مؤرشف' : null,
  ].filter((c): c is string => c !== null);
  const income = tx.type === 'income';

  return (
    <ListRow
      title={d.title}
      titleColor={d.archivedCategory ? 'textMuted' : undefined}
      subtitle={subtitle}
      subtitleLines={1}
      icon={d.icon}
      iconTone={d.iconTone}
      accessory={
        chips.length > 0 ? (
          <View style={styles.chips}>
            {chips.map((label) => (
              <StatusChip key={label} label={label} tone="neutral" />
            ))}
          </View>
        ) : undefined
      }
      trailing={
        <Money
          amount={tx.amount}
          currency={d.currency}
          size="row"
          align="left"
          tone={income ? 'positive' : 'default'}
          showSign={income}
          converted={d.currency !== 'EGP' ? { amount: tx.amount * tx.rateToEGP, currency: 'EGP' } : undefined}
        />
      }
      onPress={onPress}
      accessibilityLabel={`${d.title}، ${formatMoney(tx.amount, d.currency, income)}، ${formatDateAr(tx.date)}`}
    />
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: space.xs, marginTop: space.xxs },
});
