import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText, Banner, Button, Icon, Row, Screen, Section } from '@/components/ui';
import { LANGUAGES, deviceLanguage } from '@/i18n';
import { changeLanguage } from '@/i18n/useChangeLanguage';
import { useSettings } from '@/stores/settings';
import { space, useColors } from '@/theme';

/**
 * First run: language first (in every language's own name, so anyone can find
 * theirs), then a short, reassuring welcome.
 */
export default function Onboarding() {
  const { t } = useTranslation();
  const chosen = useSettings((s) => s.language);
  const setOnboarded = useSettings((s) => s.setOnboarded);
  // After a direction change the app restarts; resume at the welcome step.
  const [step, setStep] = useState<'language' | 'welcome'>(chosen ? 'welcome' : 'language');
  const current = chosen ?? deviceLanguage();

  if (step === 'language') {
    return (
      <Screen edges={['top', 'bottom']}>
        <View style={{ gap: space.sm, paddingTop: space.lg }}>
          <AppText variant="title">{t('onboarding.chooseLanguage')}</AppText>
          <AppText muted>{t('onboarding.languageHint')}</AppText>
        </View>
        <Section>
          {LANGUAGES.map((lang, i) => (
            <Row
              key={lang.code}
              title={lang.meta.nativeName}
              subtitle={lang.meta.nativeName === lang.meta.name ? undefined : lang.meta.name}
              selected={lang.code === current}
              last={i === LANGUAGES.length - 1}
              onPress={() => {
                setStep('welcome');
                void changeLanguage(lang.code, { confirm: false });
              }}
            />
          ))}
        </Section>
      </Screen>
    );
  }

  return (
    <Screen
      edges={['top', 'bottom']}
      footer={
        <>
          <Button title={t('onboarding.getStarted')} onPress={() => setOnboarded(true)} />
          <Button title={t('settings.language')} variant="ghost" icon="language" onPress={() => setStep('language')} />
        </>
      }
    >
      <View style={{ gap: space.md, paddingTop: space.xl }}>
        <AppText variant="title">{t('onboarding.welcomeTitle')}</AppText>
        <AppText muted>{t('onboarding.welcomeBody')}</AppText>
      </View>
      <View style={{ gap: space.md }}>
        <Point icon="create-outline" text={t('onboarding.point1')} />
        <Point icon="checkmark-done-outline" text={t('onboarding.point2')} />
        <Point icon="notifications-outline" text={t('onboarding.point3')} />
      </View>
      <Banner text={t('onboarding.noMoneyMoves')} />
    </Screen>
  );
}

function Point({ icon, text }: { icon: 'create-outline' | 'checkmark-done-outline' | 'notifications-outline'; text: string }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: 24,
          backgroundColor: c.primarySoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} color={c.primary} />
      </View>
      <AppText style={{ flex: 1 }}>{text}</AppText>
    </View>
  );
}
