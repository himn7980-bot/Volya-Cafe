// Push notifications: permission, registering this phone's Expo push token
// with the server, and opening the right record when one is tapped.
//
// Notifications are sent by the `push` Edge Function, written in the
// recipient's language. Push needs a development or store build (not Expo Go)
// and an EAS project id (`npx eas-cli init`), see README.
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';

import { requestSync } from '@/features/loans/service';
import { supabase } from '@/lib/supabase';

const TOKEN_KEY = 'iou.pushToken';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

async function registerToken(): Promise<void> {
  if (!Device.isDevice || Platform.OS === 'web') return;
  const id = projectId();
  if (!id) {
    if (__DEV__) console.warn('No EAS projectId: run `npx eas-cli init` to enable push notifications.');
    return;
  }
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'IOU',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const token = (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
  const { error } = await supabase.rpc('register_push_token', { p_token: token, p_platform: Platform.OS });
  if (!error) await AsyncStorage.setItem(TOKEN_KEY, token);
}

/**
 * Ask for permission at a moment that makes sense to the person (after their
 * first record), then register. Never asks twice if they said no.
 */
export async function askForPushPermission(fromSettings = false): Promise<void> {
  try {
    const current = await Notifications.getPermissionsAsync();
    // Asked from Settings, the person wants it: ask again when the system still allows it.
    if (current.status === 'denied' && !(fromSettings && current.canAskAgain)) return;
    const result = current.granted ? current : await Notifications.requestPermissionsAsync();
    if (result.granted) await registerToken();
  } catch (e) {
    if (__DEV__) console.warn('push registration failed', e);
  }
}

/** Forget this phone on the server (sign-out), so the next account's notifications don't go to the old one. */
export async function unregisterPush(): Promise<void> {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (!token) return;
  await supabase.rpc('unregister_push_token', { p_token: token });
  await AsyncStorage.removeItem(TOKEN_KEY);
}

/** After the account was deleted on the server (its tokens went with it). */
export async function forgetPushToken(): Promise<void> {
  await AsyncStorage.removeItem(TOKEN_KEY);
}

export type PushState = 'on' | 'off' | 'blocked' | 'unavailable';

/**
 * Notification permission for the Settings screen. Re-read when the app comes
 * back from the system settings. 'blocked': the person said no, only the
 * system settings can turn it on.
 */
async function readPushState(): Promise<PushState> {
  if (!Device.isDevice || Platform.OS === 'web') return 'unavailable';
  const p = await Notifications.getPermissionsAsync();
  return p.granted ? 'on' : p.canAskAgain ? 'off' : 'blocked';
}

export function usePushState() {
  const [state, setState] = useState<PushState | null>(null);
  useEffect(() => {
    void readPushState().then(setState);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void readPushState().then(setState);
    });
    return () => sub.remove();
  }, []);
  const turnOn = useCallback(async () => {
    if (state === 'blocked' || state === 'on') await Linking.openSettings();
    else await askForPushPermission(true);
    setState(await readPushState());
  }, [state]);
  return { state, turnOn };
}

function openFrom(response: Notifications.NotificationResponse | null) {
  const loanId = response?.notification.request.content.data?.loanId;
  if (typeof loanId === 'string') router.push({ pathname: '/loans/[id]', params: { id: loanId } });
}

/** While signed in: keep the token fresh, sync when something arrives, open tapped notifications. */
export function usePush(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    void Notifications.getPermissionsAsync().then((p) => {
      if (p.granted) void registerToken().catch(() => undefined);
    });
    void Notifications.getLastNotificationResponseAsync().then(openFrom);
    const received = Notifications.addNotificationReceivedListener(() => requestSync(0));
    const tapped = Notifications.addNotificationResponseReceivedListener((r) => {
      requestSync(0);
      openFrom(r);
    });
    return () => {
      received.remove();
      tapped.remove();
    };
  }, [enabled]);
}
