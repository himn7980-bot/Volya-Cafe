import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Banner, Button, Screen, TextField } from '@/components/ui';
import { isValidEmail, normalizePhone, sendEmailLink, sendPhoneCode, signInWithGoogle } from '@/features/auth/auth';
import { usePrefs } from '@/i18n';
import { minTapSize, radius, space, useColors } from '@/theme';

type Method = 'phone' | 'email';

export default function SignIn() {
  const { t } = useTranslation();
  const prefs = usePrefs();
  const [method, setMethod] = useState<Method>('phone');
  const [value, setValue] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'send' | 'google' | null>(null);

  async function send() {
    setError(null);
    const contact = method === 'phone' ? normalizePhone(value) : isValidEmail(value) ? value.trim() : null;
    if (!contact) {
      setFieldError(t(method === 'phone' ? 'auth.invalidPhone' : 'auth.invalidEmail'));
      return;
    }
    setFieldError(null);
    setBusy('send');
    try {
      if (method === 'phone') await sendPhoneCode(contact, prefs);
      else await sendEmailLink(contact, prefs);
      router.push({ pathname: '/verify', params: { kind: method, contact } });
    } catch {
      setError(t('common.somethingWrong'));
    } finally {
      setBusy(null);
    }
  }

  async function google() {
    setError(null);
    setBusy('google');
    try {
      await signInWithGoogle();
    } catch {
      setError(t('common.somethingWrong'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ gap: space.sm, paddingTop: space.xl }}>
        <AppText variant="title">{t('auth.title')}</AppText>
        <AppText muted>{t('auth.subtitle')}</AppText>
      </View>

      <Tabs
        value={method}
        onChange={(m) => {
          setMethod(m);
          setValue('');
          setFieldError(null);
        }}
        options={[
          { value: 'phone', label: t('auth.phoneTab') },
          { value: 'email', label: t('auth.emailTab') },
        ]}
      />

      {method === 'phone' ? (
        <TextField
          key="phone"
          label={t('auth.phoneLabel')}
          placeholder={t('auth.phonePlaceholder')}
          hint={t('auth.phoneHint')}
          error={fieldError}
          value={value}
          onChangeText={setValue}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          ltr
          returnKeyType="send"
          onSubmitEditing={send}
        />
      ) : (
        <TextField
          key="email"
          label={t('auth.emailLabel')}
          placeholder={t('auth.emailPlaceholder')}
          error={fieldError}
          value={value}
          onChangeText={setValue}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          ltr
          returnKeyType="send"
          onSubmitEditing={send}
        />
      )}

      {error ? <Banner tone="error" text={error} /> : null}

      <Button
        title={t(method === 'phone' ? 'auth.sendCode' : 'auth.sendLink')}
        onPress={send}
        loading={busy === 'send'}
        disabled={!!busy}
      />

      <Divider label={t('auth.or')} />

      <Button
        title={t('auth.google')}
        variant="secondary"
        icon="logo-google"
        onPress={google}
        loading={busy === 'google'}
        disabled={!!busy}
      />

      <AppText variant="caption" muted center>
        {t('auth.privacyNote')}
      </AppText>
    </Screen>
  );
}

function Tabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  const c = useColors();
  return (
    <View accessibilityRole="tablist" style={[styles.tabs, { backgroundColor: c.surfaceAlt }]}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.value)}
            style={[styles.tab, active && { backgroundColor: c.surface, borderColor: c.border }]}
          >
            <AppText variant="label" bold={active} color={active ? c.text : c.textMuted}>
              {o.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

function Divider({ label }: { label: string }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />
      <AppText variant="caption" muted>
        {label}
      </AppText>
      <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', borderRadius: radius.md, padding: 4, gap: 4 },
  tab: {
    flex: 1,
    minHeight: minTapSize - 8,
    borderRadius: radius.md - 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
});
