// Edge Function: delete the calling user's account and all their data.
// The app calls it with the user's own access token:
//   supabase.functions.invoke('delete-account', { method: 'POST' })
import { deleteAccount, type DeleteDeps } from './handler.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const admin = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` };

async function ok(res: Response, what: string): Promise<Response> {
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status} ${await res.text()}`);
  return res;
}

const deps: DeleteDeps = {
  async createdLoanIds(userId) {
    const res = await ok(
      await fetch(`${SUPABASE_URL}/rest/v1/loans?select=id&creator_id=eq.${userId}`, { headers: admin }),
      'loans',
    );
    return ((await res.json()) as { id: string }[]).map((r) => r.id);
  },
  async listFiles(bucket, folder, offset, limit) {
    const res = await ok(
      await fetch(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
        method: 'POST',
        headers: { ...admin, 'content-type': 'application/json' },
        body: JSON.stringify({ prefix: `${folder}/`, limit, offset }),
      }),
      'list',
    );
    return ((await res.json()) as { name: string }[]).map((f) => f.name);
  },
  async removeFiles(bucket, paths) {
    await ok(
      await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}`, {
        method: 'DELETE',
        headers: { ...admin, 'content-type': 'application/json' },
        body: JSON.stringify({ prefixes: paths }),
      }),
      'remove',
    );
  },
  async deleteUser(userId) {
    await ok(await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: admin }), 'delete user');
  },
};

/** The user behind the request's access token, checked by Supabase Auth. */
async function callerId(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, authorization: auth } });
  if (!res.ok) return null;
  return ((await res.json()) as { id?: string }).id ?? null;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const userId = await callerId(req);
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  try {
    return Response.json(await deleteAccount(userId, deps));
  } catch (e) {
    console.error(e);
    return Response.json({ error: 'failed' }, { status: 500 });
  }
});
