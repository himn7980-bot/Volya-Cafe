// Dashboard maths: totals per currency and balances per person. Pure TS.
// Different currencies are never added together.

import { directionFor, isClosed, otherPartyId, type Loan } from './loans';

/** A loan as the dashboard sees it: with what was already paid back. */
export interface SummaryLoan extends Loan {
  repaidMinor: number;
}

export interface PersonInfo {
  id: string;
  displayName: string;
}

export const remainingOf = (l: SummaryLoan) => Math.max(0, l.amountMinor - l.repaidMinor);

/** Open records: still waiting for an answer or for money. */
export const isOpen = (l: Loan) => !isClosed(l.status);

export interface Totals {
  /** currency -> what others owe me */
  owedToMe: Map<string, number>;
  /** currency -> what I owe others */
  iOwe: Map<string, number>;
}

export function totals(loans: readonly SummaryLoan[], userId: string): Totals {
  const owedToMe = new Map<string, number>();
  const iOwe = new Map<string, number>();
  for (const l of loans) {
    if (!isOpen(l)) continue;
    const rest = remainingOf(l);
    if (rest === 0) continue;
    const target = directionFor(l, userId) === 'lent' ? owedToMe : iOwe;
    target.set(l.currency, (target.get(l.currency) ?? 0) + rest);
  }
  return { owedToMe, iOwe };
}

/** How a person is told apart: their account if linked, else the phone or name I typed. */
export function personKey(l: Loan, userId: string): string {
  const other = otherPartyId(l, userId);
  if (other) return `u:${other}`;
  if (l.counterpartyPhone) return `p:${l.counterpartyPhone}`;
  return `n:${l.counterpartyName.trim().toLocaleLowerCase()}`;
}

export interface PersonSummary {
  key: string;
  name: string;
  /** currency -> net; positive: they owe me, negative: I owe them. Zero nets are left out. */
  net: Map<string, number>;
  openCount: number;
  loanIds: string[];
  /** Latest record date, for sorting. */
  lastDate: string;
}

export function groupByPerson(
  loans: readonly SummaryLoan[],
  userId: string,
  people: readonly PersonInfo[] = [],
): PersonSummary[] {
  const byKey = new Map<string, PersonSummary>();
  const named = new Set<string>();
  for (const l of loans) {
    if (l.status === 'cancelled') continue;
    const key = personKey(l, userId);
    const other = otherPartyId(l, userId);
    // Same rule as the record cards: the name I typed, else their profile name.
    const mine = l.creatorId === userId;
    const name = mine ? l.counterpartyName : (people.find((x) => x.id === other)?.displayName ?? '…');
    let p = byKey.get(key);
    if (!p) {
      p = { key, name, net: new Map(), openCount: 0, loanIds: [], lastDate: l.loanDate };
      byKey.set(key, p);
      if (mine) named.add(key);
    } else if (mine && !named.has(key)) {
      p.name = name;
      named.add(key);
    }
    p.loanIds.push(l.id);
    if (l.loanDate > p.lastDate) p.lastDate = l.loanDate;
    if (isOpen(l)) {
      p.openCount += 1;
      const signed = (directionFor(l, userId) === 'lent' ? 1 : -1) * remainingOf(l);
      p.net.set(l.currency, (p.net.get(l.currency) ?? 0) + signed);
    }
  }
  for (const p of byKey.values()) {
    for (const [cur, v] of p.net) if (v === 0) p.net.delete(cur);
  }
  // People with something open first, then most recent.
  return [...byKey.values()].sort(
    (a, b) => Number(b.openCount > 0) - Number(a.openCount > 0) || b.lastDate.localeCompare(a.lastDate),
  );
}
