// deno test supabase/functions/delete-account/handler_test.ts
import { assertEquals, assertRejects } from 'jsr:@std/assert@1';

import { deleteAccount, type DeleteDeps } from './handler.ts';

const UID = '11111111-2222-4333-8444-555555555555';

function fakeStorage(files: Record<string, string[]>, loans: string[]) {
  const log: string[] = [];
  const store = new Map(Object.entries(files).map(([k, v]) => [k, [...v]]));
  const deps: DeleteDeps = {
    createdLoanIds: async () => loans,
    listFiles: async (bucket, folder, offset, limit) => (store.get(`${bucket}:${folder}`) ?? []).slice(offset, offset + limit),
    removeFiles: async (bucket, paths) => {
      log.push(`rm ${bucket} ${paths.length}`);
      for (const p of paths) {
        const [folder, name] = p.split('/');
        const key = `${bucket}:${folder}`;
        store.set(key, (store.get(key) ?? []).filter((n) => n !== name));
      }
    },
    deleteUser: async (id) => {
      log.push(`delete ${id}`);
    },
  };
  return { deps, log, store };
}

Deno.test('removes the avatar and the photos of every record, then the user', async () => {
  const { deps, log, store } = fakeStorage(
    { [`avatars:${UID}`]: ['a.jpg'], 'loan-photos:l1': ['p1.jpg', 'p2.jpg'], 'loan-photos:other': ['keep.jpg'] },
    ['l1', 'l2'],
  );
  const result = await deleteAccount(UID, deps);
  assertEquals(result, { files: 3 });
  assertEquals(log, ['rm avatars 1', 'rm loan-photos 2', `delete ${UID}`]);
  assertEquals(store.get('loan-photos:other'), ['keep.jpg']);
});

Deno.test('pages through large folders', async () => {
  const many = Array.from({ length: 250 }, (_, i) => `f${i}.jpg`);
  const { deps, log } = fakeStorage({ [`avatars:${UID}`]: many }, []);
  assertEquals(await deleteAccount(UID, deps), { files: 250 });
  assertEquals(log, ['rm avatars 100', 'rm avatars 100', 'rm avatars 50', `delete ${UID}`]);
});

Deno.test('keeps the user when removing files fails, so it can be retried', async () => {
  const { deps, log } = fakeStorage({ [`avatars:${UID}`]: ['a.jpg'] }, []);
  deps.removeFiles = () => Promise.reject(new Error('storage down'));
  await assertRejects(() => deleteAccount(UID, deps), Error, 'storage down');
  assertEquals(log, []);
});

Deno.test('rejects anything that is not a user id', async () => {
  const { deps } = fakeStorage({}, []);
  await assertRejects(() => deleteAccount('../etc', deps), Error, 'bad user id');
});
