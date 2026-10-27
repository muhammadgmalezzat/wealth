import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { AppLockGate } from '@/components/AppLockGate';
import { PriceRunner } from '@/components/PriceRunner';
import { RecurringRunner } from '@/components/RecurringRunner';
import { SnapshotRunner } from '@/components/SnapshotRunner';
import { colors } from '@/constants/theme';

export const unstable_settings = {
  anchor: '(tabs)',
};

// Dark only, built from the design tokens: headers sit on the midnight ground (card = background)
// with hairline borders; the tab bar is its own glass surface (see (tabs)/_layout.tsx).
const navigationTheme = {
  ...DarkTheme,
  dark: true,
  colors: {
    ...DarkTheme.colors,
    background: colors.background,
    card: colors.background,
    text: colors.text,
    border: colors.divider,
    primary: colors.primary,
    notification: colors.danger,
  },
};

export default function RootLayout() {
  return (
    <ThemeProvider value={navigationTheme}>
      <Stack
        screenOptions={{
          // No white flash between screens, and a header that melts into the backdrop.
          contentStyle: { backgroundColor: colors.background },
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerTitleStyle: { color: colors.text },
          headerShadowVisible: false,
        }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="fund/[id]" options={{ title: 'الصندوق', headerBackTitle: 'رجوع' }} />
        <Stack.Screen name="settings" options={{ title: 'الإعدادات', headerBackTitle: 'رجوع' }} />
        <Stack.Screen name="recurring" options={{ title: 'المعاملات المتكررة', headerBackTitle: 'رجوع' }} />
        <Stack.Screen name="due" options={{ title: 'المستحقات', headerBackTitle: 'رجوع' }} />
        <Stack.Screen name="categories" options={{ title: 'البنود', headerBackTitle: 'رجوع' }} />
        <Stack.Screen name="assets" options={{ title: 'الأصول', headerBackTitle: 'رجوع' }} />
        <Stack.Screen name="review" options={{ title: 'مراجعة الشهر', headerBackTitle: 'رجوع' }} />
        <Stack.Screen name="period-transactions" options={{ title: 'المعاملات', headerBackTitle: 'رجوع' }} />
      </Stack>
      <RecurringRunner />
      <PriceRunner />
      <SnapshotRunner />
      <AppLockGate />
      {/* Dark only: light status-bar icons on the dark background. */}
      <StatusBar style="light" />
    </ThemeProvider>
  );
}
