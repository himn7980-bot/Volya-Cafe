// Two-way sync between the local store and the server. Pure logic: the server
// side is behind the Remote interface so this is tested without a network.
//
// Push: outbox ops are sent in order. A network error stops the push (later
// ops may depend on earlier ones) and leaves everything queued. If the server
// copy moved on since the edit (version conflict), the edit is re-applied on
// top of the latest version: the fields the person changed win, everything
// else keeps the server's value, and the server's rules still apply (e.g. an
// edit after confirmation goes back to "pending"). If the server refuses a
// change for good (e.g. the loan was settled meanwhile), the change is dropped
// and the server's version is shown.
//
// Pull: loans changed since the last pull (with a small overlap, because
// server timestamps are transaction start times) replace local copies that
// have no pending changes.

import type { Loan, LoanPatch, LoanVersion } from '@/shared/loans';

import type { LocalStore } from './localStore';

export type RemoteErrorKind = 'network' | 'rejected' | 'server';

export class RemoteError extends Error {
  constructor(
    message: string,
    public kind: RemoteErrorKind,
  ) {
    super(message);
    this.name = 'RemoteError';
  }
}

export interface Remote {
  /** Insert; inserting the same id twice returns the existing row. */
  insertLoan(loan: Loan): Promise<Loan>;
  /** Update; with a base version, returns 'conflict' when the server version differs. */
  updateLoan(id: string, patch: LoanPatch, baseVersion: number | null): Promise<Loan | 'conflict'>;
  uploadPhoto(loanId: string, localUri: string): Promise<string>;
  fetchLoan(id: string): Promise<Loan | null>;
  fetchLoansSince(since: string | null): Promise<Loan[]>;
  fetchVersions(loanId: string): Promise<LoanVersion[]>;
}

export interface SyncResult {
  pushed: number;
  rejected: number;
  pulled: number;
  /** Stopped early because the server could not be reached. */
  offline: boolean;
}

export const PULL_CURSOR = 'loans.pullCursor';
const PULL_OVERLAP_MS = 2 * 60_000;
/** Server errors (not network) are retried this many times before giving up on a change. */
export const MAX_ATTEMPTS = 8;

export async function runSync(store: LocalStore, remote: Remote): Promise<SyncResult> {
  const result: SyncResult = { pushed: 0, rejected: 0, pulled: 0, offline: false };

  for (const op of await store.pendingOps()) {
    try {
      let row: Loan;
      if (op.kind === 'create') {
        row = await remote.insertLoan(op.payload);
      } else if (op.kind === 'update') {
        let res = await remote.updateLoan(op.loanId, op.payload, op.baseVersion);
        if (res === 'conflict') {
          const latest = await remote.fetchLoan(op.loanId);
          if (!latest) throw new RemoteError('loan no longer visible', 'rejected');
          await store.rebaseOp(op.seq, latest.version);
          res = await remote.updateLoan(op.loanId, op.payload, latest.version);
          if (res === 'conflict') throw new RemoteError('loan keeps changing', 'server');
        }
        row = res;
      } else {
        const path = await remote.uploadPhoto(op.loanId, op.payload.localUri);
        const res = await remote.updateLoan(op.loanId, { photoPath: path }, null);
        if (res === 'conflict') throw new RemoteError('loan not found', 'rejected');
        row = res;
      }
      await store.completeOp(op.seq, row);
      result.pushed += 1;
    } catch (e) {
      const err = e instanceof RemoteError ? e : new RemoteError(String(e), 'server');
      if (err.kind === 'network') {
        result.offline = true;
        return result;
      }
      if (err.kind === 'rejected' || op.attempts + 1 >= MAX_ATTEMPTS) {
        const latest = await remote.fetchLoan(op.loanId).catch(() => null);
        await store.rejectOp(op.seq, latest);
        result.rejected += 1;
        continue;
      }
      await store.failOp(op.seq, err.message);
      // Keep order: later changes may build on this one.
      return result;
    }
  }

  try {
    const cursor = await store.getMeta(PULL_CURSOR);
    const since = cursor ? new Date(Date.parse(cursor) - PULL_OVERLAP_MS).toISOString() : null;
    const rows = await remote.fetchLoansSince(since);
    result.pulled = await store.applyServerLoans(rows);
    const newest = rows.reduce<string | null>((max, r) => (max === null || r.updatedAt > max ? r.updatedAt : max), cursor);
    if (newest && newest !== cursor) await store.setMeta(PULL_CURSOR, newest);
  } catch (e) {
    if (e instanceof RemoteError && e.kind === 'network') result.offline = true;
    else throw e;
  }
  return result;
}
