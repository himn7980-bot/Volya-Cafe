// Trust score, portfolio, trust cards and due-date extensions. Everything here
// is computed by the server (supabase/migrations/*_trust_score.sql); the app only
// shows it. Needs the network: nothing is cached offline.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Share } from 'react-native';

import { syncNow } from '@/features/loans/service';
import { i18n } from '@/i18n';
import { brand } from '@/lib/brand';
import { supabase } from '@/lib/supabase';

export type TrustLevel = 'excellent' | 'good' | 'fair' | 'weak' | 'poor';
export type VolumeBand = 'low' | 'medium' | 'high';

/** What other people may see. */
export type TrustCard =
  | { error: 'not_found' | 'no_account' | 'expired' | 'rate_limited' }
  | { error?: undefined; hidden: true; display_name: string }
  | {
      error?: undefined;
      hidden: false;
      display_name: string;
      member_since: string;
      is_new: boolean;
      score: number | null;
      level: TrustLevel | null;
      on_time_pct: number | null;
      settled_count: number;
      counterparties: number;
      volume_band: VolumeBand;
    };

export type TrustEventKind = 'on_time' | 'no_due' | 'late' | 'overdue' | 'lent';

export interface MyTrust {
  score: { is_new: boolean; score: number | null; level: TrustLevel | null; raw: number; on_time_pct: number | null };
  card: TrustCard;
  money: { currency: string; borrowed: number; repaid: number; lent: number; received: number }[];
  counts: {
    taken: number;
    given: number;
    settled: number;
    open: number;
    overdue: number;
    counterparties: number;
    extensions: number;
    disputes: number;
  };
  trend: { date: string; score: number | null; raw: number }[];
  events: {
    loan_id: string;
    role: 'borrower' | 'lender';
    kind: TrustEventKind;
    date: string;
    late_days: number;
    points: number;
    name: string | null;
  }[];
}

export function useMyTrust() {
  return useQuery({
    queryKey: ['trust', 'me'],
    queryFn: async (): Promise<MyTrust> => {
      const { data, error } = await supabase.rpc('my_trust');
      if (error) throw error;
      return data as MyTrust;
    },
    staleTime: 60_000,
  });
}

/** The other person's card, for a record we share (they see mine the same way). */
export function useCardForLoan(loanId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['trust', 'loan', loanId],
    enabled: !!loanId && enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<TrustCard> => {
      const { data, error } = await supabase.rpc('trust_card_for_loan', { p_loan_id: loanId! });
      if (error) throw error;
      return data as TrustCard;
    },
  });
}

export function useCardByToken(token: string | undefined) {
  return useQuery({
    queryKey: ['trust', 'token', token],
    enabled: !!token,
    queryFn: async (): Promise<TrustCard> => {
      const { data, error } = await supabase.rpc('trust_card_by_token', { p_token: token! });
      if (error) throw error;
      return data as TrustCard;
    },
  });
}

// ---------- Card links ----------

export interface CardLink {
  token: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export const cardUrl = (token: string) => `${brand.webBaseUrl.replace(/\/$/, '')}/c/#card.${token}`;

export function useCardLinks() {
  return useQuery({
    queryKey: ['trust', 'links'],
    queryFn: async (): Promise<CardLink[]> => {
      const { data, error } = await supabase
        .from('card_links')
        .select('token, created_at, expires_at, revoked_at')
        .is('revoked_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

/** Create a 7-day link to my card and open the share sheet. */
export async function shareMyCard(): Promise<void> {
  const { data, error } = await supabase.rpc('create_card_link', { p_days: 7 });
  if (error) throw error;
  const url = cardUrl(data.token);
  await Share.share({ message: i18n.t('trust.shareMessage', { url }) });
}

export async function revokeCardLink(token: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_card_link', { p_token: token });
  if (error) throw error;
}

export function useInvalidateTrust() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['trust'] });
}

// ---------- Due-date extensions ----------

export interface Extension {
  id: string;
  loan_id: string;
  proposed_by: string | null;
  old_due_date: string;
  new_due_date: string;
  reason: string;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
  created_at: string;
  responded_at: string | null;
}

export function useExtensions(loanId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['extensions', loanId],
    enabled: !!loanId && enabled,
    queryFn: async (): Promise<Extension[]> => {
      const { data, error } = await supabase
        .from('loan_extensions')
        .select('*')
        .eq('loan_id', loanId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export async function proposeExtension(loanId: string, newDue: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('propose_extension', { p_loan_id: loanId, p_new_due: newDue, p_reason: reason });
  if (error) throw error;
}

export async function respondToExtension(id: string, action: 'accept' | 'reject' | 'cancel'): Promise<void> {
  const { error } = await supabase.rpc('respond_to_extension', { p_extension_id: id, p_action: action });
  if (error) throw error;
  // An accepted extension changes the record's due date: fetch it.
  if (action === 'accept') await syncNow();
}
