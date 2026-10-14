import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { useSettings } from '@/stores/settings';

/**
 * iou://claim?token=... (the "I have the app" button on the confirmation page).
 * The token is remembered so it survives onboarding and sign-in; the signed-in
 * area links the record as soon as it can.
 */
export default function Claim() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  useEffect(() => {
    if (token && /^[0-9a-f]{64}$/.test(token)) useSettings.getState().setPendingClaim(token);
    router.replace('/');
  }, [token]);
  return null;
}
