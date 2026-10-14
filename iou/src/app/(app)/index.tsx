import { Link, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { AppText, Icon, Screen } from '@/components/ui';
import { useProfile } from '@/features/profile/api';
import { brand } from '@/lib/brand';
import { minTapSize, radius, space, useColors } from '@/theme';

/** Dashboard. Phase 1 shows the greeting and empty state; balances arrive in later phases. */
export default function Dashboard() {
  const { t } = useTranslation();
  const c = useColors();
  const { data: profile } = useProfile();

  return (
    <>
      <Stack.Screen
        options={{
          title: brand.name,
          headerRight: () => (
            <Link href="/settings" asChild>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('settings.title')}
                hitSlop={8}
                style={{ minWidth: minTapSize, minHeight: minTapSize, alignItems: 'center', justifyContent: 'center' }}
              >
                <Icon name="settings-outline" size={26} />
              </Pressable>
            </Link>
          ),
        }}
      />
      <Screen>
        <AppText variant="title">{t('dashboard.greeting', { name: profile?.display_name ?? '' })}</AppText>
        <View
          style={{
            backgroundColor: c.surface,
            borderColor: c.border,
            borderWidth: 1,
            borderRadius: radius.lg,
            padding: space.lg,
            gap: space.md,
            alignItems: 'center',
          }}
        >
          <Icon name="people-outline" size={48} color={c.primary} />
          <AppText variant="heading" center>
            {t('dashboard.emptyTitle')}
          </AppText>
          <AppText muted center>
            {t('dashboard.emptyBody')}
          </AppText>
        </View>
      </Screen>
    </>
  );
}
