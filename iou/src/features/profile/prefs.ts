import { useEffect, useRef } from 'react';

import { resolvePrefs } from '@/i18n';
import type { ProfileRow, ProfileUpdate } from '@/lib/database.types';
import { useSettings, type SettingsState } from '@/stores/settings';

import { useUpdateProfile } from './api';

type Prefs = Pick<SettingsState, 'language' | 'digits' | 'calendar' | 'defaultCurrency' | 'irrAsToman'>;

/** Server profile values for the current local preferences. */
export function prefsToProfile(s: Prefs): Required<Pick<ProfileUpdate, 'language' | 'digits' | 'calendar' | 'default_currency'>> {
  const r = resolvePrefs(s);
  return {
    language: r.language.code,
    digits: s.digits ?? r.language.meta.defaultDigits,
    calendar: r.calendar,
    default_currency: r.defaultCurrency,
  };
}

/**
 * Reconcile device and server preferences once per sign-in:
 *  - The language chosen on this phone wins (the person just picked it).
 *  - A brand-new profile takes this phone's other preferences too.
 *  - An existing profile's digits, calendar and currency follow the person
 *    to the new phone.
 * The server copy matters beyond this phone: messages to this person are
 * written in their profile language.
 */
export function useReconcilePrefs(profile: ProfileRow | undefined) {
  const update = useUpdateProfile();
  const doneFor = useRef<string | null>(null);

  useEffect(() => {
    if (!profile || doneFor.current === profile.id) return;
    doneFor.current = profile.id;
    const settings = useSettings.getState();
    const local = prefsToProfile(settings);
    const patch: ProfileUpdate = {};
    if (profile.language !== local.language) patch.language = local.language;

    const isNew = !profile.display_name.trim();
    if (isNew) {
      if (profile.digits !== local.digits) patch.digits = local.digits;
      if (profile.calendar !== local.calendar) patch.calendar = local.calendar;
      if (profile.default_currency !== local.default_currency) patch.default_currency = local.default_currency;
    } else {
      settings.applyRemote({
        digits: profile.digits,
        calendar: profile.calendar,
        defaultCurrency: profile.default_currency,
      });
    }
    if (Object.keys(patch).length) update.mutate(patch);
  }, [profile, update]);
}

/**
 * Change a preference on this phone and on the profile. Local first, so it
 * works offline; the server copy catches up on the next change or sign-in.
 */
export function useSavePrefs() {
  const update = useUpdateProfile();
  return (change: Partial<Prefs>) => {
    const s = useSettings.getState();
    if (change.digits !== undefined) s.setDigits(change.digits);
    if (change.calendar !== undefined) s.setCalendar(change.calendar);
    if (change.defaultCurrency !== undefined) s.setDefaultCurrency(change.defaultCurrency);
    if (change.irrAsToman !== undefined) s.setIrrAsToman(change.irrAsToman);
    if (change.language !== undefined && change.language !== null) s.setLanguage(change.language);
    update.mutate(prefsToProfile(useSettings.getState()));
  };
}
