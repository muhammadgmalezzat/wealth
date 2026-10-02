import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Colors, FinanceColors } from '@/constants/theme';
import type { CurrencyCode, FinanceStateV2, Transaction } from '@/store/types';
import { formatCurrency, formatDate } from '@/utils/formatters';

interface TransactionRowProps {
  tx: Transaction;
  state: Pick<FinanceStateV2, 'accounts' | 'categories'>;
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
  return {
    title: state.categories.find((c) => c.id === tx.categoryId)?.name ?? '—',
    subtitle: accountName(tx.accountId),
    currency: tx.currency,
  };
}

export function TransactionRow({ tx, state, onPress, showDate = false, isLast = true }: TransactionRowProps) {
  const { title, subtitle, currency } = describe(state, tx);
  const sign = tx.type === 'income' ? '+' : tx.type === 'expense' ? '−' : '';
  const color =
    tx.type === 'income'
      ? FinanceColors.income
      : tx.type === 'expense'
        ? FinanceColors.expense
        : Colors.light.text;

  return (
    <TouchableOpacity
      style={[styles.row, !isLast && styles.rowBorder]}
      onPress={onPress}
      activeOpacity={0.7}>
      {/* Left: amount (+ EGP equivalent at the snapshotted rate) */}
      <View style={styles.amountCol}>
        <Text style={[styles.amount, { color }]}>
          {sign}
          {formatCurrency(tx.amount, currency)}
        </Text>
        {currency !== 'EGP' && (
          <Text style={styles.muted}>{formatCurrency(tx.amount * tx.rateToEGP, 'EGP')}</Text>
        )}
      </View>
      {/* Right: category, account, note */}
      <View style={styles.details}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.muted} numberOfLines={1}>
          {showDate ? `${subtitle} · ${formatDate(tx.date)}` : subtitle}
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
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: FinanceColors.progressTrack,
  },
  amountCol: {
    alignItems: 'flex-start',
    gap: 2,
  },
  amount: {
    fontSize: 15,
    fontWeight: '600',
  },
  details: {
    flex: 1,
    alignItems: 'flex-end',
    gap: 2,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.light.text,
    textAlign: 'right',
  },
  muted: {
    fontSize: 12,
    color: Colors.light.icon,
    textAlign: 'right',
  },
  note: {
    fontSize: 12,
    color: Colors.light.text,
    fontStyle: 'italic',
    textAlign: 'right',
  },
});
