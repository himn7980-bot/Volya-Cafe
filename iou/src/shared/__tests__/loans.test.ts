import { applyLoanEdit, describeVersion, diffPatch, directionFor, validateDraft, type Loan, type LoanDraft, type LoanVersion } from '../loans';

const loan: Loan = {
  id: 'l1', creatorId: 'me', lenderId: 'me', borrowerId: null, counterpartyName: 'Sara', counterpartyPhone: null,
  amountMinor: 1000, currency: 'USD', note: '', loanDate: '2026-10-01', dueDate: null, photoPath: null,
  status: 'confirmed', shareToken: 't', version: 2, createdAt: '', updatedAt: '',
};

describe('applyLoanEdit', () => {
  it('asks for confirmation again when agreed terms change', () => {
    expect(applyLoanEdit(loan, { amountMinor: 2000 }).status).toBe('pending');
    expect(applyLoanEdit(loan, { dueDate: '2026-12-01' }).status).toBe('pending');
    expect(applyLoanEdit({ ...loan, status: 'disputed' }, { note: 'fixed' }).status).toBe('pending');
  });
  it('keeps the status for label-only changes', () => {
    expect(applyLoanEdit(loan, { counterpartyName: '  Sara joon ' })).toMatchObject({ status: 'confirmed', counterpartyName: 'Sara joon' });
  });
  it('cancels', () => {
    expect(applyLoanEdit(loan, { status: 'cancelled' }).status).toBe('cancelled');
  });
  it('refuses to edit closed loans', () => {
    expect(() => applyLoanEdit({ ...loan, status: 'settled' }, { note: 'x' })).toThrow();
  });
});

describe('diffPatch / directionFor', () => {
  it('keeps only real changes', () => {
    expect(diffPatch(loan, { amountMinor: 1000, note: 'x', dueDate: null })).toEqual({ note: 'x' });
  });
  it('knows who owes whom', () => {
    expect(directionFor(loan, 'me')).toBe('lent');
    expect(directionFor({ lenderId: null, borrowerId: 'me' }, 'me')).toBe('borrowed');
  });
});

describe('validateDraft', () => {
  const draft: LoanDraft = {
    direction: 'lent', counterpartyName: 'Ali', counterpartyPhone: null, amountMinor: 500,
    currency: 'USD', note: '', loanDate: '2026-10-10', dueDate: null,
  };
  it('accepts a good draft', () => expect(validateDraft(draft)).toEqual({}));
  it('reports each problem', () => {
    expect(
      validateDraft({ ...draft, counterpartyName: ' ', amountMinor: null, counterpartyPhone: '0912', dueDate: '2026-10-01', note: 'x'.repeat(501) }),
    ).toEqual({ counterpartyName: 'nameRequired', amountMinor: 'amountInvalid', counterpartyPhone: 'phoneInvalid', dueDate: 'dueBeforeLoan', note: 'noteTooLong' });
    expect(validateDraft({ ...draft, amountMinor: 0 }).amountMinor).toBe('amountInvalid');
  });
});

describe('describeVersion', () => {
  const v = (version: number, snapshot: Record<string, unknown>): LoanVersion => ({ loanId: 'l1', version, changedBy: 'me', snapshot, createdAt: '' });
  const base = { status: 'pending', amount_minor: 1000, currency: 'USD', loan_date: '2026-10-01', due_date: null, note: '', photo_path: null, counterparty_name: 'Sara', counterparty_phone: null };

  it('describes creation', () => {
    expect(describeVersion(null, v(1, base))).toEqual([{ kind: 'created' }]);
  });
  it('lists what changed', () => {
    const next = { ...base, status: 'confirmed', amount_minor: 2000, due_date: '2026-11-01', photo_path: 'l1/a.jpg', counterparty_phone: '+15555550100' };
    expect(describeVersion(v(1, base), v(2, next)).map((c) => c.kind)).toEqual(['status', 'amount', 'dueDate', 'photo', 'phone']);
    expect(describeVersion(v(2, next), v(3, { ...next, due_date: null, photo_path: null }))).toEqual([
      { kind: 'dueDate', from: '2026-11-01', to: null },
      { kind: 'photo', added: false },
    ]);
  });
});
