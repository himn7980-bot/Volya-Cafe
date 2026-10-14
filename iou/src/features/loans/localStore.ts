// Local-first storage for loans: a SQLite copy of the server data plus an
// outbox of changes not yet sent. Screens read from here only, so the app
// works the same offline; the sync engine moves data in both directions.
//
// Written against a tiny SqlDb interface (a subset of expo-sqlite) so tests
// can run the real SQL on Node's built-in SQLite.

import {
  applyLoanEdit,
  diffPatch,
  type Loan,
  type LoanPatch,
  type LoanStatus,
  type LoanVersion,
} from '@/shared/loans';

export type SqlValue = string | number | null;

export interface SqlDb {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: SqlValue[]): Promise<{ changes: number }>;
  getAllAsync<T>(sql: string, ...params: SqlValue[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...params: SqlValue[]): Promise<T | null>;
}

export interface LocalLoan extends Loan {
  /** Changes waiting to be sent. */
  pending: boolean;
  /** Photo picked on this phone and not uploaded yet. */
  localPhotoUri: string | null;
}

export type OutboxOp =
  | { seq: number; loanId: string; kind: 'create'; payload: Loan; baseVersion: null; attempts: number }
  | { seq: number; loanId: string; kind: 'update'; payload: LoanPatch; baseVersion: number; attempts: number }
  | { seq: number; loanId: string; kind: 'photo'; payload: { localUri: string }; baseVersion: null; attempts: number };

