import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText, Banner, Button, Screen, TextField } from '@/components/ui';
import { useUpdateProfile } from '@/features/profile/api';
import { space } from '@/theme';

/** Shown once after the first sign-in. */
export default function SetupName() {
  const { t } = useTranslation();
  const update = useUpdateProfile();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('profile.nameRequired'));
      return;
    }
    setError(null);
    update.mutate({ display_name: trimmed.slice(0, 80) });
  }

  return (
    <Screen
      edges={['top', 'bottom']}
      footer={<Button title={t('common.continue')} onPress={save} loading={update.isPending} />}
    >
      <View style={{ gap: space.sm, paddingTop: space.xl }}>
        <AppText variant="title">{t('profile.setupTitle')}</AppText>
        <AppText muted>{t('profile.setupBody')}</AppText>
      </View>
      <TextField
        label={t('profile.displayName')}
        placeholder={t('profile.displayNamePlaceholder')}
        value={name}
        onChangeText={setName}
        error={error}
        autoFocus
        autoComplete="name"
        textContentType="name"
        maxLength={80}
        returnKeyType="done"
        onSubmitEditing={save}
      />
      {update.isError ? <Banner tone="error" text={t('common.somethingWrong')} /> : null}
    </Screen>
  );
}
