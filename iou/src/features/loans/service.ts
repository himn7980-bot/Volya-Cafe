import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as Network from 'expo-network';
import { openDatabaseSync } from 'expo-sqlite';
import { useEffect } from 'react';
import { AppState, Share } from 'react-native';
import { create } from 'zustand';

import { useSession } from '@/features/auth/auth';
import { formatContextForLanguage, i18n } from '@/i18n';
import { brand } from '@/lib/brand';
import { supabase } from '@/lib/supabase';
import { initialRepaymentStatus } from '@/shared/balance';
import { formatDate, formatMoney } from '@/shared/format';
import { reminderMessage, type Tone } from '@/shared/notifications';
import { directionFor, otherPartyId, type Loan, type LoanDraft, type LoanPatch, type Repayment } from '@/shared/loans';

import { LocalStore, type LocalLoan, type Person } from './localStore';
import {
  claimLoansByPhone,
  claimSharedLoan,
  respondToLoan,
  respondToRepayment,
  sendReminder,
  supabaseRemote,
  type ReminderResult,
} from './remote';
import { runSync } from './syncEngine';

// ---------- Local database ----------

let storePromise: Promise<LocalStore> | null = null;

export function getStore(): Promise<LocalStore> {
  if (!storePromise) {
    storePromise = (async () => {
      const store = new LocalStore(openDatabaseSync('iou.db'));
      await store.migrate();
      return store;
    })();
  }
  return storePromise;
}

const OWNER_KEY = 'owner';

/** Local data belongs to one account; wipe it if someone else signs in on this phone. */
async function ensureOwner(store: LocalStore, uid: string) {
  const owner = await store.getMeta(OWNER_KEY);
  if (owner === uid) return;
  if (owner) await store.clearAll();
  await store.setMeta(OWNER_KEY, uid);
}

/** Forget all local loans (on sign-out). */
export async function clearLocalData() {
  const store = await getStore();
  await store.clearAll();
  useSyncStatus.setState({ pending: 0, rejected: 0, lastSyncedAt: null });
}

// ---------- Sync status & scheduling ----------

interface SyncStatus {
  syncing: boolean;
  /** False after the last attempt could not reach the server. */
  online: boolean;
  pending: number;
  /** Changes the server refused since the person last dismissed the notice. */
  rejected: number;
  lastSyncedAt: string | null;
  dismissRejected: () => void;
}

export const useSyncStatus = create<SyncStatus>()((set) => ({
  syncing: false,
  online: true,
  pending: 0,
  rejected: 0,
  lastSyncedAt: null,
  dismissRejected: () => set({ rejected: 0 }),
}));

let timer: ReturnType<typeof setTimeout> | null = null;
let claimedByPhoneFor: string | null = null;
let running: Promise<void> | null = null;
let again = false;

/** Ask for a sync soon. Calls are coalesced; only one sync runs at a time. */
export function requestSync(delayMs = 300) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncNow();
  }, delayMs);
}

/** Sync now; resolves when done. Used by pull-to-refresh. */
export async function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  const uid = useSession.getState().session?.user.id;
  if (!uid) return;
  running = (async () => {
    useSyncStatus.setState({ syncing: true });
    const store = await getStore();
    try {
      await ensureOwner(store, uid);
      if (claimedByPhoneFor !== uid) {
        // Once per session: records others wrote with my phone number become mine too.
        await claimLoansByPhone()
          .then(() => {
            claimedByPhoneFor = uid;
          })
          .catch(() => undefined);
      }
      const result = await runSync(store, supabaseRemote);
      useSyncStatus.setState((s) => ({
        online: !result.offline,
        rejected: s.rejected + result.rejected,
        lastSyncedAt: result.offline ? s.lastSyncedAt : new Date().toISOString(),
      }));
    } catch (e) {
      if (__DEV__) console.warn('sync failed', e);
    } finally {
      useSyncStatus.setState({ syncing: false, pending: await store.pendingCount() });
      running = null;
      if (again) {
        again = false;
        requestSync();
      }
    }
  })();
  return running;
}

/**
 * Keep data fresh while signed in: sync on start, when the app comes to the
 * foreground, when the network comes back, and every minute in the foreground.
 */
