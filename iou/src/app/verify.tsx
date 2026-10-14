import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText, Banner, Button, Screen, TextField } from '@/components/ui';
import { sendEmailLink, sendPhoneCode, verifyCode } from '@/features/auth/auth';
import { usePrefs, useFormat } from '@/i18n';
import { formatNumber } from '@/shared/format';
import { space } from '@/theme';

const RESEND_SECONDS = 60;

export default function Verify() {
  const { t } = useTranslation();
  const prefs = usePrefs();
  const fmt = useFormat();
  const { kind, contact } = useLocalSearchParams<{ kind: 'phone' | 'email'; contact: string }>();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      await verifyCode(kind, contact, code);
      // The session listener switches to the signed-in screens.
    } catch {
      setError(t('auth.invalidCode'));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    try {
      if (kind === 'phone') await sendPhoneCode(contact, prefs);
      else await sendEmailLink(contact, prefs);
      setWait(RESEND_SECONDS);
    } catch {
      setError(t('common.somethingWrong'));
    }
  }

  // Keep the number/email itself left-to-right inside RTL sentences.
  const shownContact = `⁦${contact}⁩`;

  return (
    <Screen
      footer={
        <>
          <Button title={t('auth.verify')} onPress={verify} loading={busy} disabled={code.trim().length < 6} />
          <Button
            title={wait > 0 ? t('auth.resendIn', { seconds: formatNumber(wait, fmt) }) : t('auth.resend')}
            variant="ghost"
            onPress={resend}
            disabled={wait > 0}
          />
          <Button title={t('auth.changeContact')} variant="ghost" onPress={() => router.back()} />
        </>
      }
    >
      <View style={{ gap: space.sm }}>
        <AppText variant="title">{t('auth.codeLabel')}</AppText>
        <AppText muted>
          {kind === 'phone'
            ? t('auth.codeSentPhone', { phone: shownContact })
            : t('auth.codeSentEmail', { email: shownContact })}
        </AppText>
      </View>
      <TextField
        label={t('auth.codeLabel')}
        value={code}
        onChangeText={(v) => setCode(v.slice(0, 10))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete={kind === 'phone' ? 'sms-otp' : 'one-time-code'}
        autoFocus
        ltr
        style={{ fontSize: 28, letterSpacing: 8, textAlign: 'center' }}
        returnKeyType="done"
        onSubmitEditing={verify}
      />
      {error ? <Banner tone="error" text={error} /> : null}
    </Screen>
  );
}
