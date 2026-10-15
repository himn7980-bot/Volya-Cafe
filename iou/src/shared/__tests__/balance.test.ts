import { balanceOf, initialRepaymentStatus, nextReminderAt, totalsByCurrency } from '../balance';

describe('balanceOf', () => {
  it('counts only confirmed repayments as paid back', () => {
    const b = balanceOf(100000, [
      { amountMinor: 30000, status: 'confirmed' },
      { amountMinor: 20000, status: 'pending' },
      { amountMinor: 10000, status: 'disputed' },
      { amountMinor: 5000, status: 'cancelled' },
    ]);
    expect(b).toEqual({ total: 100000, repaid: 30000, pending: 20000, remaining: 70000, maxNewRepayment: 50000, progress: 0.3 });
  });
  it('handles a fully repaid record', () => {
    const b = balanceOf(500, [{ amountMinor: 200, status: 'confirmed' }, { amountMinor: 300, status: 'confirmed' }]);
    expect(b.remaining).toBe(0);
    expect(b.maxNewRepayment).toBe(0);
    expect(b.progress).toBe(1);
  });
  it('never goes negative', () => {
    expect(balanceOf(100, [{ amountMinor: 150, status: 'confirmed' }]).remaining).toBe(0);
  });
  it('works with no repayments', () => {
    expect(balanceOf(42, [])).toMatchObject({ repaid: 0, remaining: 42, maxNewRepayment: 42, progress: 0 });
  });
});

describe('initialRepaymentStatus', () => {
  it('trusts the lender, asks the lender when the borrower records it', () => {
    expect(initialRepaymentStatus('ali', 'ali')).toBe('confirmed');
    expect(initialRepaymentStatus('sara', 'ali')).toBe('pending');
    expect(initialRepaymentStatus('sara', null)).toBe('pending');
  });
});

describe('nextReminderAt', () => {
  const now = new Date('2026-10-15T12:00:00Z');
  it('allows a reminder when none was sent or 48 hours passed', () => {
    expect(nextReminderAt(null, now)).toBeNull();
    expect(nextReminderAt('2026-10-13T11:59:00Z', now)).toBeNull();
  });
  it('blocks for 48 hours', () => {
    expect(nextReminderAt('2026-10-14T12:00:00Z', now)?.toISOString()).toBe('2026-10-16T12:00:00.000Z');
  });
});

describe('totalsByCurrency', () => {
  it('never adds different currencies', () => {
    const totals = totalsByCurrency([
      { currency: 'USD', amount: 100 },
      { currency: 'IRR', amount: 5000000 },
      { currency: 'USD', amount: 50 },
    ]);
    expect([...totals]).toEqual([['USD', 150], ['IRR', 5000000]]);
  });
});
