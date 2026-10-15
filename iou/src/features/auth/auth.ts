import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { create } from 'zustand';

import type { ResolvedPrefs } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { toLatinDigits } from '@/shared/digits';

WebBrowser.maybeCompleteAuthSession();

// ---------- Session store ----------

interface SessionState {
  /** undefined = not loaded yet, null = signed out. */
  session: Session | null | undefined;
  setSession: (s: Session | null) => void;
}

export const useSession = create<SessionState>()((set) => ({
  session: undefined,
  setSession: (session) => set({ session }),
}));

/** Load the stored session and keep the store in sync. Call once at startup. */
export function startAuthListener(): () => void {
  void supabase.auth.getSession().then(({ data }) => useSession.getState().setSession(data.session));
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    useSession.getState().setSession(session);
  });
  return () => data.subscription.unsubscribe();
}

// ---------- Validation ----------

/** Normalize to E.164 ("+989121234567"), or null if it can't be a phone number. */
export function normalizePhone(input: string): string | null {
  let s = toLatinDigits(input).replace(/[\s\-().‎‏‪-‮]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  return /^\+[1-9]\d{6,14}$/.test(s) ? s : null;
}

export function isValidEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(input.trim());
}

// ---------- Sign-in flows ----------

/** Where magic links and OAuth return to, e.g. iou://auth-callback */
export const authRedirectUrl = () => Linking.createURL('auth-callback');

/** Sent with sign-up so the server-side profile starts with the right preferences. */
function signUpData(prefs: ResolvedPrefs) {
  return {
    language: prefs.language.code,
    default_currency: prefs.defaultCurrency,
    digits: prefs.digits === 'latn' ? 'latin' : 'native',
    calendar: prefs.calendar,
  };
}

export async function sendPhoneCode(phone: string, prefs: ResolvedPrefs) {
  const { error } = await supabase.auth.signInWithOtp({ phone, options: { data: signUpData(prefs) } });
  if (error) throw error;
}

export async function sendEmailLink(email: string, prefs: ResolvedPrefs) {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: authRedirectUrl(), data: signUpData(prefs) },
  });
  if (error) throw error;
}

export async function verifyCode(kind: 'phone' | 'email', contact: string, code: string) {
  const token = toLatinDigits(code).replace(/\D/g, '');
  const { error } =
    kind === 'phone'
      ? await supabase.auth.verifyOtp({ phone: contact, token, type: 'sms' })
      : await supabase.auth.verifyOtp({ email: contact, token, type: 'email' });
  if (error) throw error;
}

// On Android the OAuth redirect can reach both openAuthSessionAsync and the
// router's deep-link handler; a code may only be exchanged once.
const handledCodes = new Set<string>();

/** Finish a magic-link or OAuth sign-in from the URL the app was opened with. */
export async function completeSignInFromUrl(url: string): Promise<boolean> {
  const { queryParams } = Linking.parse(url);
  // Errors can come back in the query or the fragment.
  const fragment = new URLSearchParams(url.split('#')[1] ?? '');
  const error = queryParams?.error_description ?? queryParams?.error ?? fragment.get('error_description');
  if (error) throw new Error(String(error));
  const code = queryParams?.code;
  if (typeof code !== 'string') return false;
  if (handledCodes.has(code)) return true;
  handledCodes.add(code);
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) throw exchangeError;
  return true;
}

/** Returns false when the person closed the Google window. */
export async function signInWithGoogle(): Promise<boolean> {
  const redirectTo = authRedirectUrl();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
  });
  if (error) throw error;
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return false;
  return completeSignInFromUrl(result.url);
}

/**
 * Sign in with Apple (iOS only, native sheet). Returns false when cancelled.
 * Apple shares the person's name only the very first time, so it is saved to
 * the profile right away when the profile has no name yet.
 */
export async function signInWithApple(): Promise<boolean> {
  const AppleAuthentication = await import('expo-apple-authentication');
  const Crypto = await import('expo-crypto');
  // Apple gets the hashed nonce, Supabase the raw one, so a stolen token can't be replayed.
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  let credential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: hashedNonce,
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return false;
    throw e;
  }
  if (!credential.identityToken) throw new Error('Apple returned no identity token');
  const { data, error } = await supabase.auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken, nonce: rawNonce });
  if (error) throw error;
  const name = [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(' ').trim();
  suggestedName = name;
  if (name && data.user) {
    await supabase.from('profiles').update({ display_name: name.slice(0, 80) }).eq('id', data.user.id).eq('display_name', '');
  }
  return true;
}

/** A name the sign-in provider gave us, to prefill the "what's your name" step. */
export let suggestedName = '';

/** Whether this phone offers Sign in with Apple (iOS 13+). */
export async function appleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  const AppleAuthentication = await import('expo-apple-authentication');
  return AppleAuthentication.isAvailableAsync();
}

/** Sign out and forget this account's data on the phone. */
export async function signOut() {
  // Imported lazily: the loans service pulls in SQLite, which auth doesn't need otherwise.
  const { clearLocalData } = await import('@/features/loans/service');
  const { unregisterPush } = await import('@/features/notifications/push');
  await unregisterPush().catch(() => undefined);
  await supabase.auth.signOut();
  await clearLocalData();
}
