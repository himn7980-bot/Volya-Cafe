// Balance of a record: what was paid back and what is still open. Pure TS,
// integer minor units only. The database enforces the same rules
// (repayments_before_insert, settle_if_repaid).

import type { RepaymentStatus } from './loans';

export type { RepaymentStatus };

export interface RepaymentLike {
  amountMinor: number;
  status: RepaymentStatus;
}

export interface Balance {
  total: number;
  /** Confirmed repayments. */
  repaid: number;
  /** Repayments waiting for an answer. */
  pending: number;
  /** total - repaid: what is still owed. */
  remaining: number;
  /** What a new repayment may be at most (pending ones count as used). */
  maxNewRepayment: number;
  /** 0..1, confirmed part, for progress bars. */
  progress: number;
}

export function balanceOf(totalMinor: number, repayments: readonly RepaymentLike[]): Balance {
  let repaid = 0;
  let pending = 0;
  for (const r of repayments) {
    if (r.status === 'confirmed') repaid += r.amountMinor;
    else if (r.status === 'pending') pending += r.amountMinor;
  }
  const remaining = Math.max(0, totalMinor - repaid);
  return {
    total: totalMinor,
    repaid,
    pending,
    remaining,
    maxNewRepayment: Math.max(0, totalMinor - repaid - pending),
    progress: totalMinor > 0 ? Math.min(1, repaid / totalMinor) : 0,
  };
}

/** A repayment recorded by the lender counts at once; one by the borrower waits for the lender. */
export function initialRepaymentStatus(recordedBy: string, lenderId: string | null): RepaymentStatus {
  return recordedBy === lenderId ? 'confirmed' : 'pending';
}

export const REMINDER_INTERVAL_MS = 48 * 60 * 60 * 1000;

/** When the next manual reminder is allowed (null = now). */
export function nextReminderAt(lastManualReminderAt: string | null, now: Date = new Date()): Date | null {
  if (!lastManualReminderAt) return null;
  const next = new Date(Date.parse(lastManualReminderAt) + REMINDER_INTERVAL_MS);
  return next > now ? next : null;
}

/** Totals per currency. Different currencies are never added together. */
export function totalsByCurrency<T extends { currency: string; amount: number }>(items: readonly T[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const it of items) out.set(it.currency, (out.get(it.currency) ?? 0) + it.amount);
  return out;
}