// Bump when SCHEMA gains tables; every statement must be idempotent (IF NOT EXISTS).
const SCHEMA_VERSION = 2;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS loans (
  id TEXT PRIMARY KEY NOT NULL,
  creator_id TEXT NOT NULL,
  lender_id TEXT,
  borrower_id TEXT,
  counterparty_name TEXT NOT NULL,
  counterparty_phone TEXT,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  loan_date TEXT NOT NULL,
  due_date TEXT,
  photo_path TEXT,
  local_photo_uri TEXT,
  status TEXT NOT NULL,
  share_token TEXT,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS loans_loan_date_idx ON loans (loan_date);
CREATE TABLE IF NOT EXISTS outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  loan_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  base_version INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS outbox_loan_idx ON outbox (loan_id);
CREATE TABLE IF NOT EXISTS loan_versions (
  loan_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  changed_by TEXT,
  snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (loan_id, version)
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT);
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL,
  language TEXT NOT NULL,
  avatar_path TEXT
);
`;

/** Someone I share a record with (from my_counterparts()). */
export interface Person {
  id: string;
  displayName: string;
  language: string;
  avatarPath: string | null;
}

interface LoanRow {
  id: string;
  creator_id: string;
  lender_id: string | null;
  borrower_id: string | null;
  counterparty_name: string;
  counterparty_phone: string | null;
  amount_minor: number;
  currency: string;
  note: string;
  loan_date: string;
  due_date: string | null;
  photo_path: string | null;
  local_photo_uri: string | null;
  status: string;
  share_token: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  pending?: number;
}

const toLoan = (r: LoanRow): LocalLoan => ({
  id: r.id,
  creatorId: r.creator_id,
  lenderId: r.lender_id,
  borrowerId: r.borrower_id,
  counterpartyName: r.counterparty_name,
  counterpartyPhone: r.counterparty_phone,
  amountMinor: r.amount_minor,
  currency: r.currency,
  note: r.note,
  loanDate: r.loan_date,
  dueDate: r.due_date,
  photoPath: r.photo_path,
  status: r.status as LoanStatus,
  shareToken: r.share_token,
  version: r.version,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  pending: !!r.pending,
  localPhotoUri: r.local_photo_uri,
});

const loanParams = (l: Loan): SqlValue[] => [
  l.id,
  l.creatorId,
  l.lenderId,
  l.borrowerId,
  l.counterpartyName,
  l.counterpartyPhone,
  l.amountMinor,
  l.currency,
  l.note,
  l.loanDate,
  l.dueDate,
  l.photoPath,
  l.status,
  l.shareToken,
  l.version,
  l.createdAt,
  l.updatedAt,
];

const UPSERT_LOAN = `
INSERT INTO loans (id, creator_id, lender_id, borrower_id, counterparty_name, counterparty_phone,
  amount_minor, currency, note, loan_date, due_date, photo_path, status, share_token, version,
  created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (id) DO UPDATE SET
  creator_id = excluded.creator_id, lender_id = excluded.lender_id, borrower_id = excluded.borrower_id,
  counterparty_name = excluded.counterparty_name, counterparty_phone = excluded.counterparty_phone,
  amount_minor = excluded.amount_minor, currency = excluded.currency, note = excluded.note,
  loan_date = excluded.loan_date, due_date = excluded.due_date, photo_path = excluded.photo_path,
  status = excluded.status, share_token = excluded.share_token, version = excluded.version,
  created_at = excluded.created_at, updated_at = excluded.updated_at`;

const SELECT_LOANS = `
SELECT l.*, EXISTS (SELECT 1 FROM outbox o WHERE o.loan_id = l.id) AS pending FROM loans l`;

export class LocalStore {
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();

  constructor(private db: SqlDb) {}

  /** Run writes one at a time so read-modify-write sequences never interleave. */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async tx<T>(task: () => Promise<T>): Promise<T> {
    await this.db.execAsync('BEGIN');
    try {
      const result = await task();
      await this.db.execAsync('COMMIT');
      return result;
    } catch (e) {
      await this.db.execAsync('ROLLBACK');
      throw e;
    }
  }

  private write<T>(task: () => Promise<T>): Promise<T> {
    return this.serial(() => this.tx(task)).then((result) => {
      this.listeners.forEach((l) => l());
      return result;
    });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async migrate(): Promise<void> {
    const row = await this.db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    if ((row?.user_version ?? 0) >= SCHEMA_VERSION) return;
    await this.db.execAsync(SCHEMA);
    await this.db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }

  // ---------- Reads ----------

  async listLoans(): Promise<LocalLoan[]> {
    const rows = await this.db.getAllAsync<LoanRow>(`${SELECT_LOANS} ORDER BY l.loan_date DESC, l.created_at DESC`);
    return rows.map(toLoan);
  }

  async getLoan(id: string): Promise<LocalLoan | null> {
    const row = await this.db.getFirstAsync<LoanRow>(`${SELECT_LOANS} WHERE l.id = ?`, id);
    return row ? toLoan(row) : null;
  }

  async pendingOps(): Promise<OutboxOp[]> {
    const rows = await this.db.getAllAsync<{
      seq: number;
      loan_id: string;
      kind: OutboxOp['kind'];
      payload: string;
      base_version: number | null;
      attempts: number;
    }>('SELECT seq, loan_id, kind, payload, base_version, attempts FROM outbox ORDER BY seq');
    return rows.map(
      (r) =>
        ({
          seq: r.seq,
          loanId: r.loan_id,
          kind: r.kind,
          payload: JSON.parse(r.payload),
          baseVersion: r.base_version,
          attempts: r.attempts,
        }) as OutboxOp,
    );
  }

  async pendingCount(): Promise<number> {
    const row = await this.db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM outbox');
    return row?.n ?? 0;
  }

  async listVersions(loanId: string): Promise<LoanVersion[]> {
    const rows = await this.db.getAllAsync<{ loan_id: string; version: number; changed_by: string | null; snapshot: string; created_at: string }>(
      'SELECT * FROM loan_versions WHERE loan_id = ? ORDER BY version',
      loanId,
    );
    return rows.map((r) => ({
      loanId: r.loan_id,
      version: r.version,
      changedBy: r.changed_by,
      snapshot: JSON.parse(r.snapshot),
      createdAt: r.created_at,
    }));
  }

  async listPeople(): Promise<Person[]> {
    const rows = await this.db.getAllAsync<{ id: string; display_name: string; language: string; avatar_path: string | null }>(
      'SELECT * FROM people',
    );
    return rows.map((r) => ({ id: r.id, displayName: r.display_name, language: r.language, avatarPath: r.avatar_path }));
  }

  /** Replace the list of people (the server list is always complete). */
  savePeople(people: Person[]): Promise<void> {
    return this.write(async () => {
      await this.db.runAsync('DELETE FROM people');
      for (const p of people) {
        await this.db.runAsync(
          'INSERT INTO people (id, display_name, language, avatar_path) VALUES (?, ?, ?, ?)',
          p.id,
          p.displayName,
          p.language,
          p.avatarPath,
        );
      }
    });
  }

  async getMeta(key: string): Promise<string | null> {
    const row = await this.db.getFirstAsync<{ value: string | null }>('SELECT value FROM meta WHERE key = ?', key);
    return row?.value ?? null;
  }

  // ---------- Local changes (from the UI) ----------

  /** Save a new loan locally and queue it for upload. */
  createLoan(loan: Loan): Promise<void> {
    return this.write(async () => {
      await this.db.runAsync(UPSERT_LOAN, ...loanParams(loan));
      await this.enqueue(loan.id, 'create', loan, null);
    });
  }

  /**
   * Edit a loan locally and queue the change. Changes to a loan that has not
   * reached the server yet are folded into its pending "create"; repeated
   * edits are merged into one pending update, so the server sees one change
   * per sync and version checks stay meaningful.
   */
  editLoan(id: string, patch: LoanPatch): Promise<LocalLoan | null> {
    return this.write(async () => {
      const current = await this.getLoan(id);
      if (!current) throw new Error(`unknown loan ${id}`);
      const changes = diffPatch(current, patch);
      if (Object.keys(changes).length === 0) return current;
      const ops = (await this.pendingOps()).filter((o) => o.loanId === id);
      const create = ops.find((o) => o.kind === 'create');

      if (create && changes.status === 'cancelled') {
        // Never left this phone: nobody else has seen it, so just forget it.
        await this.db.runAsync('DELETE FROM outbox WHERE loan_id = ?', id);
        await this.db.runAsync('DELETE FROM loans WHERE id = ?', id);
        return null;
      }

      const next = applyLoanEdit(current, changes);
      await this.db.runAsync(UPSERT_LOAN, ...loanParams(next));

      if (create) {
        await this.db.runAsync('UPDATE outbox SET payload = ? WHERE seq = ?', JSON.stringify({ ...create.payload, ...changes, status: 'pending' }), create.seq);
      } else {
        const update = ops.find((o) => o.kind === 'update');
        if (update) {
          await this.db.runAsync('UPDATE outbox SET payload = ? WHERE seq = ?', JSON.stringify({ ...update.payload, ...changes }), update.seq);
        } else {
          await this.enqueue(id, 'update', changes, current.version);
        }
      }
      return { ...next, pending: true, localPhotoUri: current.localPhotoUri };
    });
  }

  /** Attach a photo saved on this phone; it is uploaded on the next sync. */
  setPhoto(id: string, localUri: string): Promise<void> {
    return this.write(async () => {
      await this.db.runAsync("DELETE FROM outbox WHERE loan_id = ? AND kind = 'photo'", id);
      await this.db.runAsync('UPDATE loans SET local_photo_uri = ? WHERE id = ?', localUri, id);
      await this.enqueue(id, 'photo', { localUri }, null);
    });
  }

  /** Drop a photo that was not uploaded yet. Returns true if there was one. */
  discardLocalPhoto(id: string): Promise<boolean> {
    return this.write(async () => {
      const r = await this.db.runAsync("DELETE FROM outbox WHERE loan_id = ? AND kind = 'photo'", id);
      await this.db.runAsync('UPDATE loans SET local_photo_uri = NULL WHERE id = ?', id);
      return r.changes > 0;
    });
  }

  private async enqueue(loanId: string, kind: OutboxOp['kind'], payload: unknown, baseVersion: number | null) {
    await this.db.runAsync(
      'INSERT INTO outbox (loan_id, kind, payload, base_version, created_at) VALUES (?, ?, ?, ?, ?)',
      loanId,
      kind,
      JSON.stringify(payload),
      baseVersion,
      new Date().toISOString(),
    );
  }

  // ---------- Sync bookkeeping ----------

  /** An op reached the server: drop it and store the server's copy of the loan. */
  completeOp(seq: number, serverLoan: Loan | null): Promise<void> {
    return this.write(async () => {
      const op = await this.db.getFirstAsync<{ loan_id: string; kind: string }>('SELECT loan_id, kind FROM outbox WHERE seq = ?', seq);
      await this.db.runAsync('DELETE FROM outbox WHERE seq = ?', seq);
      if (!op || !serverLoan) return;
      if (op.kind === 'photo') await this.db.runAsync('UPDATE loans SET local_photo_uri = NULL WHERE id = ?', op.loan_id);
      const remaining = await this.db.getFirstAsync<{ n: number }>(
        "SELECT COUNT(*) AS n FROM outbox WHERE loan_id = ? AND kind <> 'photo'",
        op.loan_id,
      );
      if ((remaining?.n ?? 0) === 0) await this.db.runAsync(UPSERT_LOAN, ...loanParams(serverLoan));
    });
  }

  failOp(seq: number, error: string): Promise<void> {
    return this.write(async () => {
      await this.db.runAsync('UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE seq = ?', error, seq);
    });
  }

  /** Point a pending update at a newer server version (after a version conflict). */
  rebaseOp(seq: number, baseVersion: number): Promise<void> {
    return this.write(async () => {
      await this.db.runAsync('UPDATE outbox SET base_version = ? WHERE seq = ?', baseVersion, seq);
    });
  }

  /** The server refused a change for good: forget it and show the server's version. */
  rejectOp(seq: number, serverLoan: Loan | null): Promise<void> {
    return this.write(async () => {
      const op = await this.db.getFirstAsync<{ loan_id: string }>('SELECT loan_id FROM outbox WHERE seq = ?', seq);
      await this.db.runAsync('DELETE FROM outbox WHERE seq = ?', seq);
      if (!op) return;
      if (serverLoan) await this.db.runAsync(UPSERT_LOAN, ...loanParams(serverLoan));
      else {
        const left = await this.db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM outbox WHERE loan_id = ?', op.loan_id);
        if (!left?.n) await this.db.runAsync('DELETE FROM loans WHERE id = ?', op.loan_id);
      }
    });
  }

  /** Store loans fetched from the server, except ones with local changes still pending. */
  applyServerLoans(loans: Loan[]): Promise<number> {
    if (loans.length === 0) return Promise.resolve(0);
    return this.write(async () => {
      let applied = 0;
      for (const loan of loans) {
        const pending = await this.db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM outbox WHERE loan_id = ?', loan.id);
        if (pending?.n) continue;
        const local = await this.db.getFirstAsync<{ version: number }>('SELECT version FROM loans WHERE id = ?', loan.id);
        if (local && local.version > loan.version) continue;
        await this.db.runAsync(UPSERT_LOAN, ...loanParams(loan));
        applied += 1;
      }
      return applied;
    });
  }

  saveVersions(versions: LoanVersion[]): Promise<void> {
    if (versions.length === 0) return Promise.resolve();
    return this.write(async () => {
      for (const v of versions) {
        await this.db.runAsync(
          'INSERT OR REPLACE INTO loan_versions (loan_id, version, changed_by, snapshot, created_at) VALUES (?, ?, ?, ?, ?)',
          v.loanId,
          v.version,
          v.changedBy,
          JSON.stringify(v.snapshot),
          v.createdAt,
        );
      }
    });
  }

  setMeta(key: string, value: string | null): Promise<void> {
    return this.write(async () => {
      await this.db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', key, value);
    });
  }

  /** Forget everything (sign-out, or a different account on this phone). */
  clearAll(): Promise<void> {
    return this.write(async () => {
      await this.db.execAsync('DELETE FROM loans; DELETE FROM outbox; DELETE FROM loan_versions; DELETE FROM meta; DELETE FROM people;');
    });
  }
}
