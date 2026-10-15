// Sends queued notifications (public.notifications) as push messages through
// the Expo Push API, written in each recipient's language.
// Pure: the database and Expo are passed in, so it is tested without a network.

import type { FormatContext } from '../_shared/generated/format.ts';
import type { DigitSystem } from '../_shared/generated/digits.ts';
import type { CalendarSystem } from '../_shared/generated/calendars.ts';
import {
  renderNotification,
  type NotificationData,
  type NotificationKind,
  type Translate,
} from '../_shared/generated/notifications.ts';

type Dict = Record<string, unknown>;

export interface LocaleStrings {
  meta: { nativeDigits: DigitSystem; defaultDigits: 'native' | 'latin'; defaultCalendar: CalendarSystem };
  [section: string]: unknown;
}

export interface QueuedNotification {
  id: number;
  kind: NotificationKind;
  data: NotificationData;
  language: string;
  tokens: string[];
}

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  channelId: string;
  data: { loanId: string; kind: string };
}

export type ExpoTicket = { status: 'ok'; id?: string } | { status: 'error'; message: string; details?: { error?: string } };

export interface Deps {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
  sendToExpo: (messages: ExpoMessage[]) => Promise<ExpoTicket[]>;
  strings: Record<string, LocaleStrings>;
}

function lookup(dict: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((n, p) => (n && typeof n === 'object' ? (n as Dict)[p] : undefined), dict);
}

export function translator(primary: LocaleStrings, fallback: LocaleStrings): Translate {
  return (key, params = {}) => {
    const raw = lookup(primary, key) ?? lookup(fallback, key);
    if (typeof raw !== 'string') return key;
    return raw.replace(/\{\{(\w+)\}\}/g, (m, k: string) => params[k] ?? m);
  };
}

export function formatContextFor(code: string, s: LocaleStrings): FormatContext {
  const months = (cal: CalendarSystem) => (lookup(s, `months.${cal}`) as string[] | undefined) ?? [];
  return {
    locale: code,
    digits: s.meta.defaultDigits === 'native' ? s.meta.nativeDigits : 'latn',
    calendar: s.meta.defaultCalendar,
    irrAsToman: code === 'fa',
    labels: {
      toman: String(lookup(s, 'currency.toman') ?? 'toman'),
      months: { gregory: months('gregory'), persian: months('persian'), islamic: months('islamic') },
      dateLong: String(lookup(s, 'date.long') ?? '{day} {month} {year}'),
      dateShort: String(lookup(s, 'date.short') ?? '{y}-{m}-{d}'),
    },
  };
}

const CHUNK = 100; // Expo accepts up to 100 messages per request

export async function processQueue(deps: Deps, batchSize = 100): Promise<{ sent: number; failed: number }> {
  const batch = (await deps.rpc('claim_notifications', { p_limit: batchSize })) as QueuedNotification[];
  if (!batch.length) return { sent: 0, failed: 0 };

  const messages: ExpoMessage[] = [];
  const owners: number[] = []; // notification id for each message
  const sent = new Set<number>();
  const failed: Record<string, string> = {};
  const deadTokens: string[] = [];

  for (const n of batch) {
    if (n.tokens.length === 0) {
      sent.add(n.id); // nowhere to send it; the app shows the change on its next sync
      continue;
    }
    const lang = deps.strings[n.language] ? n.language : 'en';
    const t = translator(deps.strings[lang]!, deps.strings.en!);
    const { title, body } = renderNotification(n.kind, n.data, t, formatContextFor(lang, deps.strings[lang]!));
    for (const to of n.tokens) {
      messages.push({ to, title, body, sound: 'default', channelId: 'default', data: { loanId: n.data.loan_id, kind: n.kind } });
      owners.push(n.id);
    }
  }

  for (let i = 0; i < messages.length; i += CHUNK) {
    const chunk = messages.slice(i, i + CHUNK);
    let tickets: ExpoTicket[];
    try {
      tickets = await deps.sendToExpo(chunk);
    } catch (e) {
      chunk.forEach((_, j) => (failed[String(owners[i + j])] = `expo: ${e instanceof Error ? e.message : String(e)}`));
      continue;
    }
    tickets.forEach((ticket, j) => {
      const id = owners[i + j]!;
      if (ticket.status === 'ok') sent.add(id);
      else {
        if (ticket.details?.error === 'DeviceNotRegistered') deadTokens.push(chunk[j]!.to);
        failed[String(id)] = ticket.message;
      }
    });
  }
  // A notification counts as sent if it reached at least one of the person's phones.
  for (const id of sent) delete failed[String(id)];

  await deps.rpc('complete_notifications', { p_sent: [...sent], p_failed: failed, p_dead_tokens: deadTokens });
  return { sent: sent.size, failed: Object.keys(failed).length };
}
