import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { AppLockGate } from '@/components/AppLockGate';
import { RecurringRunner } from '@/components/RecurringRunner';
import { colors } from '@/constants/theme';

export const unstable_settings = {
  anchor: '(tabs)',
};

// Light theme only, built from the design tokens: headers and tab bar sit on the warm ground
// (card = background) with hairline borders.
const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    card: colors.background,
    text: colors.text,
    border: colors.border,
    primary: colors.primary700,
  },
};

export default function RootLayout() {
  return (
    <ThemeProvider value={navigationTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="fund/[id]" options={{ title: 'الصندوق', headerBackTitle: 'رجوع' }} />
        <Stack.Screen name="settings" options={{ title: 'الإعدادات', headerBackTitle: 'رجوع' }} />
        <Stack.Screen name="recurring" options={{ title: 'المعاملات المتكررة', headerBackTitle: 'رجوع' }} />
        <Stack.Screen name="due" options={{ title: 'المستحقات', headerBackTitle: 'رجوع' }} />
        <Stack.Screen name="categories" options={{ title: 'البنود', headerBackTitle: 'رجوع' }} />
      </Stack>
      <RecurringRunner />
      <AppLockGate />
      {/* Light theme only: dark status-bar icons on the light background. */}
      <StatusBar style="dark" />
    </ThemeProvider>
  );
}
