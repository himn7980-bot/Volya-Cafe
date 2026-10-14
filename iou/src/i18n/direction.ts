import * as Updates from 'expo-updates';
import { DevSettings, I18nManager } from 'react-native';

import { getLanguage } from './languages';

export function isRtlLanguage(code: string): boolean {
  return getLanguage(code).meta.dir === 'rtl';
}

/**
 * Point React Native's layout direction at the language's direction.
 * Returns true when the change only takes effect after a reload, which is
 * how React Native mirrors layouts (I18nManager is read once at startup).
 */
export function applyDirection(code: string): boolean {
  const rtl = isRtlLanguage(code);
  I18nManager.allowRTL(true);
  if (I18nManager.isRTL === rtl) return false;
  I18nManager.forceRTL(rtl);
  return true;
}

/** Restart the JS app so a new layout direction is applied. */
export async function reloadApp(): Promise<void> {
  try {
    await Updates.reloadAsync();
  } catch {
    // expo-updates is disabled in development builds / Expo Go.
    DevSettings.reload();
  }
}
