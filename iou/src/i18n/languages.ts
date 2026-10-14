// Language registry. Every JSON file in ./locales is picked up automatically:
// to add a language, drop `<code>.json` in that folder (copy en.json, translate,
// fill in "meta"). Nothing else needs to change.

import type { CalendarSystem } from '@/shared/calendars';
import type { DigitSystem } from '@/shared/digits';

import { localeFiles } from './localeFiles';

export type Script = 'latn' | 'cyrl' | 'arab' | 'hebr' | 'deva' | 'beng' | 'hans' | 'hant' | 'other';

export interface LanguageMeta {
  /** English name, e.g. "Persian". */
  name: string;
  /** Name in the language itself, e.g. "فارسی". */
  nativeName: string;
  dir: 'ltr' | 'rtl';
  script: Script;
  /** The language's own digits ('latn' when it uses 0-9). */
  nativeDigits: DigitSystem;
  /** Whether to show native or Latin digits until the person chooses. */
  defaultDigits: 'native' | 'latin';
  defaultCalendar: CalendarSystem;
}

export interface Language {
  /** BCP 47 code, taken from the file name (en, fa, ckb, zh, pt-BR...). */
  code: string;
  meta: LanguageMeta;
  resources: Record<string, unknown>;
}

const byCode = new Map<string, Language>();
for (const [code, file] of Object.entries(localeFiles)) {
  const { meta, ...resources } = file as { meta: LanguageMeta } & Record<string, unknown>;
  byCode.set(code, { code, meta, resources });
}

export const FALLBACK_LANGUAGE = 'en';

/** All languages, English first, then by English name. */
export const LANGUAGES: Language[] = [...byCode.values()].sort((a, b) =>
  a.code === FALLBACK_LANGUAGE ? -1 : b.code === FALLBACK_LANGUAGE ? 1 : a.meta.name.localeCompare(b.meta.name),
);

export function getLanguage(code: string | null | undefined): Language {
  return (code && byCode.get(code)) || byCode.get(FALLBACK_LANGUAGE)!;
}

export function isSupportedLanguage(code: string | null | undefined): code is string {
  return !!code && byCode.has(code);
}

// Old or alternative codes devices may report.
const ALIASES: Record<string, string> = {
  iw: 'he',
  in: 'id',
  ku: 'ckb',
  'zh-CN': 'zh',
  'zh-SG': 'zh',
  'zh-Hans': 'zh',
};

/**
 * Pick the best supported language for a list of device locale tags
 * (most preferred first), e.g. ['fa-IR', 'en-US'] -> 'fa'.
 */
export function matchLanguage(tags: readonly string[]): string {
  for (const tag of tags) {
    const parts = tag.split(/[-_]/);
    const candidates = [tag, ALIASES[tag], `${parts[0]}-${parts[1] ?? ''}`, parts[0], ALIASES[parts[0]]];
    for (const c of candidates) {
      if (isSupportedLanguage(c)) return c;
    }
  }
  return FALLBACK_LANGUAGE;
}
