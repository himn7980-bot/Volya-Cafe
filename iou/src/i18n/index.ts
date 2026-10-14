import { getLocales } from 'expo-localization';
import { createInstance } from 'i18next';
import { useMemo } from 'react';
import { initReactI18next, useTranslation } from 'react-i18next';

import { brand } from '@/lib/brand';
import type { CalendarSystem } from '@/shared/calendars';
import type { DigitSystem } from '@/shared/digits';
import type { FormatContext, FormatLabels } from '@/shared/format';
import { useSettings, type SettingsState } from '@/stores/settings';

import { FALLBACK_LANGUAGE, LANGUAGES, getLanguage, matchLanguage, type Language } from './languages';

export { LANGUAGES, getLanguage, type Language } from './languages';

/** Best supported language for this device's language list. */
export function deviceLanguage(): string {
  return matchLanguage(getLocales().map((l) => l.languageTag));
}

/** The app's i18next instance. */
export const i18n = createInstance();

let initialized = false;

export function initI18n(language: string): typeof i18n {
  if (initialized) {
    if (i18n.language !== language) void i18n.changeLanguage(language);
    return i18n;
  }
  initialized = true;
  void i18n.use(initReactI18next).init({
    resources: Object.fromEntries(LANGUAGES.map((l) => [l.code, { translation: l.resources }])),
    lng: language,
    fallbackLng: FALLBACK_LANGUAGE,
    interpolation: {
      escapeValue: false, // React already escapes
      defaultVariables: { appName: brand.name },
    },
    returnNull: false,
    initAsync: false,
  });
  return i18n;
}


/** Preferences with language defaults filled in. */
export interface ResolvedPrefs {
  language: Language;
  digits: DigitSystem;
  calendar: CalendarSystem;
  defaultCurrency: string;
  irrAsToman: boolean;
}

function deviceCurrency(): string | null {
  return getLocales().find((l) => l.currencyCode)?.currencyCode ?? null;
}

export function resolvePrefs(
  s: Pick<SettingsState, 'language' | 'digits' | 'calendar' | 'defaultCurrency' | 'irrAsToman'>,
): ResolvedPrefs {
  const language = getLanguage(s.language ?? deviceLanguage());
  const wantsNative = (s.digits ?? language.meta.defaultDigits) === 'native';
  const currency = s.defaultCurrency ?? deviceCurrency() ?? (language.code === 'fa' ? 'IRR' : 'USD');
  return {
    language,
    digits: wantsNative ? language.meta.nativeDigits : 'latn',
    calendar: s.calendar ?? language.meta.defaultCalendar,
    defaultCurrency: currency,
    // Toman is the everyday unit in Iran, so default to it for Persian speakers.
    irrAsToman: s.irrAsToman ?? language.code === 'fa',
  };
}

export function usePrefs(): ResolvedPrefs {
  const language = useSettings((s) => s.language);
  const digits = useSettings((s) => s.digits);
  const calendar = useSettings((s) => s.calendar);
  const defaultCurrency = useSettings((s) => s.defaultCurrency);
  const irrAsToman = useSettings((s) => s.irrAsToman);
  return useMemo(
    () => resolvePrefs({ language, digits, calendar, defaultCurrency, irrAsToman }),
    [language, digits, calendar, defaultCurrency, irrAsToman],
  );
}

/** Formatting context for the current language and preferences. */
export function useFormat(): FormatContext {
  const prefs = usePrefs();
  const { t } = useTranslation();
  return useMemo(() => {
    const months = (cal: CalendarSystem) => t(`months.${cal}`, { returnObjects: true }) as unknown as string[];
    const labels: FormatLabels = {
      toman: t('currency.toman'),
      months: { gregory: months('gregory'), persian: months('persian'), islamic: months('islamic') },
      dateLong: t('date.long'),
      dateShort: t('date.short'),
    };
    return {
      locale: prefs.language.code,
      digits: prefs.digits,
      calendar: prefs.calendar,
      irrAsToman: prefs.irrAsToman,
      labels,
    };
  }, [prefs, t]);
}

/** Localized currency name, e.g. "US Dollar" / "دلار آمریکا", falling back to the code. */
export function currencyName(code: string, locale: string): string {
  try {
    const names = new Intl.DisplayNames([locale, FALLBACK_LANGUAGE], { type: 'currency' });
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}
