// Pure logic of the public confirmation page: choosing the language and
// turning the server's answer into sentences. No DOM here, so it is unit-tested.

import type { CalendarSystem } from '../../src/shared/calendars';
import type { DigitSystem } from '../../src/shared/digits';
import { formatDate, formatMoney, type FormatContext } from '../../src/shared/format';

export interface LangMeta {
  code: string;
  nativeName: string;
  dir: 'ltr' | 'rtl';
  script: string;
  nativeDigits: DigitSystem;
  defaultDigits: 'native' | 'latin';
  defaultCalendar: CalendarSystem;
}

/** What get_shared_loan returns (see supabase/migrations/*_sharing.sql). */
export type SharedLoan =
  | { error: 'not_found' | 'rate_limited' }
  | {
      error?: undefined;
      status: 'pending' | 'confirmed' | 'disputed' | 'settled' | 'cancelled';
      open: false;
      creator_name: string;
      language: string;
    }
  | {
      error?: undefined;
      status: 'pending' | 'disputed';
      open: true;
      creator_name: string;
      language: string;
      creator_role: 'lender' | 'borrower';
      counterparty_name: string;
      amount_minor: number;
      currency: string;
      note: string;
      loan_date: string;
      due_date: string | null;
      has_photo: boolean;
      dispute_comment: string | null;
      version: number;
    };

export type Dict = Record<string, unknown>;
export type T = (key: string, params?: Record<string, string>) => string;

function lookup(dict: Dict | undefined, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Dict)[part] : undefined), dict);
}

/** Minimal i18next-compatible lookup: dotted keys, {{var}} interpolation, English fallback. */
export function makeT(primary: Dict, fallback: Dict, defaults: Record<string, string>): T {
  return (key, params = {}) => {
    const raw = lookup(primary, key) ?? lookup(fallback, key);
    if (typeof raw !== 'string') return key;
    const vars = { ...defaults, ...params };
    return raw.replace(/\{\{(\w+)\}\}/g, (m, name: string) => vars[name] ?? m);
  };
}

export function listOf(t: T, key: string): string[] {
  const out: string[] = [];
  for (let i = 0; ; i++) {
    const v = t(`${key}.${i}`);
    if (v === `${key}.${i}`) return out;
    out.push(v);
  }
}

/** Best language: ?lang=, then the visitor's saved choice, browser languages, then the writer's language. */
export function pickLanguage(
  available: readonly string[],
  opts: { query?: string | null; stored?: string | null; browser?: readonly string[]; writer?: string | null },
): string {
  const match = (tag: string | null | undefined): string | null => {
    if (!tag) return null;
    if (available.includes(tag)) return tag;
    const base = tag.split(/[-_]/)[0]!.toLowerCase();
    const alias: Record<string, string> = { iw: 'he', in: 'id', ku: 'ckb' };
    const b = alias[base] ?? base;
    return available.includes(b) ? b : null;
  };
  return (
    match(opts.query) ??
    match(opts.stored) ??
    (opts.browser ?? []).map(match).find((x): x is string => !!x) ??
    match(opts.writer) ??
    'en'
  );
}

export function formatContextFor(lang: LangMeta, t: T): FormatContext {
  return {
    locale: lang.code,
    digits: lang.defaultDigits === 'native' ? lang.nativeDigits : 'latn',
    calendar: lang.defaultCalendar,
    // Toman is how Persian speakers talk about money.
    irrAsToman: lang.code === 'fa',
    labels: {
      toman: t('currency.toman'),
      months: { gregory: listOf(t, 'months.gregory'), persian: listOf(t, 'months.persian'), islamic: listOf(t, 'months.islamic') },
      dateLong: t('date.long'),
      dateShort: t('date.short'),
    },
  };
}

export interface RecordView {
  headline: string;
  amount: string;
  details: string[];
  disputed: string | null;
}

/** Sentences describing an open record, from the visitor's point of view. */
export function describeRecord(loan: Extract<SharedLoan, { open: true }>, t: T, fmt: FormatContext): RecordView {
  const amount = formatMoney(loan.amount_minor, loan.currency, fmt);
  // Keep the name an isolated run so an English name in a Persian sentence (or the reverse) reads right.
  const name = `⁨${loan.creator_name}⁩`;
  const details = [t('web.onDate', { date: formatDate(loan.loan_date, fmt) })];
  if (loan.due_date) details.push(t('web.dueDate', { date: formatDate(loan.due_date, fmt) }));
  if (loan.note) details.push(t('web.note', { note: loan.note }));
  if (loan.has_photo) details.push(t('web.photoAttached'));
  return {
    headline: t(loan.creator_role === 'lender' ? 'web.lentYou' : 'web.borrowedFromYou', { name, amount }),
    amount,
    details,
    disputed: loan.status === 'disputed' && loan.dispute_comment ? t('web.alreadyDisputed', { comment: loan.dispute_comment }) : null,
  };
}
