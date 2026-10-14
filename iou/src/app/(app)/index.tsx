import { Link, router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText, Banner, Button, Icon } from '@/components/ui';
import { useSession } from '@/features/auth/auth';
import { LoanCard } from '@/features/loans/components';
import { otherPartyName, syncNow, useLoans, usePeople, useSyncStatus } from '@/features/loans/service';
import { useProfile } from '@/features/profile/api';
import { brand } from '@/lib/brand';
import { isClosed } from '@/shared/loans';
import { minTapSize, radius, space, useColors } from '@/theme';

/** Home: the person's records. Totals per currency arrive in phase 5. */
export default function Dashboard() {
  const { t } = useTranslation();
  const c = useColors();
  const uid = useSession((s) => s.session?.user.id)!;
  const { data: profile } = useProfile();
  const { data: loans = [] } = useLoans();
  const { data: people } = usePeople();
  const { online, pending, rejected, dismissRejected } = useSyncStatus();
  const [tab, setTab] = useState<'open' | 'closed'>('open');
  const [refreshing, setRefreshing] = useState(false);

  const shown = useMemo(() => loans.filter((l) => isClosed(l.status) === (tab === 'closed')), [loans, tab]);

  async function refresh() {
    setRefreshing(true);
    await syncNow();
    setRefreshing(false);
  }

  const header = (
    <View style={{ gap: space.md, marginBottom: space.md }}>
      <AppText variant="title">{t('dashboard.greeting', { name: profile?.display_name ?? '' })}</AppText>
      {rejected > 0 ? (
        <Pressable onPress={dismissRejected} accessibilityRole="button" accessibilityHint={t('common.close')}>
          <Banner tone="error" text={t('sync.rejected')} />
        </Pressable>
      ) : null}
      {!online && pending > 0 ? <Banner text={t('common.offline')} /> : null}
      {loans.length > 0 ? (
        <View accessibilityRole="tablist" style={[styles.tabs, { backgroundColor: c.surfaceAlt }]}>
          {(['open', 'closed'] as const).map((key) => (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === key }}
              onPress={() => setTab(key)}
              style={[styles.tab, tab === key && { backgroundColor: c.surface, borderColor: c.border }]}
            >
              <AppText variant="label" bold={tab === key} color={tab === key ? c.text : c.textMuted}>
                {t(`loans.${key}`)}
              </AppText>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );

  const empty =
    loans.length === 0 ? (
      <View style={[styles.empty, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Icon name="people-outline" size={48} color={c.primary} />
        <AppText variant="heading" center>
          {t('dashboard.emptyTitle')}
        </AppText>
        <AppText muted center>
          {t('dashboard.emptyBody')}
        </AppText>
      </View>
    ) : (
      <AppText muted center>
        {tab === 'closed' ? t('loans.emptyClosed') : t('dashboard.emptyTitle')}
      </AppText>
    );

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
      <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: c.background }}>
        <FlatList
          data={shown}
          keyExtractor={(l) => l.id}
          contentContainerStyle={{ padding: space.md, gap: space.sm, flexGrow: 1 }}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          renderItem={({ item }) => (
            <LoanCard loan={item} userId={uid} name={otherPartyName(item, uid, people)} onPress={() => router.push({ pathname: '/loans/[id]', params: { id: item.id } })} />
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.primary} />}
        />
        <View style={{ paddingHorizontal: space.md, paddingBottom: space.md }}>
          <Button title={t('loans.newRecord')} icon="add-circle-outline" onPress={() => router.push('/loans/new')} />
        </View>
      </SafeAreaView>
    </>
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
  empty: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.md,
    alignItems: 'center',
  },
});
