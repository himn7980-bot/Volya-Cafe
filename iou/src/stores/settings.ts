import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { CalendarSystem } from '@/shared/calendars';

export type ThemePreference = 'system' | 'light' | 'dark';
export type DigitPreference = 'native' | 'latin';

/**
 * Device-local preferences. `null` means "use the default for the current
 * language" so that, e.g., switching to Persian also switches to the Persian
 * calendar unless the person picked a calendar explicitly.
 *
 * The same preferences are mirrored to the profile row in Supabase so they
 * follow the person to a new phone and so messages to them use their language.
 */
export interface SettingsState {
  hydrated: boolean;
  onboarded: boolean;
  language: string | null;
  digits: DigitPreference | null;
  calendar: CalendarSystem | null;
  defaultCurrency: string | null;
  irrAsToman: boolean | null;
  theme: ThemePreference;
  /** Share-link token opened in the app, waiting to be linked after sign-in. */
  pendingClaim: string | null;

  setPendingClaim: (token: string | null) => void;
  setOnboarded: (v: boolean) => void;
  setLanguage: (code: string) => void;
  setDigits: (v: DigitPreference | null) => void;
  setCalendar: (v: CalendarSystem | null) => void;
  setDefaultCurrency: (code: string | null) => void;
  setIrrAsToman: (v: boolean | null) => void;
  setTheme: (v: ThemePreference) => void;
  /** Apply preferences stored on the server profile (after sign-in). */
  applyRemote: (p: Partial<Pick<SettingsState, 'language' | 'digits' | 'calendar' | 'defaultCurrency'>>) => void;
  reset: () => void;
}

const STORAGE_KEY = 'iou.settings.v1';

const initial = {
  onboarded: false,
  language: null,
  digits: null,
  calendar: null,
  defaultCurrency: null,
  irrAsToman: null,
  theme: 'system' as ThemePreference,
  pendingClaim: null as string | null,
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      hydrated: false,
      ...initial,
      setPendingClaim: (pendingClaim) => set({ pendingClaim }),
      setOnboarded: (onboarded) => set({ onboarded }),
      setLanguage: (language) => set({ language }),
      setDigits: (digits) => set({ digits }),
      setCalendar: (calendar) => set({ calendar }),
      setDefaultCurrency: (defaultCurrency) => set({ defaultCurrency }),
      setIrrAsToman: (irrAsToman) => set({ irrAsToman }),
      setTheme: (theme) => set({ theme }),
      applyRemote: (p) =>
        set((s) => ({
          language: p.language ?? s.language,
          digits: p.digits ?? s.digits,
          calendar: p.calendar ?? s.calendar,
          defaultCurrency: p.defaultCurrency ?? s.defaultCurrency,
        })),
      reset: () => set({ ...initial, onboarded: true }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ hydrated: _h, ...rest }) => rest,
      onRehydrateStorage: () => () => {
        useSettings.setState({ hydrated: true });
      },
    },
  ),
);


/**
 * Resolve once pending settings writes have reached disk. AsyncStorage runs
 * operations in order, so a read queued after the write is a barrier. Call it
 * before restarting the app.
 */
export async function flushSettings(): Promise<void> {
  await AsyncStorage.getItem(STORAGE_KEY);
}
