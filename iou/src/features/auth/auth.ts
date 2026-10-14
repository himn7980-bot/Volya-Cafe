import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
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

/** Sign out and forget this account's data on the phone. */
export async function signOut() {
  // Imported lazily: the loans service pulls in SQLite, which auth doesn't need otherwise.
  const { clearLocalData } = await import('@/features/loans/service');
  await supabase.auth.signOut();
  await clearLocalData();
}
