// Test doubles: the real LocalStore SQL on Node's built-in SQLite, and an
// in-memory server that applies the same rules as the database triggers.
import { balanceOf, initialRepaymentStatus } from '@/shared/balance';
import { applyLoanEdit, diffPatch, isClosed, type Loan, type LoanPatch, type LoanVersion, type Repayment } from '@/shared/loans';

import { LocalStore, type Person, type SqlDb, type SqlValue } from '../localStore';
import { RemoteError, type Remote } from '../syncEngine';

type NodeSqlite = {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): { run(...p: SqlValue[]): { changes: number | bigint }; all(...p: SqlValue[]): unknown[]; get(...p: SqlValue[]): unknown };
  };
};

export function memoryDb(): SqlDb {
  // getBuiltinModule bypasses Jest's module resolver, which doesn't know node:sqlite.
  const { DatabaseSync } = (process as unknown as { getBuiltinModule(n: string): NodeSqlite }).getBuiltinModule('node:sqlite');
  const db = new DatabaseSync(':memory:');
  const plain = <T>(row: unknown) => (row ? ({ ...(row as object) } as T) : null);
  return {
    execAsync: async (sql) => db.exec(sql),
    runAsync: async (sql, ...p) => ({ changes: Number(db.prepare(sql).run(...p).changes) }),
    getAllAsync: async <T>(sql: string, ...p: SqlValue[]) => db.prepare(sql).all(...p).map((r) => plain<T>(r)!),
    getFirstAsync: async <T>(sql: string, ...p: SqlValue[]) => plain<T>(db.prepare(sql).get(...p)),
  };
}

export async function newStore() {
  const store = new LocalStore(memoryDb());
  await store.migrate();
  return store;
}

export const ME = 'user-me';

let n = 0;
let rn = 0;
export function makeRepayment(loanId: string, over: Partial<Repayment> = {}): Repayment {
  rn += 1;
  return {
    id: `rep-${rn}`,
    loanId,
    amountMinor: 100,
    paidOn: '2026-10-10',
    note: '',
    createdBy: ME,
    status: 'pending',
    respondedBy: null,
    responseComment: null,
    createdAt: '2026-10-10T10:00:00.000Z',
    updatedAt: '2026-10-10T10:00:00.000Z',
    ...over,
  };
}

export function makeLoan(over: Partial<Loan> = {}): Loan {
  n += 1;
  return {
    id: `loan-${n}`,
    creatorId: ME,
    lenderId: ME,
    borrowerId: null,
    counterpartyName: 'Sara',
    counterpartyPhone: null,
    amountMinor: 1000,
    currency: 'USD',
    note: '',
    loanDate: '2026-10-01',
    dueDate: null,
    photoPath: null,
    autoRemind: false,
    status: 'pending',
    shareToken: null,
    version: 1,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...over,
  };
}

/** A fake server that behaves like the Postgres triggers for the parts sync relies on. */
export class FakeRemote implements Remote {
  loans = new Map<string, Loan>();
  versions: LoanVersion[] = [];
  online = true;
  failNext: RemoteError | null = null;
  calls: string[] = [];
  private clock = Date.parse('2026-10-15T00:00:00.000Z');

