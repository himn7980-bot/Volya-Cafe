import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText, Avatar, Button } from '@/components/ui';
import { useSession } from '@/features/auth/auth';
import { LoanCard } from '@/features/loans/components';
import { otherPartyName, useLoans, usePeople } from '@/features/loans/service';
import { NetLines } from '@/features/loans/summaryUI';
import { isClosed } from '@/shared/loans';
import { groupByPerson } from '@/shared/people';
import { radius, space, useColors } from '@/theme';

/** Everything between me and one person: the balance per currency and every record. */
export default function PersonScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const { t } = useTranslation();
  const c = useColors();
  const uid = useSession((s) => s.session?.user.id)!;
  const { data: loans = [] } = useLoans();
  const { data: people } = usePeople();

  const person = useMemo(() => groupByPerson(loans, uid, people).find((p) => p.key === key), [loans, uid, people, key]);
  const records = useMemo(() => {
    const ids = new Set(person?.loanIds);
    // Open ones first, newest first inside each group (loans are already newest first).
    return loans.filter((l) => ids.has(l.id)).sort((a, b) => Number(isClosed(a.status)) - Number(isClosed(b.status)));
  }, [loans, person]);

  if (!person) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg, backgroundColor: c.background }}>
        <AppText muted center>
          {t('dashboard.allSettled')}
        </AppText>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: person.name }} />
      <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: c.background }}>
        <FlatList
          data={records}
          keyExtractor={(l) => l.id}
          contentContainerStyle={{ padding: space.md, gap: space.sm }}
          ListHeaderComponent={
            <View
              style={{
                alignItems: 'center',
                gap: space.sm,
                padding: space.lg,
                marginBottom: space.sm,
                borderRadius: radius.lg,
                borderWidth: 1,
                borderColor: c.border,
                backgroundColor: c.surface,
              }}
            >
              <Avatar name={person.name} size={64} />
              <AppText variant="title" center>
                {person.name}
              </AppText>
              <NetLines net={person.net} center />
            </View>
          }
          renderItem={({ item }) => (
            <LoanCard
              loan={item}
              userId={uid}
              name={otherPartyName(item, uid, people)}
              onPress={() => router.push({ pathname: '/loans/[id]', params: { id: item.id } })}
            />
          )}
        />
        <View style={{ paddingHorizontal: space.md, paddingBottom: space.md }}>
          <Button title={t('loans.newRecord')} icon="add-circle-outline" onPress={() => {
              // Prefill from a record I wrote to this person, so the new one lands on the same page.
              const mine = records.find((l) => l.creatorId === uid);
              router.push({
                pathname: '/loans/new',
                params: mine ? { name: mine.counterpartyName, phone: mine.counterpartyPhone ?? '' } : { name: person.name },
              });
            }}
          />
        </View>
      </SafeAreaView>
    </>
  );
}
