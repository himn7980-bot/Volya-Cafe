// Import single weights: the package index would bundle all nine.
import { NotoSans_400Regular } from '@expo-google-fonts/noto-sans/400Regular';
import { NotoSans_700Bold } from '@expo-google-fonts/noto-sans/700Bold';
import { NotoSansBengali_400Regular } from '@expo-google-fonts/noto-sans-bengali/400Regular';
import { NotoSansBengali_700Bold } from '@expo-google-fonts/noto-sans-bengali/700Bold';
import { NotoSansDevanagari_400Regular } from '@expo-google-fonts/noto-sans-devanagari/400Regular';
import { NotoSansDevanagari_700Bold } from '@expo-google-fonts/noto-sans-devanagari/700Bold';
import { NotoSansHebrew_400Regular } from '@expo-google-fonts/noto-sans-hebrew/400Regular';
import { NotoSansHebrew_700Bold } from '@expo-google-fonts/noto-sans-hebrew/700Bold';
import { Vazirmatn_400Regular } from '@expo-google-fonts/vazirmatn/400Regular';
import { Vazirmatn_700Bold } from '@expo-google-fonts/vazirmatn/700Bold';
import { useColorScheme } from 'react-native';

import { usePrefs } from '@/i18n';
import type { Script } from '@/i18n/languages';
import { useSettings } from '@/stores/settings';

// ---------- Colors ----------

export interface Palette {
  background: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textMuted: string;
  border: string;
  primary: string;
  onPrimary: string;
  primarySoft: string;
  positive: string; // money owed to me
  negative: string; // money I owe (kept soft: owing isn't a failure)
  danger: string;
  focus: string;
}

const light: Palette = {
  background: '#F7F6F2',
  surface: '#FFFFFF',
  surfaceAlt: '#EFEDE6',
  text: '#1C1B19',
  textMuted: '#5E5B54',
  border: '#D9D5CB',
  primary: '#1F6F5C',
  onPrimary: '#FFFFFF',
  primarySoft: '#DCEFE8',
  positive: '#1F7A4D',
  negative: '#A25B12',
  danger: '#B3261E',
  focus: '#2B7FFF',
};

const dark: Palette = {
  background: '#111315',
  surface: '#1B1E21',
  surfaceAlt: '#24282C',
  text: '#F2F1ED',
  textMuted: '#B4B0A7',
  border: '#3A3F44',
  primary: '#5CC2A6',
  onPrimary: '#0B2620',
  primarySoft: '#1E3A33',
  positive: '#6BD39A',
  negative: '#F0B26B',
  danger: '#FF8A80',
  focus: '#8AB4FF',
};

export function useColors(): Palette {
  const pref = useSettings((s) => s.theme);
  const system = useColorScheme();
  const scheme = pref === 'system' ? (system ?? 'light') : pref;
  return scheme === 'dark' ? dark : light;
}

export function useIsDark(): boolean {
  return useColors() === dark;
}

// ---------- Spacing & type ----------

// Generous sizes: the app must be comfortable for older people.
export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radius = { sm: 8, md: 14, lg: 20, pill: 999 } as const;
export const minTapSize = 56;

export const typeScale = {
  title: { fontSize: 30, lineHeight: 40 },
  heading: { fontSize: 22, lineHeight: 32 },
  body: { fontSize: 18, lineHeight: 28 },
  label: { fontSize: 17, lineHeight: 24 },
  caption: { fontSize: 15, lineHeight: 22 },
} as const;
export type TextVariant = keyof typeof typeScale;

// ---------- Fonts ----------

export const fontAssets = {
  Vazirmatn_400Regular,
  Vazirmatn_700Bold,
  NotoSans_400Regular,
  NotoSans_700Bold,
  NotoSansDevanagari_400Regular,
  NotoSansDevanagari_700Bold,
  NotoSansBengali_400Regular,
  NotoSansBengali_700Bold,
  NotoSansHebrew_400Regular,
  NotoSansHebrew_700Bold,
};

type FontPair = { regular: string; bold: string } | undefined;

const FONTS_BY_SCRIPT: Record<Script, FontPair> = {
  arab: { regular: 'Vazirmatn_400Regular', bold: 'Vazirmatn_700Bold' },
  latn: { regular: 'NotoSans_400Regular', bold: 'NotoSans_700Bold' },
  cyrl: { regular: 'NotoSans_400Regular', bold: 'NotoSans_700Bold' },
  deva: { regular: 'NotoSansDevanagari_400Regular', bold: 'NotoSansDevanagari_700Bold' },
  beng: { regular: 'NotoSansBengali_400Regular', bold: 'NotoSansBengali_700Bold' },
  hebr: { regular: 'NotoSansHebrew_400Regular', bold: 'NotoSansHebrew_700Bold' },
  // CJK fonts are tens of MB; the system font (PingFang / Noto Sans CJK) is better.
  hans: undefined,
  hant: undefined,
  other: undefined,
};

/** Font family for the current UI language. `undefined` = system font. */
export function useFontFamily(bold = false): string | undefined {
  const { language } = usePrefs();
  const pair = FONTS_BY_SCRIPT[language.meta.script];
  return pair ? (bold ? pair.bold : pair.regular) : undefined;
}
