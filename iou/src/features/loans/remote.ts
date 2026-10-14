import type { PostgrestError } from '@supabase/supabase-js';

import type { LoanInsert, LoanRow, LoanUpdate } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';
import type { Loan, LoanPatch, LoanVersion } from '@/shared/loans';

import { RemoteError, type Remote } from './syncEngine';

export const toLoan = (r: LoanRow): Loan => ({
  id: r.id,
  creatorId: r.creator_id,
  lenderId: r.lender_id,
  borrowerId: r.borrower_id,
  counterpartyName: r.counterparty_name,
  counterpartyPhone: r.counterparty_phone,
  amountMinor: Number(r.amount_minor),
  currency: r.currency,
  note: r.note,
  loanDate: r.loan_date,
  dueDate: r.due_date,
  photoPath: r.photo_path,
  status: r.status,
  shareToken: r.share_token,
  version: r.version,
  // Normalized so timestamps compare correctly as strings.
  createdAt: new Date(r.created_at).toISOString(),
  updatedAt: new Date(r.updated_at).toISOString(),
});

const toInsert = (l: Loan): LoanInsert => ({
  id: l.id,
  lender_id: l.lenderId,
  borrower_id: l.borrowerId,
  counterparty_name: l.counterpartyName,
  counterparty_phone: l.counterpartyPhone,
  amount_minor: l.amountMinor,
  currency: l.currency,
  note: l.note,
  loan_date: l.loanDate,
  due_date: l.dueDate,
});

const toUpdate = (p: LoanPatch): LoanUpdate => {
  const u: LoanUpdate = {};
  if (p.counterpartyName !== undefined) u.counterparty_name = p.counterpartyName;
  if (p.counterpartyPhone !== undefined) u.counterparty_phone = p.counterpartyPhone;
  if (p.amountMinor !== undefined) u.amount_minor = p.amountMinor;
  if (p.currency !== undefined) u.currency = p.currency;
  if (p.note !== undefined) u.note = p.note;
  if (p.loanDate !== undefined) u.loan_date = p.loanDate;
  if (p.dueDate !== undefined) u.due_date = p.dueDate;
  if (p.photoPath !== undefined) u.photo_path = p.photoPath;
  if (p.status !== undefined) u.status = p.status;
  return u;
};

/**
 * Turn a Supabase error into a sync decision: the change can never succeed
 * (constraint, permission), the server is struggling (retry a few times), or we
 * simply could not reach it (retry later, no limit).
 */
function classify(error: Pick<PostgrestError, 'code' | 'message'> & { status?: number }): RemoteError {
  const code = error.code ?? '';
  if (!code && (!error.status || error.status === 0)) return new RemoteError(error.message, 'network');
  if (/^(22|23|42|P0)/.test(code)) return new RemoteError(error.message, 'rejected');
  return new RemoteError(error.message, 'server');
}

const PAGE = 500;

export const supabaseRemote: Remote = {
  async insertLoan(loan) {
    const { data, error, status } = await supabase.from('loans').insert(toInsert(loan)).select('*').single();
    if (error) {
      // Already there: an earlier attempt arrived but its reply was lost.
      if (error.code === '23505') {
        const existing = await supabaseRemote.fetchLoan(loan.id);
        if (existing) return existing;
      }
      throw classify({ ...error, status });
    }
    return toLoan(data);
  },

  async updateLoan(id, patch, baseVersion) {
    let query = supabase.from('loans').update(toUpdate(patch)).eq('id', id);
    if (baseVersion !== null) query = query.eq('version', baseVersion);
    const { data, error, status } = await query.select('*');
    if (error) throw classify({ ...error, status });
    return data.length ? toLoan(data[0]!) : 'conflict';
  },

  async uploadPhoto(loanId, localUri) {
    let body: ArrayBuffer;
    try {
      body = await (await fetch(localUri)).arrayBuffer();
    } catch {
      // The local file is gone (e.g. app data cleared): nothing to upload, ever.
      throw new RemoteError('photo file missing', 'rejected');
    }
    const ext = /\.(png|webp)$/i.exec(localUri)?.[1]?.toLowerCase() ?? 'jpg';
    const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    const path = `${loanId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from('loan-photos').upload(path, body, { contentType, upsert: false });
    if (error) {
      const status = Number((error as { statusCode?: string | number }).statusCode ?? 0);
      if (status >= 400 && status < 500) throw new RemoteError(error.message, 'rejected');
      throw new RemoteError(error.message, status ? 'server' : 'network');
    }
    return path;
  },

  async fetchLoan(id) {
    const { data, error, status } = await supabase.from('loans').select('*').eq('id', id).maybeSingle();
    if (error) throw classify({ ...error, status });
    return data ? toLoan(data) : null;
  },

  async fetchLoansSince(since) {
    const out: Loan[] = [];
    for (let from = 0; ; from += PAGE) {
      let query = supabase.from('loans').select('*').order('updated_at').order('id').range(from, from + PAGE - 1);
      if (since) query = query.gte('updated_at', since);
      const { data, error, status } = await query;
      if (error) throw classify({ ...error, status });
      out.push(...data.map(toLoan));
      if (data.length < PAGE) return out;
    }
  },

  async fetchVersions(loanId) {
    const { data, error, status } = await supabase
      .from('loan_versions')
      .select('*')
      .eq('loan_id', loanId)
      .order('version');
    if (error) throw classify({ ...error, status });
    return data.map(
      (v): LoanVersion => ({
        loanId: v.loan_id,
        version: v.version,
        changedBy: v.changed_by,
        snapshot: v.snapshot,
        createdAt: new Date(v.created_at).toISOString(),
      }),
    );
  },
};