export function useSyncLoop(enabled: boolean) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    let unsubscribe = () => {};
    void getStore().then((store) => {
      unsubscribe = store.subscribe(() => {
        void qc.invalidateQueries({ queryKey: ['local'] });
        void store.pendingCount().then((pending) => useSyncStatus.setState({ pending }));
      });
      void qc.invalidateQueries({ queryKey: ['local'] });
    });
    requestSync(0);

    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') requestSync(0);
    });
    const network = Network.addNetworkStateListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) requestSync(0);
      else useSyncStatus.setState({ online: false });
    });
    const interval = setInterval(() => {
      if (AppState.currentState === 'active') requestSync(0);
    }, 60_000);

    return () => {
      unsubscribe();
      appState.remove();
      network.remove();
      clearInterval(interval);
    };
  }, [enabled, qc]);
}

// ---------- Reads ----------

export function useLoans() {
  return useQuery({
    queryKey: ['local', 'loans'],
    queryFn: async () => (await getStore()).listLoans(),
    networkMode: 'always',
  });
}

export function useLoan(id: string | undefined) {
  return useQuery({
    queryKey: ['local', 'loan', id],
    queryFn: async () => (await getStore()).getLoan(id!),
    enabled: !!id,
    networkMode: 'always',
  });
}

/** History from the local cache, refreshed from the server when the loan's version changes. */
export function useLoanVersions(loan: LocalLoan | null | undefined) {
  const id = loan?.id;
  const version = loan?.version;
  const pendingCreate = loan?.pending && loan.shareToken === null;

  useEffect(() => {
    if (!id || pendingCreate) return;
    void (async () => {
      try {
        const versions = await supabaseRemote.fetchVersions(id);
        await (await getStore()).saveVersions(versions);
      } catch {
        // Offline: the cached history is shown.
      }
    })();
  }, [id, version, pendingCreate]);

  return useQuery({
    queryKey: ['local', 'versions', id],
    queryFn: async () => (await getStore()).listVersions(id!),
    enabled: !!id,
    networkMode: 'always',
  });
}

export function usePeople() {
  return useQuery({
    queryKey: ['local', 'people'],
    queryFn: async () => (await getStore()).listPeople(),
    networkMode: 'always',
  });
}

/**
 * The name to show for the other person. For records I wrote, it's the name I
 * typed; for records someone else wrote about me, it's their profile name.
 */
export function otherPartyName(loan: Loan, userId: string, people: Person[] | undefined): string {
  if (loan.creatorId === userId) return loan.counterpartyName;
  return people?.find((p) => p.id === loan.creatorId)?.displayName ?? '…';
}

export const shareUrl = (token: string) => `${brand.webBaseUrl.replace(/\/$/, '')}/c/#${token}`;

/**
 * Open the share sheet with a friendly message and the confirmation link,
 * written in the other person's language when we know it (they have an
 * account), otherwise in mine.
 */
export async function shareLoan(loan: LocalLoan, userId: string, people: Person[] | undefined) {
  if (!loan.shareToken) return;
  const other = otherPartyId(loan, userId);
  const language = people?.find((p) => p.id === other)?.language ?? i18n.language;
  const t = i18n.getFixedT(language);
  const fmt = formatContextForLanguage(language);
  const message = t(directionFor(loan, userId) === 'lent' ? 'share.messageLent' : 'share.messageBorrowed', {
    name: loan.counterpartyName,
    amount: formatMoney(loan.amountMinor, loan.currency, fmt),
    date: formatDate(loan.loanDate, fmt),
    url: shareUrl(loan.shareToken),
  });
  await Share.share({ message });
}

/** Confirm or dispute as the other party (needs the network). */
export async function answerLoan(loanId: string, action: 'confirm' | 'dispute', comment: string | null) {
  await respondToLoan(loanId, action, comment);
  await syncNow();
}

/** Link a shared record to my account, then fetch it. Returns its id. */
export async function claimLoan(token: string): Promise<string> {
  const id = await claimSharedLoan(token);
  await syncNow();
  // A sync that was already running may have missed it; one more pass fetches it.
  if (!(await (await getStore()).getLoan(id))) await syncNow();
  return id;
}

export function useRepayments(loanId: string | undefined) {
  return useQuery({
    queryKey: ['local', 'repayments', loanId],
    queryFn: async () => (await getStore()).listRepayments(loanId!),
    enabled: !!loanId,
    networkMode: 'always',
  });
}

