import { useTranslation } from 'react-i18next';

import { AppText, Row, Screen, Section } from '@/components/ui';
import { useSavePrefs } from '@/features/profile/prefs';
import { LANGUAGES, usePrefs } from '@/i18n';
import { changeLanguage } from '@/i18n/useChangeLanguage';

export default function LanguageSettings() {
  const { t } = useTranslation();
  const prefs = usePrefs();
  const save = useSavePrefs();

  return (
    <Screen>
      <AppText muted>{t('onboarding.languageHint')}</AppText>
      <Section>
        {LANGUAGES.map((lang, i) => (
          <Row
            key={lang.code}
            title={lang.meta.nativeName}
            subtitle={lang.meta.nativeName === lang.meta.name ? undefined : lang.meta.name}
            selected={lang.code === prefs.language.code}
            last={i === LANGUAGES.length - 1}
            onPress={() => {
              if (lang.code === prefs.language.code) return;
              // Save to the profile first: a direction change restarts the app.
              save({ language: lang.code });
              void changeLanguage(lang.code, { confirm: true });
            }}
          />
        ))}
      </Section>
    </Screen>
  );
}
