import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { FormSheet } from '@/components/ui/FormSheet';
import { formatMoney } from '@/components/ui/formatMoney';
import { ListGroup, ListRow } from '@/components/ui/ListRow';
import { StatusChip } from '@/components/ui/StatusChip';
import { space } from '@/constants/theme';
import { holdingPnlEGP, holdingValueEGP } from '@/store/selectors';
import type { FinanceState, Holding } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { confirmAction } from '@/utils/dialogs';
import { runAction } from '@/utils/runAction';

import { holdingTitle, LOCATION_LABELS, signedDifference } from './assetsUi';

interface HoldingSheetProps {
  holding: Holding;
  // The fund this holding backs, if any.
  fundName?: string;
  onClose: () => void;
}

// A holding's details (value, cost, value difference, linked fund) and its delete action
// (the same confirm as before; a gold purchase must be deleted from its transaction instead).
export function HoldingSheet({ holding, fundName, onClose }: HoldingSheetProps) {
  const state = useFinanceStore();

  const handleDelete = () =>
    confirmAction({
      title: 'حذف الأصل',
      message: `هل تريد حذف "${holding.name}"؟`,
      confirmText: 'حذف',
      cancelText: 'إلغاء',
      onConfirm: () => {
        if (runAction('تعذّر الحذف', () => state.deleteHolding(holding.id))) onClose();
      },
    });

  const rows = details(state, holding);

  return (
    <FormSheet visible title={holdingTitle(holding)} onCancel={onClose} onSave={onClose} saveLabel="تم">
      {fundName && <StatusChip label={`مربوط بـ ${fundName}`} tone="gold" icon="link" />}
      <View style={styles.list}>
        <ListGroup>
          {rows.map((r) => (
            <ListRow
              key={r.label}
              title={r.label}
              trailing={
                <AppText variant="bodyStrong" align="left" color={r.muted ? 'textSecondary' : 'text'} style={styles.tabular}>
                  {r.value}
                </AppText>
              }
            />
          ))}
        </ListGroup>
      </View>
      <View style={styles.delete}>
        <Button label="احذف الأصل" variant="destructive" icon="delete-outline" block onPress={handleDelete} />
      </View>
    </FormSheet>
  );
}

function details(state: FinanceState, holding: Holding) {
  const value = holdingValueEGP(state, holding);
  const rows: { label: string; value: string; muted?: boolean }[] = [
    { label: 'القيمة الحالية', value: formatMoney(value, 'EGP') },
    ...(holding.type === 'gold'
      ? [
          { label: 'الوزن', value: `${holding.weightGrams} جم` },
          { label: 'العيار', value: `عيار ${holding.karat}` },
        ]
      : [{ label: 'الكمية', value: formatMoney(holding.quantity, holding.currency) }]),
    { label: 'المكان', value: LOCATION_LABELS[holding.location ?? 'EG'] },
  ];
  if (holding.purchaseCostEGP > 0) {
    rows.push({ label: 'تكلفة الشراء', value: formatMoney(holding.purchaseCostEGP, 'EGP') });
    rows.push({ label: 'فرق القيمة', value: signedDifference(holdingPnlEGP(state, holding)), muted: true });
  }
  return rows;
}

const styles = StyleSheet.create({
  list: { marginTop: space.lg },
  tabular: { fontVariant: ['tabular-nums'] },
  delete: { marginTop: space.xxxl },
});
