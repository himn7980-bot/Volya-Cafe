import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Switch, View } from 'react-native';

import { AppText, Avatar, Row, Screen, Section } from '@/components/ui';
import { useAvatarUrl, useProfile } from '@/features/profile/api';
import { useSavePrefs } from '@/features/profile/prefs';
import { currencyName, useFormat, usePrefs } from '@/i18n';
import { brand } from '@/lib/brand';
import { todayIso, type CalendarSystem } from '@/shared/calendars';
import { formatDate, formatMoney } from '@/shared/format';
import { useSettings, type ThemePreference } from '@/stores/settings';
import { minTapSize, space, useColors } from '@/theme';

export default function Settings() {
  const { t } = useTranslation();
  const c = useColors();
  const prefs = usePrefs();
  const fmt = useFormat();
  const save = useSavePrefs();
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);
  const { data: profile } = useProfile();
  const avatarUrl = useAvatarUrl(profile?.avatar_path);

  const hasNativeDigits = prefs.language.meta.nativeDigits !== 'latn';
  const showToman = prefs.defaultCurrency === 'IRR' || prefs.language.code === 'fa';

  const calendars: { value: CalendarSystem; label: string }[] = [
    { value: 'gregory', label: t('settings.calendarGregory') },
    { value: 'persian', label: t('settings.calendarPersian') },
    { value: 'islamic', label: t('settings.calendarIslamic') },
  ];
  const themes: { value: ThemePreference; label: string }[] = [
    { value: 'system', label: t('settings.themeSystem') },
    { value: 'light', label: t('settings.themeLight') },
    { value: 'dark', label: t('settings.themeDark') },
  ];

  // A live sample so people see what their choices look like.
  const sample = `${formatDate(todayIso(), fmt)} · ${formatMoney(1250000, prefs.defaultCurrency, fmt)}`;

  return (
    <Screen>
      <Section>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingStart: space.md }}>
          <Avatar name={profile?.display_name ?? ''} uri={avatarUrl.data} size={48} />
          <View style={{ flex: 1 }}>
            <Row title={profile?.display_name ?? ''} subtitle={t('settings.profile')} onPress={() => router.push('/profile')} last />
          </View>
        </View>
      </Section>

      <AppText variant="caption" muted center accessibilityRole="text">
        {sample}
      </AppText>

      <Section title={t('settings.preferences')}>
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
          last={!showToman}
        />
        {showToman ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, minHeight: minTapSize }}>
            <View style={{ flex: 1 }}>
              <AppText variant="label">{t('settings.irrAsToman')}</AppText>
              <AppText variant="caption" muted>
                {t('settings.irrAsTomanHint')}
              </AppText>
            </View>
            <Switch
              accessibilityLabel={t('settings.irrAsToman')}
              value={prefs.irrAsToman}
              onValueChange={(v) => save({ irrAsToman: v })}
              trackColor={{ true: c.primary }}
            />
          </View>
        ) : null}
      </Section>

      {hasNativeDigits ? (
        <Section title={t('settings.digits')}>
          <Row
            title={t('settings.digitsNative')}
            subtitle={formatSampleDigits(prefs.language.meta.nativeDigits)}
            selected={prefs.digits !== 'latn'}
            onPress={() => save({ digits: 'native' })}
          />
          <Row
            title={t('settings.digitsLatin')}
            selected={prefs.digits === 'latn'}
            onPress={() => save({ digits: 'latin' })}
            last
          />
        </Section>
      ) : null}

      <Section title={t('settings.calendar')}>
        {calendars.map((cal, i) => (
          <Row
            key={cal.value}
            title={cal.label}
            selected={prefs.calendar === cal.value}
            onPress={() => save({ calendar: cal.value })}
            last={i === calendars.length - 1}
          />
        ))}
      </Section>

      <Section title={t('settings.appearance')}>
        {themes.map((th, i) => (
          <Row
            key={th.value}
            title={th.label}
            selected={theme === th.value}
            onPress={() => setTheme(th.value)}
            last={i === themes.length - 1}
          />
        ))}
      </Section>

      <AppText variant="caption" muted center>
        {brand.name} · {t('settings.version', { version: Constants.expoConfig?.version ?? '1.0.0' })}
      </AppText>
    </Screen>
  );
}

function formatSampleDigits(system: string): string {
  const zero = { arab: 0x660, arabext: 0x6f0, deva: 0x966, beng: 0x9e6 }[system];
  return zero ? Array.from({ length: 10 }, (_, i) => String.fromCharCode(zero + i)).join(' ') : '';
}
