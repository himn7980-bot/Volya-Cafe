// deno test supabase/functions/push/handler_test.ts
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';

import strings from '../_shared/generated/strings.json' with { type: 'json' };
import { processQueue, type ExpoMessage, type ExpoTicket, type LocaleStrings, type QueuedNotification } from './handler.ts';

const S = strings as unknown as Record<string, LocaleStrings>;

function fakeDeps(batch: QueuedNotification[], tickets: (m: ExpoMessage) => ExpoTicket) {
  const sentMessages: ExpoMessage[] = [];
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  return {
    sentMessages,
    calls,
    deps: {
      strings: S,
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return fn === 'claim_notifications' ? batch : null;
      },
      sendToExpo: async (messages: ExpoMessage[]) => {
        sentMessages.push(...messages);
        return messages.map(tickets);
      },
    },
  };
}

const data = { loan_id: 'L1', name: 'Ali', amount_minor: 5000000, currency: 'IRR', remaining_minor: 3000000, repayment_minor: 2000000 };

Deno.test('sends each notification to every phone, in the recipient language', async () => {
  const { deps, sentMessages, calls } = fakeDeps(
    [
      { id: 1, kind: 'repayment_confirmed', data, language: 'fa', tokens: ['ExponentPushToken[a]', 'ExponentPushToken[b]'] },
      { id: 2, kind: 'settled', data: { ...data, currency: 'USD', amount_minor: 2000 }, language: 'en', tokens: ['ExponentPushToken[c]'] },
      { id: 3, kind: 'loan_confirmed', data, language: 'xx', tokens: [] },
    ],
    () => ({ status: 'ok' }),
  );
  const result = await processQueue(deps);
  assertEquals(result, { sent: 3, failed: 0 });
  assertEquals(sentMessages.length, 3);
  assertStringIncludes(sentMessages[0]!.body, '۲۰۰٬۰۰۰ تومان');
  assertStringIncludes(sentMessages[2]!.title, 'All settled with');
  assertStringIncludes(sentMessages[2]!.body, '$20');
  assertEquals(sentMessages[0]!.data, { loanId: 'L1', kind: 'repayment_confirmed' });
  const done = calls.find((c) => c.fn === 'complete_notifications')!;
  assertEquals((done.args.p_sent as number[]).sort(), [1, 2, 3]);
});

Deno.test('removes phones that uninstalled the app and reports failures', async () => {
  const { deps, calls } = fakeDeps(
    [
      { id: 7, kind: 'reminder', data: { ...data, tone: 'firm', greet_name: 'Sara', loan_date: '2026-10-01' }, language: 'tr', tokens: ['ExponentPushToken[gone]'] },
      { id: 8, kind: 'due_today', data: { ...data, borrower_has_app: false }, language: 'en', tokens: ['ExponentPushToken[ok]', 'ExponentPushToken[gone2]'] },
    ],
    (m) => (m.to.includes('gone')
      ? { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } }
      : { status: 'ok' }),
  );
  const result = await processQueue(deps);
  assertEquals(result, { sent: 1, failed: 1 });
  const done = calls.find((c) => c.fn === 'complete_notifications')!;
  assertEquals(done.args.p_sent, [8]);
  assertEquals(Object.keys(done.args.p_failed as Record<string, string>), ['7']);
  assertEquals(done.args.p_dead_tokens, ['ExponentPushToken[gone]', 'ExponentPushToken[gone2]']);
});

Deno.test('an Expo outage leaves notifications to be retried', async () => {
  const { deps, calls } = fakeDeps([{ id: 9, kind: 'settled', data, language: 'en', tokens: ['ExponentPushToken[a]'] }], () => ({ status: 'ok' }));
  deps.sendToExpo = () => Promise.reject(new Error('503'));
  const result = await processQueue(deps);
  assertEquals(result, { sent: 0, failed: 1 });
  assertEquals(calls.at(-1)!.args.p_sent, []);
});

Deno.test('does nothing when the queue is empty', async () => {
  const { deps, calls } = fakeDeps([], () => ({ status: 'ok' }));
  assertEquals(await processQueue(deps), { sent: 0, failed: 0 });
  assertEquals(calls.length, 1);
});
