// Supabase "Send SMS" auth hook: deliver the sign-in code through Telegram
// (Telegram Gateway API) instead of SMS. Cheap, and works for Iranian and Iraqi
// numbers alike. Pure logic here; index.ts wires it to Deno.serve.

export interface HookPayload {
  user: { phone?: string | null };
  sms: { otp: string };
}

const enc = new TextEncoder();

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

/** Constant-time string comparison. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify a Standard Webhooks signature, as Supabase signs auth hooks.
 * `secret` is what the dashboard shows: "v1,whsec_<base64>".
 */
export async function verifyHook(
  body: string,
  headers: Headers,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const id = headers.get('webhook-id');
  const ts = headers.get('webhook-timestamp');
  const sigHeader = headers.get('webhook-signature');
  if (!id || !ts || !sigHeader) return false;
  if (Math.abs(nowSeconds - Number(ts)) > 300) return false;
  const raw = secret.replace(/^v1,/, '').replace(/^whsec_/, '');
  const key = await crypto.subtle.importKey('raw', b64ToBytes(raw), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = bytesToB64(await crypto.subtle.sign('HMAC', key, enc.encode(`${id}.${ts}.${body}`)));
  return sigHeader.split(' ').some((part) => {
    const [version, sig] = part.split(',');
    return version === 'v1' && !!sig && same(sig, expected);
  });
}

/** Supabase stores phones without "+"; Telegram wants E.164. */
export function e164(phone: string): string {
  const digits = phone.replace(/[^\d]/g, '');
  return `+${digits}`;
}

export type SendResult = { ok: true } | { ok: false; status: number; message: string };

/** Ask Telegram to deliver our own code (so Supabase can verify it as usual). */
export async function sendViaTelegram(
  payload: HookPayload,
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<SendResult> {
  const phone = payload.user.phone;
  const code = payload.sms.otp;
  if (!phone || !/^\d{4,8}$/.test(code)) return { ok: false, status: 400, message: 'Missing phone or code.' };

  const res = await fetchFn('https://gatewayapi.telegram.org/sendVerificationMessage', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ phone_number: e164(phone), code, ttl: 600 }),
  });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (data?.ok) return { ok: true };
  // PHONE_NUMBER_NOT_FOUND etc.: tell the person the number has no Telegram.
  const error = data?.error ?? `HTTP ${res.status}`;
  return {
    ok: false,
    status: error.startsWith('PHONE_NUMBER') ? 400 : 502,
    message: error.startsWith('PHONE_NUMBER')
      ? 'This number has no Telegram account, so the code could not be sent.'
      : `Telegram Gateway: ${error}`,
  };
}
