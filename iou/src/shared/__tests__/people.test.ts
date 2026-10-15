import { groupByPerson, personKey, totals, type SummaryLoan } from '../people';

const ME = 'me';
let n = 0;
function loan(p: Partial<SummaryLoan>): SummaryLoan {
  n += 1;
  return {
    id: `l${n}`,
    creatorId: ME,
    lenderId: ME,
    borrowerId: null,
    counterpartyName: 'Sara',
    counterpartyPhone: null,
    amountMinor: 10000,
    currency: 'USD',
    note: '',
    loanDate: '2026-10-01',
    dueDate: null,
    photoPath: null,
    autoRemind: false,
    status: 'confirmed',
    shareToken: null,
    version: 1,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    repaidMinor: 0,
    ...p,
  };
}

describe('totals', () => {
  it('keeps currencies apart and subtracts repayments', () => {
    const t = totals(
      [
        loan({ amountMinor: 10000, repaidMinor: 2500 }),
        loan({ amountMinor: 5000 }),
        loan({ amountMinor: 3000000, currency: 'IRR' }),
        loan({ lenderId: null, borrowerId: ME, amountMinor: 700 }),
      ],
      ME,
    );
    expect([...t.owedToMe]).toEqual([['USD', 12500], ['IRR', 3000000]]);
    expect([...t.iOwe]).toEqual([['USD', 700]]);
  });

  it('ignores closed records and pending ones count', () => {
    const t = totals([loan({ status: 'settled' }), loan({ status: 'cancelled' }), loan({ status: 'pending', amountMinor: 1 })], ME);
    expect([...t.owedToMe]).toEqual([['USD', 1]]);
    expect(t.iOwe.size).toBe(0);
  });
});

describe('personKey', () => {
  it('prefers the account, then phone, then name', () => {
    expect(personKey(loan({ borrowerId: 'sara' }), ME)).toBe('u:sara');
    expect(personKey(loan({ counterpartyPhone: '+989121234567' }), ME)).toBe('p:+989121234567');
    expect(personKey(loan({ counterpartyName: '  Sara ' }), ME)).toBe('n:sara');
  });
  it('uses the creator when someone else wrote the record', () => {
    expect(personKey(loan({ creatorId: 'ali', lenderId: 'ali', borrowerId: ME }), ME)).toBe('u:ali');
  });
});

describe('groupByPerson', () => {
  it('nets lending against borrowing per currency', () => {
    const out = groupByPerson(
      [
        loan({ creatorId: 'sara', lenderId: 'sara', borrowerId: ME, amountMinor: 4000, counterpartyName: 'Me' }),
        loan({ borrowerId: 'sara', amountMinor: 10000, counterpartyName: 'Sara joon' }),
        loan({ borrowerId: 'sara', amountMinor: 200, currency: 'EUR' }),
      ],
      ME,
      [{ id: 'sara', displayName: 'Sara K.' }],
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe('Sara joon'); // the name I typed wins over the profile name
    expect([...out[0]!.net]).toEqual([['USD', 6000], ['EUR', 200]]);
    expect(groupByPerson([loan({ creatorId: 'sara', lenderId: 'sara', borrowerId: ME })], ME, [{ id: 'sara', displayName: 'Sara K.' }])[0]!.name).toBe('Sara K.');
    expect(out[0]!.openCount).toBe(3);
  });

  it('drops zero nets, skips cancelled and sorts open people first', () => {
    const out = groupByPerson(
      [
        loan({ counterpartyName: 'Old', status: 'settled', loanDate: '2026-10-10' }),
        loan({ counterpartyName: 'Gone', status: 'cancelled' }),
        loan({ counterpartyName: 'Even', amountMinor: 100 }),
        loan({ counterpartyName: 'even', lenderId: null, borrowerId: ME, amountMinor: 100, loanDate: '2026-09-01' }),
      ],
      ME,
    );
    expect(out.map((p) => p.name)).toEqual(['Even', 'Old']);
    expect(out[0]!.net.size).toBe(0);
    expect(out[0]!.lastDate).toBe('2026-10-01');
    expect(out[1]!.openCount).toBe(0);
  });
});
