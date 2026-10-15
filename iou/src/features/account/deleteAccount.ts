// Delete my account and everything in it. The server side (files, records,
// the auth user) is the delete-account Edge Function; then this phone forgets
// everything too.
import { clearLocalData } from '@/features/loans/service';
import { forgetPushToken } from '@/features/notifications/push';
import { supabase } from '@/lib/supabase';

export async function deleteMyAccount(): Promise<void> {
  const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
  if (error) throw error;
  // The session is already invalid on the server; clear it locally without a network call.
  await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
  await forgetPushToken();
  await clearLocalData();
}
