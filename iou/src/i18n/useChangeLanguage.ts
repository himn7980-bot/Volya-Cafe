import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';

import { flushSettings, useSettings } from '@/stores/settings';

import { applyDirection, reloadApp } from './direction';
import { i18n, initI18n } from './index';

/**
 * Switch the UI language. Text changes immediately; when the layout direction
 * changes too (e.g. English -> Persian) the app restarts to mirror the layout,
 * after asking if `confirm` is set.
 */
export async function changeLanguage(code: string, { confirm }: { confirm: boolean }): Promise<void> {
  useSettings.getState().setLanguage(code);
  initI18n(code);
  await i18n.changeLanguage(code);
  if (!applyDirection(code)) return;
  await flushSettings();
  if (!confirm) {
    await reloadApp();
    return;
  }
  Alert.alert(i18n.t('settings.restartTitle'), i18n.t('settings.restartBody'), [
    { text: i18n.t('settings.restartNow'), onPress: () => void reloadApp() },
  ]);
}

const RELOAD_GUARD_KEY = 'iou.direction-reload-at';

/**
 * At startup, make sure the layout direction matches the saved language.
 * Reloads at most once per 30 seconds so a platform that refuses the change
 * can never cause a reload loop.
 */
export async function ensureDirection(code: string): Promise<void> {
  if (!applyDirection(code)) return;
  const last = Number(await AsyncStorage.getItem(RELOAD_GUARD_KEY));
  if (Date.now() - last < 30_000) return;
  await AsyncStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  await reloadApp();
}
