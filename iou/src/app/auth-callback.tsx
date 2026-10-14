import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { AppText, Button, Screen } from '@/components/ui';
import { completeSignInFromUrl } from '@/features/auth/auth';
import { space, useColors } from '@/theme';

/** Opened by the email magic link (iou://auth-callback?code=...) and by Google sign-in. */
export default function AuthCallback() {
  const { t } = useTranslation();
  const c = useColors();
  const url = Linking.useLinkingURL();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!url) return;
    completeSignInFromUrl(url)
      .then(() => router.replace('/'))
      .catch(() => setFailed(true));
  }, [url]);

  return (
    <Screen edges={['top', 'bottom']} scroll={false}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg }}>
        {failed ? (
          <>
            <AppText center>{t('auth.invalidCode')}</AppText>
            <Button title={t('common.back')} onPress={() => router.replace('/')} />
          </>
        ) : (
          <>
            <ActivityIndicator size="large" color={c.primary} />
            <AppText muted>{t('auth.signingIn')}</AppText>
          </>
        )}
      </View>
    </Screen>
  );
}
