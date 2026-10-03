import { useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ConfirmOccurrenceSheet } from "@/components/recurring/ConfirmOccurrenceSheet";
import { Card } from "@/components/ui/Card";
import { LoadingView } from "@/components/ui/LoadingView";
import { Colors, FinanceColors } from "@/constants/theme";
import { dueOccurrences } from "@/store/recurring";
import { useFinanceStore } from "@/store/useFinanceStore";
import { toDateKey } from "@/utils/dates";
import { formatCurrency, formatDayLabel } from "@/utils/formatters";
import { runAction } from "@/utils/runAction";

// "المستحقات": due occurrences of 'confirm' rules, oldest first (missed months listed
// separately). "تم" records it; "تخطّي" skips it.
export default function DueScreen() {
  const insets = useSafeAreaInsets();
  const state = useFinanceStore();
  const [confirming, setConfirming] = useState<{
    ruleId: string;
    date: string;
  } | null>(null);

  if (!state.hasHydrated) return <LoadingView />;

  const today = toDateKey(new Date());
  const items = dueOccurrences(state, today, "confirm");
  // Earlier months' items (missed) are listed apart from this month's; both oldest first.
  const thisMonth = today.slice(0, 7);
  const missed = items.filter((o) => o.date.slice(0, 7) < thisMonth);
  const current = items.filter((o) => o.date.slice(0, 7) >= thisMonth);
  const sections = [
    { title: "فات ومتسجلش", items: missed },
    { title: "المستحق الشهر ده", items: current },
  ].filter((section) => section.items.length > 0);
  const accountName = (id?: string) =>
    state.accounts.find((a) => a.id === id)?.name ?? "—";
  const confirmRule =
    confirming && state.recurringRules.find((r) => r.id === confirming.ruleId);

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 24 },
        ]}
      >
        {items.length === 0 ? (
          <Text style={styles.empty}>مفيش مستحقات دلوقتي ✓</Text>
        ) : (
          sections.map((section) => (
            <View key={section.title} style={styles.section}>
              <Text style={styles.sectionTitle}>
                {section.title} ({section.items.length})
              </Text>
              {section.items.map(({ rule, date }) => (
                <Card key={`${rule.id}-${date}`} style={styles.item}>
                  <View style={styles.row}>
                    <Text
                      style={[
                        styles.amount,
                        {
                          color:
                            rule.kind === "income"
                              ? FinanceColors.income
                              : FinanceColors.expense,
                        },
                      ]}
                    >
                      {rule.variableAmount ? "≈ " : ""}
                      {formatCurrency(rule.amount, rule.currency)}
                    </Text>
                    <View style={styles.text}>
                      <Text style={styles.name}>{rule.name}</Text>
                      <Text style={styles.muted}>
                        {formatDayLabel(date)} · {accountName(rule.accountId)}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.actions}>
                    <TouchableOpacity
                      style={[styles.button, styles.skip]}
                      onPress={() =>
                        runAction("تعذّر التخطي", () =>
                          state.skipOccurrence(rule.id, date),
                        )
                      }
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.buttonText, styles.skipText]}>
                        تخطّي
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.button}
                      onPress={() => setConfirming({ ruleId: rule.id, date })}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.buttonText}>تم</Text>
                    </TouchableOpacity>
                  </View>
                </Card>
              ))}
            </View>
          ))
        )}
      </ScrollView>

      {confirmRule && confirming && (
        <ConfirmOccurrenceSheet
          key={`${confirming.ruleId}-${confirming.date}`}
          rule={confirmRule}
          occurrenceDate={confirming.date}
          onClose={() => setConfirming(null)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.light.background },
  content: { padding: 16, gap: 18 },
  section: { gap: 10 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.light.text,
    textAlign: "right",
  },
  empty: {
    marginTop: 48,
    fontSize: 15,
    color: Colors.light.icon,
    textAlign: "center",
  },
  item: { gap: 12 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  text: { flex: 1, alignItems: "flex-end", gap: 2, marginLeft: 8 },
  name: { fontSize: 15, fontWeight: "600", color: Colors.light.text },
  muted: { fontSize: 12, color: Colors.light.icon, textAlign: "right" },
  amount: { fontSize: 15, fontWeight: "700" },
  actions: { flexDirection: "row", gap: 10 },
  button: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: Colors.light.tint,
  },
  buttonText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  skip: { backgroundColor: Colors.light.icon + "18" },
  skipText: { color: Colors.light.text },
});
