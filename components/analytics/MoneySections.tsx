import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { formatMoney } from '@/components/ui/formatMoney';
import { InsightCard } from '@/components/ui/InsightCard';
import { ListGroup, ListRow } from '@/components/ui/ListRow';
import { MetricGroup } from '@/components/ui/MetricGroup';
import { Money } from '@/components/ui/Money';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { CURRENCY_NAMES_AR } from '@/constants/currencies';
import { opacity, space } from '@/constants/theme';
import type { DisplayCurrency, FundProjection, Insight, MoneyMap, Runway } from '@/store/analytics';
import type { CurrencyCode } from '@/store/types';
import { formatPercent } from '@/utils/formatters';

import { compactNumber, projectionPhrase, runwayPhrase } from './analyticsUi';
import { EmptyNote, NOT_ENOUGH_DATA } from './common';

const LOCATION_NAMES = { EG: 'مصر', SA: 'السعودية' } as const;

// Where the money is now: liquid by currency (native + value), by country, and gold by karat.
// These are current valuations, so they use today's rates.
export function MoneyMapSection({ map, currency }: { map: MoneyMap; currency: DisplayCurrency }) {
  return (
    <View style={styles.wrap}>
      <ListGroup>
        {map.liquid.map((row) => (
          <ListRow
            key={row.currency}
            title={`سيولة · ${CURRENCY_NAMES_AR[row.currency]}`}
            subtitle={row.currency === currency ? undefined : `≈ ${formatMoney(row.value, currency)}`}
            subtitleLines={1}
            trailing={<Money amount={row.native} currency={row.currency} size="row" align="left" />}
          />
        ))}
        <ListRow
          title="إجمالي السيولة"
          trailing={<Money amount={map.liquidTotal} currency={currency} size="row" tone="muted" align="left" />}
        />
      </ListGroup>

      <ListGroup>
        {map.byLocation.map((l) => (
          <ListRow
            key={l.location}
            title={LOCATION_NAMES[l.location]}
            subtitle={`كاش ${compactNumber(l.cash)} · ذهب ${compactNumber(l.gold)} · عملات ${compactNumber(l.currencies)}`}
            subtitleLines={1}
            trailing={<Money amount={l.total} currency={currency} size="row" align="left" />}
          />
        ))}
      </ListGroup>

      {map.gold.rows.length > 0 && (
        <>
          <MetricGroup
            metrics={[
              { label: 'ذهب (جم)', value: <AppText variant="moneyRow" align="center">{map.gold.grams}</AppText>, tone: 'gold' },
              { label: 'القيمة', value: <Money amount={map.gold.value} currency={currency} size="row" align="center" />, tone: 'gold' },
              {
                label: 'فرق القيمة',
                value: <Money amount={map.gold.pnl} currency={currency} size="row" align="center" showSign tone={map.gold.pnl >= 0 ? 'positive' : 'default'} />,
                tone: 'gold',
              },
            ]}
          />
          <ListGroup>
            {map.gold.rows.map((r) => (
              <ListRow
                key={r.karat}
                title={`عيار ${r.karat}`}
                subtitle={`${r.grams} جم · تكلفة ${formatMoney(r.cost, currency)} · فرق ${formatMoney(r.pnl, currency, true)}`}
                subtitleLines={2}
                icon="diamond"
                iconTone="gold"
                trailing={<Money amount={r.value} currency={currency} size="row" align="left" />}
              />
            ))}
          </ListGroup>
        </>
      )}
    </View>
  );
}

