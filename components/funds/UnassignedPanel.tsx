import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { AssignSheet } from '@/components/funds/AssignSheet';
import { CoverSheet } from '@/components/funds/CoverSheet';
import { Card } from '@/components/ui/Card';
import { Colors, FinanceColors } from '@/constants/theme';
import { unassignedEGP } from '@/store/selectors';
import type { FinanceStateV2 } from '@/store/types';
import { formatCurrency } from '@/utils/formatters';

// "فلوس بدون وظيفة" card with its actions: distribute a surplus (وزّعها) or cover a
// shortfall (غطّيها). Owns the sheets it opens.
export function UnassignedPanel({ state }: { state: FinanceStateV2 }) {
  const [sheet, setSheet] = useState<'assign' | 'cover' | null>(null);
  const amount = unassignedEGP(state);
  const negative = amount < -0.005;
  const positive = amount > 0.005;

  return (
    <>
      <Card style={negative ? styles.cardNegative : undefined}>
        <View style={styles.row}>
          {(positive || negative) && (
            <TouchableOpacity
              style={[styles.button, negative && styles.buttonNegative]}
              onPress={() => setSheet(negative ? 'cover' : 'assign')}
              activeOpacity={0.85}>
              <Text style={styles.buttonText}>{negative ? 'غطّيها' : 'وزّعها'}</Text>
            </TouchableOpacity>
          )}
          <View style={styles.text}>
            <Text style={styles.label}>فلوس بدون وظيفة</Text>
            <Text style={[styles.amount, negative && styles.negativeText]}>
              {formatCurrency(amount, 'EGP')}
            </Text>
          </View>
        </View>
        {negative && (
          <Text style={[styles.message, styles.negativeText]}>
            صرفت {formatCurrency(-amount, 'EGP')} من فلوس مخصصة لصناديق
          </Text>
        )}
      </Card>

      {sheet === 'assign' && <AssignSheet onClose={() => setSheet(null)} />}
      {sheet === 'cover' && <CoverSheet onClose={() => setSheet(null)} />}
    </>
  );
}

const styles = StyleSheet.create({
  cardNegative: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: FinanceColors.expense + '40',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  text: {
    flex: 1,
    alignItems: 'flex-end',
    gap: 2,
  },
  label: {
    fontSize: 13,
    color: Colors.light.icon,
  },
  amount: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.light.text,
  },
  negativeText: {
    color: FinanceColors.expense,
  },
  message: {
    marginTop: 8,
    fontSize: 13,
    textAlign: 'right',
  },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.light.tint,
  },
  buttonNegative: {
    backgroundColor: FinanceColors.expense,
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});
