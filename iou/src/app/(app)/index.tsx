import { Link, router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText, Banner, Button, Icon } from '@/components/ui';
import { useSession } from '@/features/auth/auth';
import { LoanCard } from '@/features/loans/components';
import { PersonRow, TotalsCard } from '@/features/loans/summaryUI';
import { otherPartyName, syncNow, useLoans, usePeople, useSyncStatus } from '@/features/loans/service';
import { useProfile } from '@/features/profile/api';
import { brand } from '@/lib/brand';
import { isClosed } from '@/shared/loans';
import { groupByPerson, totals, type PersonSummary } from '@/shared/people';
import { minTapSize, radius, space, useColors } from '@/theme';

/** Home: totals per currency, then records (open / closed) or people. */
export default function Dashboard() {
  const { t } = useTranslation();
  const c = useColors();
  const uid = useSession((s) => s.session?.user.id)!;
  const { data: profile } = useProfile();
  const { data: loans = [] } = useLoans();
  const { data: people } = usePeople();
  const { online, pending, rejected, dismissRejected } = useSyncStatus();
  const [tab, setTab] = useState<'open' | 'closed' | 'people'>('open');
  const [refreshing, setRefreshing] = useState(false);

  const shown = useMemo(() => loans.filter((l) => isClosed(l.status) === (tab === 'closed')), [loans, tab]);
  const sums = useMemo(() => totals(loans, uid), [loans, uid]);
  const persons = useMemo(() => groupByPerson(loans, uid, people), [loans, uid, people]);

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
      {loans.length > 0 ? <TotalsCard totals={sums} /> : null}
      {loans.length > 0 ? (
        <View accessibilityRole="tablist" style={[styles.tabs, { backgroundColor: c.surfaceAlt }]}>
          {(['open', 'closed', 'people'] as const).map((key) => (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === key }}
              onPress={() => setTab(key)}
              style={[styles.tab, tab === key && { backgroundColor: c.surface, borderColor: c.border }]}
            >
              <AppText variant="label" bold={tab === key} color={tab === key ? c.text : c.textMuted}>
                {key === 'people' ? t('dashboard.people') : t(`loans.${key}`)}
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
        {tab === 'closed' ? t('loans.emptyClosed') : t('dashboard.allSettled')}
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
        {tab === 'people' ? (
          <FlatList<PersonSummary>
            data={persons}
            keyExtractor={(p) => p.key}
            contentContainerStyle={{ padding: space.md, gap: space.sm, flexGrow: 1 }}
            ListHeaderComponent={header}
            ListEmptyComponent={empty}
            renderItem={({ item }) => (
              <PersonRow person={item} onPress={() => router.push({ pathname: '/person/[key]', params: { key: item.key } })} />
            )}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.primary} />}
          />
        ) : (
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
        )}
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
