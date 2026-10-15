import { RemoteError, runSync, MAX_ATTEMPTS } from '../syncEngine';

import { FakeRemote, ME, makeLoan, makeRepayment, newStore } from './helpers';

describe('local store', () => {
  it('shows a new loan immediately, marked pending', async () => {
    const store = await newStore();
    const loan = makeLoan();
    await store.createLoan(loan);
    const [local] = await store.listLoans();
    expect(local).toMatchObject({ id: loan.id, amountMinor: 1000, pending: true });
    expect(await store.pendingCount()).toBe(1);
  });

  it('folds edits of an unsent loan into its create', async () => {
    const store = await newStore();
    const loan = makeLoan();
    await store.createLoan(loan);
    await store.editLoan(loan.id, { amountMinor: 2500, note: 'rent' });
    const ops = await store.pendingOps();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: 'create', payload: { amountMinor: 2500, note: 'rent' } });
  });

  it('cancelling a loan that never left the phone simply removes it', async () => {
    const store = await newStore();
    const loan = makeLoan();
    await store.createLoan(loan);
    expect(await store.editLoan(loan.id, { status: 'cancelled' })).toBeNull();
    expect(await store.listLoans()).toHaveLength(0);
    expect(await store.pendingCount()).toBe(0);
  });

  it('merges repeated edits into one update with the original base version', async () => {
    const store = await newStore();
    const loan = makeLoan({ version: 3 });
    await store.applyServerLoans([loan]);
    await store.editLoan(loan.id, { amountMinor: 2000 });
    await store.editLoan(loan.id, { note: 'x' });
    await store.editLoan(loan.id, { note: 'x' }); // no-op
    const ops = await store.pendingOps();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: 'update', baseVersion: 3, payload: { amountMinor: 2000, note: 'x' } });
  });

  it('editing the terms of a confirmed loan shows it as pending again', async () => {
    const store = await newStore();
    const loan = makeLoan({ status: 'confirmed' });
    await store.applyServerLoans([loan]);
    expect((await store.editLoan(loan.id, { counterpartyName: 'Sara joon' }))!.status).toBe('confirmed');
    expect((await store.editLoan(loan.id, { amountMinor: 5 }))!.status).toBe('pending');
  });

  it('does not overwrite local changes or newer data when pulling', async () => {
    const store = await newStore();
    const a = makeLoan({ version: 2 });
    const b = makeLoan({ version: 5 });
    await store.applyServerLoans([a, b]);
    await store.editLoan(a.id, { note: 'mine' });
    await store.applyServerLoans([{ ...a, version: 3, note: 'theirs' }, { ...b, version: 4, note: 'old' }]);
    expect((await store.getLoan(a.id))!.note).toBe('mine');
    expect((await store.getLoan(b.id))!.version).toBe(5);
  });

  it('notifies subscribers after writes', async () => {
    const store = await newStore();
    const fn = jest.fn();
    store.subscribe(fn);
    await store.createLoan(makeLoan());
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('sync', () => {
  it('pushes a new loan and stores the server copy', async () => {
    const store = await newStore();
    const remote = new FakeRemote();
    const loan = makeLoan();
    await store.createLoan(loan);
    const r = await runSync(store, remote);
    expect(r).toMatchObject({ pushed: 1, offline: false });
    const local = await store.getLoan(loan.id);
    expect(local).toMatchObject({ pending: false, shareToken: `token-${loan.id}`, version: 1 });
  });

  it('keeps everything queued while offline and sends it later', async () => {
    const store = await newStore();
    const remote = new FakeRemote();
    remote.online = false;
    const loan = makeLoan();
    await store.createLoan(loan);
    await store.editLoan(loan.id, { amountMinor: 999 });
    expect((await runSync(store, remote)).offline).toBe(true);
    expect(await store.pendingCount()).toBe(1);
    expect((await store.pendingOps())[0]!.attempts).toBe(0); // network errors don't count as attempts

    remote.online = true;
    await runSync(store, remote);
    expect(remote.loans.get(loan.id)!.amountMinor).toBe(999);
    expect(await store.pendingCount()).toBe(0);
  });

  it('is safe when a create reached the server but the reply was lost', async () => {
    const store = await newStore();
    const remote = new FakeRemote();
    const loan = makeLoan();
    await store.createLoan(loan);
    await remote.insertLoan(loan); // first attempt arrived...
    await runSync(store, remote); // ...retry must not duplicate
    expect(remote.loans.size).toBe(1);
    expect(await store.pendingCount()).toBe(0);
  });

  it('re-applies an edit on top of a newer server version', async () => {
    const store = await newStore();
    const remote = new FakeRemote();
    const loan = makeLoan();
    await store.createLoan(loan);
    await runSync(store, remote);

    remote.serverEdit(loan.id, { status: 'confirmed' }); // the other person confirmed
    await store.editLoan(loan.id, { amountMinor: 4242 }); // offline edit based on version 1

    await runSync(store, remote);
    const server = remote.loans.get(loan.id)!;
    expect(server.amountMinor).toBe(4242);
    expect(server.status).toBe('pending'); // must be confirmed again
    expect(await store.getLoan(loan.id)).toMatchObject({ amountMinor: 4242, status: 'pending', version: 3, pending: false });
  });

  it('drops a change the server refuses and shows the server version', async () => {
    const store = await newStore();
    const remote = new FakeRemote();
    const loan = makeLoan();
    await store.createLoan(loan);
    await runSync(store, remote);
    remote.serverEdit(loan.id, { status: 'settled' });
    await store.editLoan(loan.id, { note: 'too late' });
    const r = await runSync(store, remote);
    expect(r.rejected).toBe(1);
    expect(await store.getLoan(loan.id)).toMatchObject({ status: 'settled', note: '', pending: false });
  });

  it('retries server errors in order, then gives up after MAX_ATTEMPTS', async () => {
    const store = await newStore();
    const remote = new FakeRemote();
    const a = makeLoan();
    const b = makeLoan();
    await store.createLoan(a);
    await store.createLoan(b);
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      remote.failNext = new RemoteError('500', 'server');
      const r = await runSync(store, remote);
      expect(r.pushed).toBe(0); // b waits behind a
    }
    remote.failNext = new RemoteError('500', 'server');
    const r = await runSync(store, remote);
    expect(r).toMatchObject({ rejected: 1, pushed: 1 });
    expect(remote.loans.has(b.id)).toBe(true);
  });

  it('uploads photos after the loan exists', async () => {
    const store = await newStore();
    const remote = new FakeRemote();
    const loan = makeLoan();
    await store.createLoan(loan);
    await store.setPhoto(loan.id, 'file:///docs/receipt-1.jpg');
    expect((await store.getLoan(loan.id))!.localPhotoUri).toBe('file:///docs/receipt-1.jpg');
    await runSync(store, remote);
    expect(remote.calls.slice(0, 3)).toEqual([`insert ${loan.id}`, `upload ${loan.id}`, `update ${loan.id} @-`]);
    expect(await store.getLoan(loan.id)).toMatchObject({ photoPath: `${loan.id}/receipt-1.jpg`, localPhotoUri: null, pending: false });
  });

  it('pulls loans others changed, with an overlapping cursor', async () => {
    const store = await newStore();
    const remote = new FakeRemote();
    const loan = makeLoan({ lenderId: null, borrowerId: ME, creatorId: 'someone-else' });
    remote.loans.set(loan.id, { ...loan, updatedAt: '2026-10-15T00:00:05.000Z' });
    expect((await runSync(store, remote)).pulled).toBe(1);
    remote.serverEdit(loan.id, { status: 'confirmed' });
    await runSync(store, remote);
    expect((await store.getLoan(loan.id))!.status).toBe('confirmed');
    expect(remote.calls.filter((c) => c.startsWith('pull '))[1]).toBe('pull 2026-10-14T23:58:05.000Z');
  });

  it('keeps the names of the people I share records with', async () => {
    const store = await newStore();
    const remote = new FakeRemote();
    remote.people = [{ id: 'sara', displayName: 'Sara', language: 'tr', avatarPath: null }];
    await runSync(store, remote);
    expect(await store.listPeople()).toEqual(remote.people);
    remote.people = [];
    const loan = makeLoan();
    remote.loans.set(loan.id, loan);
    remote.serverEdit(loan.id, { note: 'x' });
    await runSync(store, remote);
    expect(await store.listPeople()).toEqual([]);
  });

});

describe('repayments', () => {
  async function confirmedLoan(over: Parameters<typeof makeLoan>[0] = {}) {
    const store = await newStore();
    const remote = new FakeRemote();
    const loan = makeLoan({ status: 'confirmed', amountMinor: 1000, ...over });
    remote.loans.set(loan.id, loan);
    await store.applyServerLoans([loan]);
    return { store, remote, loan };
  }

  it('records a repayment offline and sends it later', async () => {
    const { store, remote, loan } = await confirmedLoan();
    remote.online = false;
    const rep = makeRepayment(loan.id, { amountMinor: 400, status: 'confirmed' }); // I am the lender
    await store.createRepayment(rep);
    expect((await store.getLoan(loan.id))!.repaidMinor).toBe(400);
    expect((await store.listRepayments(loan.id))[0]).toMatchObject({ pending: true });
    expect((await runSync(store, remote)).offline).toBe(true);

    remote.online = true;
    await runSync(store, remote);
    expect(remote.repayments.get(rep.id)!.status).toBe('confirmed');
    expect((await store.listRepayments(loan.id))[0]).toMatchObject({ pending: false, status: 'confirmed' });
  });

  it('settles the record when the last repayment is confirmed', async () => {
    const { store, remote, loan } = await confirmedLoan({ lenderId: 'sara', borrowerId: ME, creatorId: ME });
    const rep = makeRepayment(loan.id, { amountMinor: 1000 });
    await store.createRepayment(rep);
    await runSync(store, remote);
    expect((await store.listRepayments(loan.id))[0]!.status).toBe('pending'); // waits for Sara

    remote.serverAnswerRepayment(rep.id, 'confirmed');
    await runSync(store, remote);
    expect((await store.listRepayments(loan.id))[0]!.status).toBe('confirmed');
    expect(await store.getLoan(loan.id)).toMatchObject({ status: 'settled', repaidMinor: 1000 });
  });

  it('withdraws an unsent repayment without contacting the server', async () => {
    const { store, remote, loan } = await confirmedLoan();
    const rep = makeRepayment(loan.id);
    await store.createRepayment(rep);
    await store.cancelRepayment(rep.id);
    expect(await store.listRepayments(loan.id)).toEqual([]);
    expect(await store.pendingCount()).toBe(0);
    await runSync(store, remote);
    expect(remote.calls.some((c) => c.startsWith('repay') || c.startsWith('cancel-repayment'))).toBe(false);
  });

  it('withdraws a sent pending repayment through the server', async () => {
    const { store, remote, loan } = await confirmedLoan({ lenderId: 'sara', borrowerId: ME });
    const rep = makeRepayment(loan.id);
    await store.createRepayment(rep);
    await runSync(store, remote);
    await store.cancelRepayment(rep.id);
    expect((await store.listRepayments(loan.id))[0]).toMatchObject({ status: 'cancelled', pending: true });
    await runSync(store, remote);
    expect(remote.repayments.get(rep.id)!.status).toBe('cancelled');
  });

  it('drops a repayment the server refuses', async () => {
    const { store, remote, loan } = await confirmedLoan();
    remote.serverEdit(loan.id, { status: 'settled' });
    await store.createRepayment(makeRepayment(loan.id, { amountMinor: 10 }));
    const r = await runSync(store, remote);
    expect(r.rejected).toBe(1);
    expect(await store.listRepayments(loan.id)).toEqual([]);
  });

  it('a pending repayment does not hide newer loan data', async () => {
    const { store, remote, loan } = await confirmedLoan({ lenderId: 'sara', borrowerId: ME });
    remote.online = false;
    await store.createRepayment(makeRepayment(loan.id));
    await store.applyServerLoans([{ ...loan, version: 2, note: 'from server' }]);
    expect((await store.getLoan(loan.id))!.note).toBe('from server');
  });
});
