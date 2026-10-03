import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { AppLockGate } from '@/components/AppLockGate';
import { RecurringRunner } from '@/components/RecurringRunner';
import { useColorScheme } from '@/hooks/use-color-scheme';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
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
