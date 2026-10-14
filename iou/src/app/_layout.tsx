import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useStackOptions } from '@/components/navigation';
import { startAuthListener, useSession } from '@/features/auth/auth';
import { deviceLanguage, initI18n } from '@/i18n';
import { ensureDirection } from '@/i18n/useChangeLanguage';
import { useSettings } from '@/stores/settings';
import { fontAssets, useColors, useIsDark } from '@/theme';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const hydrated = useSettings((s) => s.hydrated);
  const language = useSettings((s) => s.language);
  const session = useSession((s) => s.session);
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 2, networkMode: 'offlineFirst' } } }),
  );

  useEffect(() => startAuthListener(), []);

  const lang = language ?? deviceLanguage();
  if (hydrated) initI18n(lang);

  useEffect(() => {
    if (hydrated) void ensureDirection(lang);
  }, [hydrated, lang]);

  // A missing font must never block the app: fall back to system fonts.
  const ready = (fontsLoaded || !!fontError) && hydrated && session !== undefined;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <RootStack />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function RootStack() {
  const c = useColors();
  const dark = useIsDark();
  const stackOptions = useStackOptions();
  const onboarded = useSettings((s) => s.onboarded);
  const signedIn = !!useSession((s) => s.session);

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(c.background);
  }, [c.background]);

  return (
    <>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack screenOptions={stackOptions}>
        <Stack.Protected guard={!onboarded}>
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={onboarded && !signedIn}>
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
          <Stack.Screen name="verify" options={{ title: '' }} />
        </Stack.Protected>
        <Stack.Protected guard={onboarded && signedIn}>
          <Stack.Screen name="(app)" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Screen name="auth-callback" options={{ headerShown: false }} />
        <Stack.Screen name="claim" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}
