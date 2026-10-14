import type { NativeStackNavigationOptions } from 'expo-router';

import { useColors, useFontFamily } from '@/theme';

/** Shared header look for every stack. */
export function useStackOptions(): NativeStackNavigationOptions {
  const c = useColors();
  const headerFont = useFontFamily(true);
  return {
    headerStyle: { backgroundColor: c.background },
    headerTintColor: c.text,
    headerTitleStyle: { fontFamily: headerFont, fontSize: 20 },
    headerShadowVisible: false,
    headerBackButtonDisplayMode: 'minimal',
    contentStyle: { backgroundColor: c.background },
  };
}
