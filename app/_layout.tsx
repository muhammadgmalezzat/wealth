import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { AppLockGate } from '@/components/AppLockGate';
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
        <Stack.Screen name="fund/[id]" options={{ headerBackTitle: 'رجوع' }} />
        <Stack.Screen name="settings" options={{ title: 'الإعدادات', headerBackTitle: 'رجوع' }} />
      </Stack>
      <AppLockGate />
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
