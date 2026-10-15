// Loan domain logic shared by the app (and later the web page). Pure TS.
// The database enforces the same rules; mirroring them here lets the app show
// the right state immediately, even offline.

export type LoanStatus = 'pending' | 'confirmed' | 'disputed' | 'settled' | 'cancelled';
export type Direction = 'lent' | 'borrowed';

export interface Loan {
  id: string;
  creatorId: string;
  lenderId: string | null;
  borrowerId: string | null;
  counterpartyName: string;
  counterpartyPhone: string | null;
  amountMinor: number;
  currency: string;
  note: string;
  loanDate: string; // ISO date
  dueDate: string | null;
  photoPath: string | null;
  /** Send a gentle reminder automatically on the due date. */
  autoRemind: boolean;
  status: LoanStatus;
  shareToken: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Fields the creator may edit. */
export interface LoanPatch {
  counterpartyName?: string;
  counterpartyPhone?: string | null;
  amountMinor?: number;
  currency?: string;
  note?: string;
  loanDate?: string;
  dueDate?: string | null;
  photoPath?: string | null;
  autoRemind?: boolean;
  status?: 'cancelled';
}

/** Changing any of these after confirmation means the other person must confirm again. */
export const TERM_FIELDS = ['amountMinor', 'currency', 'note', 'loanDate', 'dueDate', 'photoPath'] as const;

export const isClosed = (status: LoanStatus) => status === 'settled' || status === 'cancelled';

export function changesTerms(loan: Loan, patch: LoanPatch): boolean {
  return TERM_FIELDS.some((f) => f in patch && patch[f] !== loan[f]);
}

/** Apply an edit the way the server will (see loans_before_update). */
export function applyLoanEdit(loan: Loan, patch: LoanPatch): Loan {
  if (isClosed(loan.status)) throw new Error('loan is closed');
  const next: Loan = { ...loan, ...patch };
  if (patch.counterpartyName !== undefined) next.counterpartyName = patch.counterpartyName.trim();
  if (patch.status !== 'cancelled' && changesTerms(loan, patch) && (loan.status === 'confirmed' || loan.status === 'disputed')) {
    next.status = 'pending';
  }
  return next;
}

/** The other party of a loan from `userId`'s point of view (null while they have no account). */
export function otherPartyId(loan: Pick<Loan, 'creatorId' | 'lenderId' | 'borrowerId'>, userId: string): string | null {
  if (loan.lenderId === userId) return loan.borrowerId;
  if (loan.borrowerId === userId) return loan.lenderId;
  return loan.creatorId;
}

/** Only the fields that actually differ. */
export function diffPatch(loan: Loan, patch: LoanPatch): LoanPatch {
  const out: LoanPatch = {};
  for (const key of Object.keys(patch) as (keyof LoanPatch)[]) {
    if (patch[key] !== undefined && patch[key] !== loan[key]) (out as Record<string, unknown>)[key] = patch[key];
  }
  return out;
}

export function directionFor(loan: Pick<Loan, 'lenderId' | 'borrowerId'>, userId: string): Direction {
  return loan.lenderId === userId ? 'lent' : 'borrowed';
}

// ---------- Drafts and validation ----------

export interface LoanDraft {
  direction: Direction;
  counterpartyName: string;
  counterpartyPhone: string | null;
  amountMinor: number | null;
  currency: string;
  note: string;
  loanDate: string;
  dueDate: string | null;
  autoRemind: boolean;
}

export type DraftError = 'nameRequired' | 'amountInvalid' | 'phoneInvalid' | 'dueBeforeLoan' | 'noteTooLong';

export function validateDraft(d: LoanDraft): Partial<Record<keyof LoanDraft, DraftError>> {
  const errors: Partial<Record<keyof LoanDraft, DraftError>> = {};
  if (!d.counterpartyName.trim()) errors.counterpartyName = 'nameRequired';
  if (d.amountMinor === null || !Number.isSafeInteger(d.amountMinor) || d.amountMinor <= 0) errors.amountMinor = 'amountInvalid';
  if (d.counterpartyPhone !== null && !/^\+[1-9]\d{6,14}$/.test(d.counterpartyPhone)) errors.counterpartyPhone = 'phoneInvalid';
  if (d.dueDate && d.dueDate < d.loanDate) errors.dueDate = 'dueBeforeLoan';
  if (d.note.length > 500) errors.note = 'noteTooLong';
  return errors;
}

// ---------- Repayments ----------

export type RepaymentStatus = 'pending' | 'confirmed' | 'disputed' | 'cancelled';

export interface Repayment {
  id: string;
  loanId: string;
  amountMinor: number;
  paidOn: string; // ISO date
  note: string;
  createdBy: string | null;
  status: RepaymentStatus;
  respondedBy: string | null;
  responseComment: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------- History ----------

/** A version as stored in loan_versions (snapshot uses database column names). */
export interface LoanVersion {
  loanId: string;
  version: number;
  changedBy: string | null;
  snapshot: Record<string, unknown>;
  createdAt: string;
}

export type LoanChange =
  | { kind: 'created' }
  | { kind: 'amount'; from: { amountMinor: number; currency: string }; to: { amountMinor: number; currency: string } }
  | { kind: 'loanDate'; from: string; to: string }
  | { kind: 'dueDate'; from: string | null; to: string | null }
  | { kind: 'note'; to: string }
  | { kind: 'photo'; added: boolean }
  | { kind: 'name'; to: string }
  | { kind: 'phone' }
  | { kind: 'status'; to: LoanStatus; comment: string | null }
  | { kind: 'joined' };

const s = (v: unknown) => (v === null || v === undefined ? null : String(v));

/** What changed between two consecutive versions, in display order. */
export function describeVersion(prev: LoanVersion | null, cur: LoanVersion): LoanChange[] {
  const b = cur.snapshot;
  if (!prev) return [{ kind: 'created' }];
  const a = prev.snapshot;
  const changes: LoanChange[] = [];
  if (s(a.status) !== s(b.status)) {
    changes.push({ kind: 'status', to: b.status as LoanStatus, comment: typeof b.comment === 'string' ? b.comment : null });
  }
  const joined = (k: string) => a[k] == null && b[k] != null;
  if (joined('lender_id') || joined('borrower_id')) changes.push({ kind: 'joined' });
  if (Number(a.amount_minor) !== Number(b.amount_minor) || a.currency !== b.currency) {
    changes.push({
      kind: 'amount',
      from: { amountMinor: Number(a.amount_minor), currency: String(a.currency) },
      to: { amountMinor: Number(b.amount_minor), currency: String(b.currency) },
    });
  }
  if (s(a.loan_date) !== s(b.loan_date)) changes.push({ kind: 'loanDate', from: String(a.loan_date), to: String(b.loan_date) });
  if (s(a.due_date) !== s(b.due_date)) changes.push({ kind: 'dueDate', from: s(a.due_date), to: s(b.due_date) });
  if (s(a.note) !== s(b.note)) changes.push({ kind: 'note', to: String(b.note ?? '') });
  if (s(a.photo_path) !== s(b.photo_path)) changes.push({ kind: 'photo', added: !!b.photo_path });
  if (s(a.counterparty_name) !== s(b.counterparty_name)) changes.push({ kind: 'name', to: String(b.counterparty_name) });
  if (s(a.counterparty_phone) !== s(b.counterparty_phone)) changes.push({ kind: 'phone' });
  return changes;
}
