import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, View } from 'react-native';

import { Avatar, Banner, Button, Row, Screen, Section, TextField } from '@/components/ui';
import { signOut } from '@/features/auth/auth';
import { useSyncStatus } from '@/features/loans/service';
import { useAvatarUrl, useChangeAvatar, useProfile, useRemoveAvatar, useUpdateProfile } from '@/features/profile/api';
import { currencyName, usePrefs } from '@/i18n';
import { space } from '@/theme';

export default function Profile() {
  const { t } = useTranslation();
  const prefs = usePrefs();
  const { data: profile } = useProfile();
  const update = useUpdateProfile();
  const avatarUrl = useAvatarUrl(profile?.avatar_path);
  const changeAvatar = useChangeAvatar();
  const removeAvatar = useRemoveAvatar();
  const [name, setName] = useState(profile?.display_name ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!profile) return null;

  function saveName() {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(t('profile.nameRequired'));
      return;
    }
    setNameError(null);
    update.mutate({ display_name: trimmed.slice(0, 80) }, { onSuccess: () => setSaved(true) });
  }

  async function pickPhoto() {
    const result = await changeAvatar.mutateAsync(profile!.avatar_path).catch(() => null);
    if (result === 'denied') Alert.alert(t('profile.photo'), t('profile.photoPermission'));
  }

  function confirmSignOut() {
    const unsent = useSyncStatus.getState().pending > 0;
    Alert.alert(t('profile.signOut'), unsent ? t('sync.signOutPending') : t('profile.signOutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('profile.signOut'), style: 'destructive', onPress: () => void signOut() },
    ]);
  }

  const nameChanged = name.trim() !== profile.display_name;

  return (
    <Screen>
      <View style={{ alignItems: 'center', gap: space.sm }}>
        <Avatar name={profile.display_name} uri={avatarUrl.data} size={96} />
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button
            title={profile.avatar_path ? t('profile.changePhoto') : t('profile.addPhoto')}
            variant="ghost"
            icon="camera-outline"
            onPress={pickPhoto}
            loading={changeAvatar.isPending}
          />
          {profile.avatar_path ? (
            <Button
              title={t('profile.removePhoto')}
              variant="ghost"
              onPress={() => removeAvatar.mutate(profile.avatar_path!)}
              loading={removeAvatar.isPending}
            />
          ) : null}
        </View>
      </View>

      <TextField
        label={t('profile.displayName')}
        value={name}
        onChangeText={(v) => {
          setName(v);
          setSaved(false);
        }}
        error={nameError}
        maxLength={80}
        autoComplete="name"
        textContentType="name"
        returnKeyType="done"
        onSubmitEditing={saveName}
      />
      {nameChanged ? <Button title={t('common.save')} onPress={saveName} loading={update.isPending} /> : null}
      {saved && !nameChanged ? <Banner text={t('common.saved')} /> : null}
      {update.isError || changeAvatar.isError ? <Banner tone="error" text={t('common.somethingWrong')} /> : null}

      <Section>
        <Row title={t('profile.phone')} value={profile.phone ? `⁦${profile.phone}⁩` : t('profile.notSet')} />
        <Row title={t('profile.email')} value={profile.email ?? t('profile.notSet')} last />
      </Section>

      <Section>
        <Row
          icon="language-outline"
          title={t('settings.language')}
          value={prefs.language.meta.nativeName}
          onPress={() => router.push('/settings/language')}
        />
        <Row
          icon="cash-outline"
          title={t('settings.defaultCurrency')}
          value={currencyName(prefs.defaultCurrency, prefs.language.code)}
          onPress={() => router.push('/settings/currency')}
          last
        />
      </Section>

      <Button title={t('profile.signOut')} variant="danger" icon="log-out-outline" onPress={confirmSignOut} />
    </Screen>
  );
}
