import { router, Stack } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, View } from 'react-native';

import { useStackOptions } from '@/components/navigation';
import { AppText, Button, Screen } from '@/components/ui';
import { signOut } from '@/features/auth/auth';
import { claimLoan, useSyncLoop } from '@/features/loans/service';
import { usePush } from '@/features/notifications/push';
import { useProfile } from '@/features/profile/api';
import { useReconcilePrefs } from '@/features/profile/prefs';
import { useSettings } from '@/stores/settings';
import { space, useColors } from '@/theme';

export default function AppLayout() {
  const { t } = useTranslation();
  const c = useColors();
  const stackOptions = useStackOptions();
  const profile = useProfile();
  useReconcilePrefs(profile.data);
  // Loans are local-first: keep syncing even before the profile has loaded.
  useSyncLoop(true);
  usePush(true);

  // A share link opened in the app (maybe before signing in): link it now.
  const pendingClaim = useSettings((s) => s.pendingClaim);
  const ready = !!profile.data?.display_name.trim();
  useEffect(() => {
    if (!pendingClaim || !ready) return;
    useSettings.getState().setPendingClaim(null);
    claimLoan(pendingClaim)
      .then((id) => router.push({ pathname: '/loans/[id]', params: { id } }))
      .catch(() => Alert.alert(t('loans.detailTitle'), t('claim.failed')));
  }, [pendingClaim, ready, t]);

  if (!profile.data) {
    return (
      <Screen edges={['top', 'bottom']} scroll={false}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg }}>
          {profile.isError ? (
            <>
              <AppText center>{t('common.somethingWrong')}</AppText>
              <Button title={t('common.retry')} onPress={() => void profile.refetch()} />
              <Button title={t('profile.signOut')} variant="ghost" onPress={() => void signOut()} />
            </>
          ) : (
            <ActivityIndicator size="large" color={c.primary} />
          )}
        </View>
      </Screen>
    );
  }

  const needsName = !profile.data.display_name.trim();

  return (
    <Stack screenOptions={stackOptions}>
      <Stack.Protected guard={needsName}>
        <Stack.Screen name="setup-name" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!needsName}>
        <Stack.Screen name="index" />
        <Stack.Screen name="profile" options={{ title: t('profile.title') }} />
        <Stack.Screen name="settings/index" options={{ title: t('settings.title') }} />
        <Stack.Screen name="settings/language" options={{ title: t('settings.language') }} />
        <Stack.Screen name="settings/currency" options={{ title: t('currency.title') }} />
        <Stack.Screen name="loans/new" options={{ title: t('loans.newRecord') }} />
        <Stack.Screen name="loans/[id]/index" options={{ title: t('loans.detailTitle') }} />
        <Stack.Screen name="loans/[id]/edit" options={{ title: t('loans.editTitle') }} />
        <Stack.Screen name="loans/[id]/repay" options={{ title: t('repayments.screenTitle') }} />
      </Stack.Protected>
    </Stack>
  );
}