  private tick() {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  private guard(call: string) {
    this.calls.push(call);
    if (!this.online) throw new RemoteError('offline', 'network');
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
  }

  private record(loan: Loan) {
    this.versions.push({ loanId: loan.id, version: loan.version, changedBy: loan.creatorId, snapshot: { amount_minor: loan.amountMinor }, createdAt: loan.updatedAt });
  }

  /** Simulates the other person (or another phone) changing the loan. */
  serverEdit(id: string, change: Partial<Loan>) {
    const cur = this.loans.get(id)!;
    const next = { ...cur, ...change, version: cur.version + 1, updatedAt: this.tick() };
    this.loans.set(id, next);
    this.record(next);
  }

  async insertLoan(loan: Loan) {
    this.guard(`insert ${loan.id}`);
    const existing = this.loans.get(loan.id);
    if (existing) return existing;
    const at = this.tick();
    const row: Loan = { ...loan, status: 'pending', version: 1, shareToken: `token-${loan.id}`, createdAt: at, updatedAt: at };
    this.loans.set(loan.id, row);
    this.record(row);
    return row;
  }

  async updateLoan(id: string, patch: LoanPatch, baseVersion: number | null) {
    this.guard(`update ${id} @${baseVersion ?? '-'}`);
    const cur = this.loans.get(id);
    if (!cur || (baseVersion !== null && cur.version !== baseVersion)) return 'conflict' as const;
    if (isClosed(cur.status)) throw new RemoteError('this loan is closed', 'rejected');
    const changes = diffPatch(cur, patch);
    if (Object.keys(changes).length === 0) return cur;
    const next = { ...applyLoanEdit(cur, changes), version: cur.version + 1, updatedAt: this.tick() };
    this.loans.set(id, next);
    this.record(next);
    return next;
  }

  async uploadPhoto(loanId: string, localUri: string) {
    this.guard(`upload ${loanId}`);
    return `${loanId}/${localUri.split('/').pop()}`;
  }

  async fetchLoan(id: string) {
    this.guard(`fetch ${id}`);
    return this.loans.get(id) ?? null;
  }

  async fetchLoansSince(since: string | null) {
    this.guard(`pull ${since ?? 'all'}`);
    return [...this.loans.values()].filter((l) => !since || l.updatedAt >= since).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  }

  people: Person[] = [];
  repayments = new Map<string, Repayment>();
  /** Who the fake server thinks is signed in (decides a new repayment's status). */
  me = ME;

  async insertRepayment(r: Repayment) {
    this.guard(`repay ${r.id}`);
    const existing = this.repayments.get(r.id);
    if (existing) return existing;
    const loan = this.loans.get(r.loanId);
    if (!loan || loan.status !== 'confirmed') throw new RemoteError('not confirmed', 'rejected');
    const b = balanceOf(loan.amountMinor, [...this.repayments.values()].filter((x) => x.loanId === loan.id));
    if (r.amountMinor > b.maxNewRepayment) throw new RemoteError('too much', 'rejected');
    const at = this.tick();
    const row: Repayment = { ...r, createdBy: this.me, status: initialRepaymentStatus(this.me, loan.lenderId), createdAt: at, updatedAt: at };
    this.repayments.set(r.id, row);
    this.settleIfRepaid(loan.id);
    return row;
  }

  /** The lender answers on the server side. */
  serverAnswerRepayment(id: string, status: 'confirmed' | 'disputed') {
    const r = this.repayments.get(id)!;
    this.repayments.set(id, { ...r, status, updatedAt: this.tick() });
    this.settleIfRepaid(r.loanId);
  }

  private settleIfRepaid(loanId: string) {
    const loan = this.loans.get(loanId)!;
    const b = balanceOf(loan.amountMinor, [...this.repayments.values()].filter((x) => x.loanId === loanId));
    if (b.remaining === 0 && loan.status === 'confirmed') this.serverEdit(loanId, { status: 'settled' });
  }

  async cancelRepayment(id: string) {
    this.guard(`cancel-repayment ${id}`);
    const r = this.repayments.get(id);
    if (!r || r.status !== 'pending') throw new RemoteError('not pending', 'rejected');
    const row = { ...r, status: 'cancelled' as const, updatedAt: this.tick() };
    this.repayments.set(id, row);
    return row;
  }

  async fetchRepayment(id: string) {
    this.guard(`fetch-repayment ${id}`);
    return this.repayments.get(id) ?? null;
  }

  async fetchRepaymentsSince(since: string | null) {
    this.guard(`pull-repayments ${since ?? 'all'}`);
    return [...this.repayments.values()].filter((r) => !since || r.updatedAt >= since);
  }

  async fetchPeople() {
    this.guard('people');
    return this.people;
  }

  async fetchVersions(loanId: string) {
    this.guard(`versions ${loanId}`);
    return this.versions.filter((v) => v.loanId === loanId);
  }
}
