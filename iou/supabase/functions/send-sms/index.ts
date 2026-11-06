// Edge Function: Supabase "Send SMS" auth hook -> code delivered in Telegram.
// Secrets (Supabase dashboard -> Edge Functions -> Secrets):
//   TELEGRAM_GATEWAY_TOKEN  from gateway.telegram.org -> API
//   SEND_SMS_HOOK_SECRET    from Authentication -> Hooks -> Send SMS hook ("v1,whsec_...")
import { sendViaTelegram, verifyHook, type HookPayload } from './handler.ts';

const TOKEN = Deno.env.get('TELEGRAM_GATEWAY_TOKEN');
const HOOK_SECRET = Deno.env.get('SEND_SMS_HOOK_SECRET');

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { error: { http_code: 405, message: 'POST only' } });
  if (!TOKEN || !HOOK_SECRET) return reply(500, { error: { http_code: 500, message: 'The code service is not configured.' } });

  const body = await req.text();
  if (!(await verifyHook(body, req.headers, HOOK_SECRET))) {
    return reply(401, { error: { http_code: 401, message: 'Bad signature' } });
  }
  const result = await sendViaTelegram(JSON.parse(body) as HookPayload, TOKEN);
  return result.ok ? reply(200, {}) : reply(result.status, { error: { http_code: result.status, message: result.message } });
});
