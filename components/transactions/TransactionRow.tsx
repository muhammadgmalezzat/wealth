import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { formatMoney } from '@/components/ui/formatMoney';
import { colors, radius, space, type } from '@/constants/theme';
import type { CurrencyCode, FinanceState, Transaction } from '@/store/types';
import { formatDateAr } from '@/components/ui/formatDateAr';

interface TransactionRowProps {
  tx: Transaction;
  state: Pick<FinanceState, 'accounts' | 'categories' | 'holdings'>;
  onPress: () => void;
  showDate?: boolean;
  isLast?: boolean;
}

interface Description {
  title: string;
  subtitle: string;
  currency: CurrencyCode;
}

// Title, account line and display currency; transfers show in the source account's currency.
function describe(state: TransactionRowProps['state'], tx: Transaction): Description {
  const accountName = (id: string) => state.accounts.find((a) => a.id === id)?.name ?? '—';
  if (tx.type === 'transfer') {
    const from = state.accounts.find((a) => a.id === tx.fromAccountId);
    return {
      title: 'تحويل',
      // Words rather than an arrow: an arrow's direction flips with the bidi direction of
      // the account names (Arabic vs Latin), words read correctly either way.
      subtitle: `من ${from?.name ?? '—'} إلى ${accountName(tx.toAccountId)}`,
      currency: from?.currency ?? 'EGP',
    };
  }
  if (tx.type === 'asset_purchase') {
    const holding = state.holdings.find((h) => h.id === tx.holdingId);
    return {
      title: 'شراء ذهب',
      subtitle: holding ? `${accountName(tx.accountId)} · ${holding.name}` : accountName(tx.accountId),
      currency: tx.currency,
    };
  }
  return {
    title: state.categories.find((c) => c.id === tx.categoryId)?.name ?? '—',
    subtitle: accountName(tx.accountId),
    currency: tx.currency,
  };
}

export function TransactionRow({ tx, state, onPress, showDate = false, isLast = true }: TransactionRowProps) {
  const { title, subtitle, currency } = describe(state, tx);
  const sign = tx.type === 'income' ? '+' : tx.type === 'expense' ? '−' : '';
  // Color by meaning, not sign: income green; expenses, transfers and gold purchases (not
  // spending) in the regular text color.
  const color = tx.type === 'income' ? colors.primary700 : colors.text;
  const oneTime = tx.type === 'expense' && tx.oneTime;

  return (
    <TouchableOpacity
      style={[styles.row, !isLast && styles.rowBorder]}
      onPress={onPress}
      activeOpacity={0.7}>
      {/* Left: amount (+ EGP equivalent at the snapshotted rate) */}
      <View style={styles.amountCol}>
        <Text style={[styles.amount, { color }]}>{formatMoney(tx.type === 'expense' ? -tx.amount : tx.amount, currency, sign !== '')}</Text>
        {currency !== 'EGP' && (
          <Text style={[styles.muted, styles.tabular]}>{formatMoney(tx.amount * tx.rateToEGP, 'EGP')}</Text>
        )}
      </View>
      {/* Right: category, account, note */}
      <View style={styles.details}>
        <View style={styles.titleRow}>
          {oneTime && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>مرة واحدة</Text>
            </View>
          )}
          <Text style={styles.title}>{title}</Text>
        </View>
        <Text style={styles.muted} numberOfLines={1}>
          {showDate ? `${subtitle} · ${formatDateAr(tx.date, { year: false })}` : subtitle}
        </Text>
        {tx.note ? (
          <Text style={styles.note} numberOfLines={1}>
            {tx.note}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    gap: space.md,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  amountCol: {
    alignItems: 'flex-start',
    gap: 2,
  },
  amount: {
    ...type.moneyRow,
    fontVariant: ['tabular-nums'],
  },
  tabular: { fontVariant: ['tabular-nums'] },
  details: {
    flex: 1,
    alignItems: 'flex-end',
    gap: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 1,
    backgroundColor: colors.surfaceSubtle,
  },
  badgeText: {
    ...type.micro,
    color: colors.textSecondary,
  },
  title: {
    ...type.bodyStrong,
    color: colors.text,
    textAlign: 'right',
  },
  muted: {
    ...type.micro,
    color: colors.textSecondary,
    textAlign: 'right',
  },
  note: {
    ...type.micro,
    color: colors.text,
    fontStyle: 'italic',
    textAlign: 'right',
  },
});
