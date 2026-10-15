// Edge Function: send queued push notifications.
// Called every minute by pg_cron (see README "Push notifications") with the
// header x-push-secret: <PUSH_CRON_SECRET>.
import strings from '../_shared/generated/strings.json' with { type: 'json' };

import { processQueue, type ExpoMessage, type ExpoTicket, type LocaleStrings } from './handler.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('PUSH_CRON_SECRET');
const EXPO_ACCESS_TOKEN = Deno.env.get('EXPO_ACCESS_TOKEN'); // optional, if push security is on in Expo

async function rpc(fn: string, args: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${fn}: HTTP ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function sendToExpo(messages: ExpoMessage[]): Promise<ExpoTicket[]> {
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${EXPO_ACCESS_TOKEN}` } : {}),
    },
    body: JSON.stringify(messages),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { data: ExpoTicket[] }).data;
}

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get('x-push-secret') !== CRON_SECRET) {
    return new Response('forbidden', { status: 403 });
  }
  try {
    const result = await processQueue({ rpc, sendToExpo, strings: strings as unknown as Record<string, LocaleStrings> });
    return Response.json(result);
  } catch (e) {
    console.error(e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
});