/** Record a repayment (works offline). */
export async function addRepayment(
  loan: Loan,
  userId: string,
  v: { amountMinor: number; paidOn: string; note: string },
): Promise<void> {
  const now = new Date().toISOString();
  const status = initialRepaymentStatus(userId, loan.lenderId);
  const repayment: Repayment = {
    id: Crypto.randomUUID(),
    loanId: loan.id,
    amountMinor: v.amountMinor,
    paidOn: v.paidOn,
    note: v.note.trim(),
    createdBy: userId,
    status,
    respondedBy: status === 'confirmed' ? userId : null,
    responseComment: null,
    createdAt: now,
    updatedAt: now,
  };
  await (await getStore()).createRepayment(repayment);
  requestSync();
}

export async function withdrawRepayment(id: string) {
  await (await getStore()).cancelRepayment(id);
  requestSync();
}

/** The lender confirms or disputes a repayment (needs the network). */
export async function answerRepayment(id: string, action: 'confirm' | 'dispute', comment: string | null) {
  await respondToRepayment(id, action, comment);
  await syncNow();
}

/**
 * Send a reminder. If the borrower has the app it's a notification;
 * otherwise the share sheet opens with the message (in my language: we don't
 * know theirs). The server allows one every 48 hours either way.
 */
export async function remind(loan: LocalLoan, tone: Tone, remainingMinor: number): Promise<ReminderResult> {
  const channel = loan.borrowerId ? 'push' : 'share';
  const result = await sendReminder(loan.id, tone, channel);
  if (result.ok && channel === 'share') {
    const fmt = formatContextForLanguage(i18n.language);
    const message = reminderMessage(
      tone,
      { greetName: loan.counterpartyName, amountMinor: remainingMinor, currency: loan.currency, loanDate: loan.loanDate },
      (k, p) => i18n.t(k, p),
      fmt,
    );
    await Share.share({ message });
  }
  return result;
}


// ---------- Writes ----------

export async function createLoan(draft: LoanDraft, userId: string): Promise<string> {
  const now = new Date().toISOString();
  const loan: Loan = {
    id: Crypto.randomUUID(),
    creatorId: userId,
    lenderId: draft.direction === 'lent' ? userId : null,
    borrowerId: draft.direction === 'borrowed' ? userId : null,
    counterpartyName: draft.counterpartyName.trim(),
    counterpartyPhone: draft.counterpartyPhone,
    amountMinor: draft.amountMinor!,
    currency: draft.currency,
    note: draft.note.trim(),
    loanDate: draft.loanDate,
    dueDate: draft.dueDate,
    photoPath: null,
    autoRemind: draft.autoRemind,
    status: 'pending',
    shareToken: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  await (await getStore()).createLoan(loan);
  requestSync();
  return loan.id;
}

export async function editLoan(id: string, patch: LoanPatch) {
  const result = await (await getStore()).editLoan(id, patch);
  requestSync();
  return result;
}

export const cancelLoan = (id: string) => editLoan(id, { status: 'cancelled' });

const photoDir = () => new Directory(Paths.document, 'loan-photos');

/**
 * Keep a copy of the picked photo inside the app (the picker's file can be
 * deleted by the system) and queue it for upload.
 */
export async function attachPhoto(loanId: string, pickedUri: string) {
  const dir = photoDir();
  if (!dir.exists) dir.create({ intermediates: true });
  const ext = /\.(png|webp)$/i.exec(pickedUri)?.[1]?.toLowerCase() ?? 'jpg';
  const dest = new File(dir, `${loanId}-${Date.now()}.${ext}`);
  await new File(pickedUri).copy(dest);
  await (await getStore()).setPhoto(loanId, dest.uri);
  requestSync();
}

/** Remove the photo: drops an unsent one, or records the removal (history keeps the old one). */
export async function removePhoto(loan: LocalLoan) {
  const store = await getStore();
  await store.discardLocalPhoto(loan.id);
  if (loan.photoPath) await editLoan(loan.id, { photoPath: null });
}

/** A short-lived URL for a loan photo stored on the server. */
export function useLoanPhotoUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: ['loan-photo', path],
    enabled: !!path,
    staleTime: 50 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from('loan-photos').createSignedUrl(path!, 60 * 60);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}
