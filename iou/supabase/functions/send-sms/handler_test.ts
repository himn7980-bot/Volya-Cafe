import { assert, assertEquals } from 'jsr:@std/assert@1';

import { e164, sendViaTelegram, verifyHook } from './handler.ts';

const secretBytes = new TextEncoder().encode('0123456789abcdef0123456789abcdef');
const secret = `v1,whsec_${btoa(String.fromCharCode(...secretBytes))}`;

async function sign(body: string, id: string, ts: number) {
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${body}`));
  return `v1,${btoa(String.fromCharCode(...new Uint8Array(sig)))}`;
}

Deno.test('accepts a correctly signed hook and rejects tampering or old requests', async () => {
  const body = '{"user":{"phone":"9647701234567"},"sms":{"otp":"123456"}}';
  const now = 1_800_000_000;
  const headers = new Headers({ 'webhook-id': 'msg_1', 'webhook-timestamp': String(now), 'webhook-signature': await sign(body, 'msg_1', now) });
  assert(await verifyHook(body, headers, secret, now));
  assert(!(await verifyHook(body.replace('123456', '000000'), headers, secret, now)));
  assert(!(await verifyHook(body, headers, secret, now + 1000)));
});

Deno.test('formats phones for Telegram', () => {
  assertEquals(e164('9647701234567'), '+9647701234567');
  assertEquals(e164('+98 912 123 4567'), '+989121234567');
});

Deno.test('sends our own code and explains numbers without Telegram', async () => {
  let sent: Record<string, unknown> = {};
  const ok = await sendViaTelegram({ user: { phone: '989121234567' }, sms: { otp: '482913' } }, 'tok', async (_u, init) => {
    sent = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ ok: true, result: {} }));
  });
  assertEquals(ok, { ok: true });
  assertEquals(sent.phone_number, '+989121234567');
  assertEquals(sent.code, '482913');

  const no = await sendViaTelegram({ user: { phone: '9647701234567' }, sms: { otp: '482913' } }, 'tok', async () =>
    new Response(JSON.stringify({ ok: false, error: 'PHONE_NUMBER_NOT_FOUND' })),
  );
  assertEquals(no.ok, false);
  if (!no.ok) assertEquals(no.status, 400);
});