// How many months the money lasts at the average essentials of the last completed months.
export function RunwaySection({ runway, currency }: { runway: Runway; currency: DisplayCurrency }) {
  if (runway.monthsObserved === 0) return <EmptyNote>{NOT_ENOUGH_DATA} من الأساسيات</EmptyNote>;
  const named = (c: CurrencyCode) => CURRENCY_NAMES_AR[c];
  return (
    <View style={styles.wrap}>
      <MetricGroup
        metrics={[
          { label: 'فلوس بدون وظيفة', value: <AppText variant="moneyRow" align="center">{runwayPhrase(runway.unassigned.months)}</AppText> },
          { label: 'كل السيولة', value: <AppText variant="moneyRow" align="center">{runwayPhrase(runway.liquid.months)}</AppText> },
        ]}
      />
      <AppText variant="secondary" color="textSecondary">
        على متوسط أساسيات {formatMoney(runway.avgEssentials, currency)} في الشهر (آخر {runway.monthsObserved === 1 ? 'شهر' : `${runway.monthsObserved} شهور`}، من غير المصاريف اللي لمرة واحدة).
      </AppText>
      {runway.perCurrency.length > 1 && (
        <ListGroup>
          {runway.perCurrency.map((c) => (
            <ListRow
              key={c.currency}
              title={named(c.currency)}
              subtitle={
                c.avgEssentials > 0
                  ? `الأساسيات: ${formatMoney(c.avgEssentials, c.currency)} في الشهر`
                  : 'مفيش أساسيات بالعملة دي'
              }
              subtitleLines={1}
              trailing={
                <View style={styles.runwayNumbers}>
                  <AppText variant="bodyStrong" align="left">{runwayPhrase(c.liquidMonths)}</AppText>
                  <AppText variant="caption" color="textSecondary" align="left">
                    بدون وظيفة: {runwayPhrase(c.unassignedMonths)}
                  </AppText>
                </View>
              }
            />
          ))}
        </ListGroup>
      )}
    </View>
  );
}

// Each fund: how far along, what it holds (by currency + linked gold), and when it finishes at
// the average pace of the last 3 months.
export function FundsSection({ funds }: { funds: FundProjection[] }) {
  if (funds.length === 0) return <EmptyNote>لسه معندكش صناديق.</EmptyNote>;
  return (
    <View style={styles.wrap}>
      {funds.map((f) => {
        const cash = (['EGP', 'SAR', 'USD'] as CurrencyCode[])
          .filter((c) => Math.abs(f.cashByCurrency[c]) > 0.005)
          .map((c) => formatMoney(f.cashByCurrency[c], c));
        const holds = [...cash, ...(f.linkedValue > 0.005 ? [`ذهب ${formatMoney(f.linkedValue, f.currency)}`] : [])];
        return (
          <Pressable
            key={f.fundId}
            onPress={() => router.push({ pathname: '/fund/[id]', params: { id: f.fundId } })}
            accessibilityRole="button"
            accessibilityLabel={`${f.name}، ${formatPercent(f.pct)}`}
            style={({ pressed }) => pressed && { opacity: opacity.pressed }}>
            <Card style={styles.fund}>
              <View style={styles.fundTitle}>
                <AppText variant="bodyStrong" numberOfLines={1} style={styles.flex}>
                  {f.name}
                </AppText>
                <AppText variant="bodyStrong" color={f.status === 'completed' ? 'primary700' : 'text'}>
                  {formatPercent(Math.min(f.pct, 9.99))}
                </AppText>
              </View>
              <ProgressBar progress={f.pct} height={6} />
              <AppText variant="secondary" color="textSecondary">
                {formatMoney(f.current, f.currency)} من {formatMoney(f.target, f.currency)}
              </AppText>
              {holds.length > 0 && (
                <AppText variant="caption" color="textSecondary">
                  فيه: {holds.join(' + ')}
                </AppText>
              )}
              <AppText variant="secondary" color={f.status === 'stalled' || f.lateVsDue ? 'warning' : 'primary700'}>
                {projectionPhrase(f)}
              </AppText>
            </Card>
          </Pressable>
        );
      })}
    </View>
  );
}

// Up to 5 plain-language observations, each opening what it is about.
export function InsightsSection({ insights, onPress }: { insights: Insight[]; onPress: (insight: Insight) => void }) {
  if (insights.length === 0) return <EmptyNote>مفيش ملاحظات دلوقتي.</EmptyNote>;
  return (
    <View style={styles.wrap}>
      {insights.map((insight) => (
        <InsightCard
          key={insight.id}
          tone={insight.tone === 'attention' ? 'attention' : 'ok'}
          icon={insight.tone === 'neutral' ? 'info-outline' : undefined}
          message={insight.text}
          actionLabel="التفاصيل"
          onAction={() => onPress(insight)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  fund: { gap: space.xs },
  fundTitle: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  runwayNumbers: { alignItems: 'flex-start' },
});
