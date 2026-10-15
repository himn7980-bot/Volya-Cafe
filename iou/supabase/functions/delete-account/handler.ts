// Deleting an account and everything in it (Settings > Delete account).
// Pure logic with injected I/O so it is unit-tested (handler_test.ts).
//
// Order matters: files first (Storage keeps them even when the database rows
// are gone), then the auth user. Removing the auth user cascades in the
// database: profile, records this person wrote, their history, repayments,
// push tokens and queued notifications. Records the other side wrote stay for
// them, without the link to this person.

export interface DeleteDeps {
  /** Ids of the records this person wrote (their photos live under "<loan id>/"). */
  createdLoanIds(userId: string): Promise<string[]>;
  /** File names directly inside `folder` (no trailing slash), one page at a time. */
  listFiles(bucket: string, folder: string, offset: number, limit: number): Promise<string[]>;
  removeFiles(bucket: string, paths: string[]): Promise<void>;
  deleteUser(userId: string): Promise<void>;
}

const PAGE = 100;

async function removeFolder(deps: DeleteDeps, bucket: string, folder: string): Promise<number> {
  let removed = 0;
  // Always read the first page: removing shifts the rest forward.
  for (;;) {
    const names = await deps.listFiles(bucket, folder, 0, PAGE);
    if (names.length === 0) return removed;
    await deps.removeFiles(bucket, names.map((n) => `${folder}/${n}`));
    removed += names.length;
    if (names.length < PAGE) return removed;
  }
}

export async function deleteAccount(userId: string, deps: DeleteDeps): Promise<{ files: number }> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error('bad user id');
  let files = await removeFolder(deps, 'avatars', userId);
  for (const loanId of await deps.createdLoanIds(userId)) {
    files += await removeFolder(deps, 'loan-photos', loanId);
  }
  await deps.deleteUser(userId);
  return { files };
}
