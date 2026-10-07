import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AssignSheet } from '@/components/funds/AssignSheet';
import { BUCKET_TITLES } from '@/components/plan/labels';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { formatMoney } from '@/components/ui/formatMoney';
import { ListGroup, ListRow } from '@/components/ui/ListRow';
import { LoadingView } from '@/components/ui/LoadingView';
import { MetricGroup } from '@/components/ui/MetricGroup';
import { Money } from '@/components/ui/Money';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { StatusChip } from '@/components/ui/StatusChip';
import { space } from '@/constants/theme';
import { planSuggestion } from '@/store/planning';
import { monthReview } from '@/store/review';
import type { ExpenseBucket } from '@/store/types';
import { useFinanceStore } from '@/store/useFinanceStore';
import { isMonthKey, shiftMonth, toMonthKey } from '@/utils/dates';
import { showMessage } from '@/utils/dialogs';
import { formatDayLabel, formatMonthLabel, formatPercent } from '@/utils/formatters';
import { runAction } from '@/utils/runAction';

const BUCKETS = Object.keys(BUCKET_TITLES) as ExpenseBucket[];
const EPSILON = 0.005;

// "How did the month go, and what's next?" (?month=YYYY-MM, default: last month): summary ·
// plan vs actual · biggest spending + one-time expenses · funds · next step. "خلّصت المراجعة"
// marks the month reviewed. Opened from Home (action / early-month card) and the Plan tab.
export default function ReviewScreen() {
  const params = useLocalSearchParams<{ month?: string }>();
  const state = useFinanceStore();
  const [assigning, setAssigning] = useState(false);

  if (!state.hasHydrated) return <LoadingView />;

  const now = new Date();
  const current = toMonthKey(now);
  const month = params.month && isMonthKey(params.month) && params.month <= current ? params.month : shiftMonth(current, -1);
  const review = monthReview(state, month, now);
  const categoryName = (id: string) => state.categories.find((c) => c.id === id)?.name ?? '—';
  const fundName = (id: string) => state.funds.find((f) => f.id === id)?.name ?? '—';
  const plan = review.plan;

  const createNextPlan = (how: 'suggest' | 'copy') => {
    const created = runAction('تعذّر إنشاء الخطة', () => {
      if (how === 'copy' && review.copyFromMonth) state.copyPlan(review.copyFromMonth, review.nextMonth);
      else state.savePlan(planSuggestion(state, review.nextMonth));
    });
    if (created) showMessage('تم', `اتعملت خطة ${formatMonthLabel(review.nextMonth)}`);
  };

  const finish = () => {
    const done = runAction('تعذّر حفظ المراجعة', () => state.completeMonthlyReview(month));
    if (!done) return;
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <Screen scroll edges={['bottom']} contentStyle={styles.content}>
      <Stack.Screen options={{ title: `مراجعة ${formatMonthLabel(month)}` }} />

      {/* ── 1. الملخص ── */}
      <View>
        <SectionHeader
          title="الملخص"
          trailing={review.reviewed ? <StatusChip label="اتراجع" tone="ok" icon="check" /> : undefined}
        />
        <View style={styles.block}>
          <MetricGroup
            metrics={[
              { label: 'دخل', value: <Money amount={review.incomeEGP} currency="EGP" align="center" /> },
              { label: 'مصروف', value: <Money amount={review.expenseEGP} currency="EGP" align="center" /> },
              {
                label: 'صافي',
                value: (
                  <Money amount={review.netEGP} currency="EGP" align="center" showSign tone={review.netEGP >= 0 ? 'positive' : 'default'} />
                ),
              },
            ]}
          />
          <MetricGroup
            metrics={[
              {
                label: 'نسبة التحويش',
                value: (
                  <AppText variant="moneyRow" align="center">
                    {review.savingsRate === null ? '—' : formatPercent(review.savingsRate)}
                  </AppText>
                ),
              },
              {
                label: 'تغير صافي الثروة',
                value: review.netWorthChange ? (
                  <Money
                    amount={review.netWorthChange.amountEGP}
                    currency="EGP"
                    align="center"
                    showSign
                    tone={review.netWorthChange.amountEGP < -EPSILON ? 'danger' : 'positive'}
                  />
                ) : (
                  <AppText variant="moneyRow" align="center" color="textSecondary">
                    —
                  </AppText>
                ),
              },
            ]}
          />
        </View>
      </View>

      {/* ── 2. الخطة مقابل الفعلي ── */}
      <View>
        <SectionHeader title="الخطة مقابل الفعلي" />
        {!plan ? (
          <Card variant="subtle">
            <AppText variant="secondary" color="textSecondary">
              مكانش فيه خطة للشهر ده، فمفيش مقارنة.
            </AppText>
          </Card>
        ) : (
          <View style={styles.block}>
            <ListGroup>
              {BUCKETS.filter((b) => plan.buckets[b].planned > EPSILON || plan.buckets[b].spent > EPSILON).map((bucket) => {
                const { planned, spent } = plan.buckets[bucket];
                const left = planned - spent;
                return (
                  <ListRow
                    key={bucket}
                    title={BUCKET_TITLES[bucket]}
                    subtitle={`${formatMoney(spent, plan.currency)} من ${formatMoney(planned, plan.currency)}`}
                    trailing={
                      left < -EPSILON ? (
                        <StatusChip label={`زيادة ${formatMoney(-left, plan.currency)}`} tone="attention" />
                      ) : (
                        <StatusChip label={`فاضل ${formatMoney(left, plan.currency)}`} tone="ok" />
                      )
                    }
                  />
                );
              })}
            </ListGroup>
            {plan.over.length > 0 && (
              <View>
                <AppText variant="bodyStrong" style={styles.subheading}>
                  عدّت الخطة
                </AppText>
                <ListGroup>
                  {plan.over.map((line) => (
                    <ListRow
                      key={line.categoryId}
                      title={categoryName(line.categoryId)}
                      subtitle={`${formatMoney(line.spent, plan.currency)} من ${formatMoney(line.limit, plan.currency)}`}
                      trailing={<Money amount={-line.remaining} currency={plan.currency} tone="danger" showSign />}
                    />
                  ))}
                </ListGroup>
              </View>
            )}
            {plan.under.length > 0 && (
              <View>
                <AppText variant="bodyStrong" style={styles.subheading}>
                  وفّرت فيها
                </AppText>
                <ListGroup>
                  {plan.under.map((line) => (
                    <ListRow
                      key={line.categoryId}
                      title={categoryName(line.categoryId)}
                      subtitle={`${formatMoney(line.spent, plan.currency)} من ${formatMoney(line.limit, plan.currency)}`}
                      trailing={<Money amount={line.remaining} currency={plan.currency} tone="positive" />}
                    />
                  ))}
                </ListGroup>
              </View>
            )}
            {plan.unplannedSpent > EPSILON && (
              <AppText variant="secondary" color="textSecondary">
                مصروف خارج الخطة: {formatMoney(plan.unplannedSpent, plan.currency)}
              </AppText>
            )}
          </View>
        )}
      </View>

      {/* ── 3. أكتر بنود الصرف ── */}
      <View>
        <SectionHeader title="أكتر 5 بنود صرف" />
        {review.topCategories.length === 0 ? (
          <Card variant="subtle">
            <AppText variant="secondary" color="textSecondary">
              مفيش مصروف متسجل للشهر ده.
            </AppText>
          </Card>
        ) : (
          <ListGroup>
            {review.topCategories.map((c) => (
              <ListRow
                key={c.categoryId}
                title={categoryName(c.categoryId)}
                subtitle={review.expenseEGP > 0 ? `${formatPercent(c.amountEGP / review.expenseEGP)} من المصروف` : undefined}
                trailing={<Money amount={c.amountEGP} currency="EGP" />}
              />
            ))}
          </ListGroup>
        )}
        {review.oneTime.length > 0 && (
          <View>
            <SectionHeader
              title="مصاريف مرة واحدة"
              trailing={
                <AppText variant="secondary" color="textSecondary">
                  {formatMoney(review.oneTimeTotalEGP, 'EGP')}
                </AppText>
              }
            />
            <ListGroup>
              {review.oneTime.map((t) => (
                <ListRow
                  key={t.id}
                  title={categoryName(t.categoryId)}
                  subtitle={[t.note, formatDayLabel(t.date, now)].filter(Boolean).join(' · ')}
                  trailing={<Money amount={t.amountEGP} currency="EGP" />}
                />
              ))}
            </ListGroup>
          </View>
        )}
      </View>

      {/* ── 4. الصناديق ── */}
      <View>
        <SectionHeader title="الصناديق" />
        {review.funds.length === 0 && review.completedFunds.length === 0 ? (
          <Card variant="subtle">
            <AppText variant="secondary" color="textSecondary">
              محصلش تحويش للصناديق الشهر ده.
            </AppText>
          </Card>
        ) : (
          <View style={styles.block}>
            {review.funds.length > 0 && (
              <ListGroup>
                {review.funds.map((f) => {
                  const cur = review.fundCurrency;
                  const met = f.planned !== null && f.allocated >= f.planned - EPSILON;
                  return (
                    <ListRow
                      key={f.fundId}
                      title={fundName(f.fundId)}
                      subtitle={
                        f.planned !== null
                          ? `${formatMoney(f.allocated, cur)} من ${formatMoney(f.planned, cur)} متخطط`
                          : `اتحوّش ${formatMoney(f.allocated, cur)} من غير خطة`
                      }
                      trailing={
                        f.planned !== null ? (
                          <StatusChip label={met ? 'اتخصص' : 'أقل من الخطة'} tone={met ? 'ok' : 'attention'} />
                        ) : undefined
                      }
                      onPress={() => router.push({ pathname: '/fund/[id]', params: { id: f.fundId } })}
                    />
                  );
                })}
              </ListGroup>
            )}
            {review.completedFunds.length > 0 && (
              <ListGroup>
                {review.completedFunds.map((f) => (
                  <ListRow
                    key={f.id}
                    title={f.name}
                    subtitle="وصل للهدف"
                    icon="check-circle-outline"
                    iconTone="ok"
                    onPress={() => router.push({ pathname: '/fund/[id]', params: { id: f.id } })}
                  />
                ))}
              </ListGroup>
            )}
          </View>
        )}
      </View>

      {/* ── 5. خطوتك الجاية ── */}
      <View>
        <SectionHeader title="خطوتك الجاية" />
        <Card style={styles.block}>
          {review.nextMonthHasPlan ? (
            <View style={styles.row}>
              <StatusChip label={`خطة ${formatMonthLabel(review.nextMonth)} جاهزة`} tone="ok" icon="check" />
              <Button label="افتح الخطة" variant="tertiary" onPress={() => router.push('/plan')} />
            </View>
          ) : (
            <>
              <AppText variant="secondary">اعمل خطة {formatMonthLabel(review.nextMonth)} من دلوقتي.</AppText>
              <Button label="اقترح خطة الشهر الجاي" variant="secondary" block onPress={() => createNextPlan('suggest')} />
              {review.copyFromMonth && (
                <Button
                  label={`انسخ خطة ${formatMonthLabel(review.copyFromMonth)}`}
                  variant="tertiary"
                  onPress={() => createNextPlan('copy')}
                />
              )}
            </>
          )}
          {review.unassignedEGP > EPSILON && (
            <Button
              label={`وزّع الفايض (${formatMoney(review.unassignedEGP, 'EGP')})`}
              variant="secondary"
              block
              onPress={() => setAssigning(true)}
            />
          )}
        </Card>
      </View>

      <Button label={review.reviewed ? 'تم' : 'خلّصت المراجعة'} block onPress={finish} />

      {assigning && <AssignSheet onClose={() => setAssigning(false)} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.lg },
  block: { gap: space.md },
  subheading: { marginBottom: space.sm },
  row: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
});
