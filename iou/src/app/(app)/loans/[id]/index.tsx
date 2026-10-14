import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Image, Modal, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Banner, Button, Icon, Row, Screen, Section } from '@/components/ui';
import { useSession } from '@/features/auth/auth';
import { amountColor, LoanTimeline, StatusChip } from '@/features/loans/components';
import { cancelLoan, useLoan, useLoanPhotoUrl, useLoanVersions, useSyncStatus } from '@/features/loans/service';
import { useFormat } from '@/i18n';
import { todayIso } from '@/shared/calendars';
import { formatDate, formatMoney } from '@/shared/format';
import { directionFor, isClosed } from '@/shared/loans';
import { minTapSize, radius, space, useColors } from '@/theme';

export default function LoanDetail() {
  const { t } = useTranslation();
  const c = useColors();
  const fmt = useFormat();
  const { id } = useLocalSearchParams<{ id: string }>();
  const uid = useSession((s) => s.session?.user.id)!;
  const online = useSyncStatus((s) => s.online);
  const { data: loan, isPending } = useLoan(id);
  const versions = useLoanVersions(loan);
  const remotePhoto = useLoanPhotoUrl(loan?.localPhotoUri ? null : loan?.photoPath);
  const [photoOpen, setPhotoOpen] = useState(false);

  if (isPending) return null;
  if (!loan) {
    // e.g. an unsent record was cancelled and removed
    return (
      <Screen>
        <AppText muted center>
          {t('status.cancelled')}
        </AppText>
      </Screen>
    );
  }

  const lent = directionFor(loan, uid) === 'lent';
  const isCreator = loan.creatorId === uid;
  const canEdit = isCreator && !isClosed(loan.status);
  const name = loan.counterpartyName;
  const photoUri = loan.localPhotoUri ?? remotePhoto.data ?? null;
  const overdue = !!loan.dueDate && loan.dueDate < todayIso() && !isClosed(loan.status);

  function confirmCancel() {
    Alert.alert(t('loans.cancelTitle'), t('loans.cancelBody'), [
      { text: t('loans.keep'), style: 'cancel' },
      {
        text: t('loans.cancelRecord'),
        style: 'destructive',
        onPress: () => {
          void cancelLoan(loan!.id).then((left) => {
            if (!left) router.back();
          });
        },
      },
    ]);
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: t('loans.detailTitle'),
          headerRight: canEdit
            ? () => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('loans.edit')}
                  onPress={() => router.push({ pathname: '/loans/[id]/edit', params: { id: loan.id } })}
                  style={{ minHeight: minTapSize, minWidth: minTapSize, alignItems: 'center', justifyContent: 'center' }}
                >
                  <AppText variant="label" bold color={c.primary}>
                    {t('loans.edit')}
                  </AppText>
                </Pressable>
              )
            : undefined,
        }}
      />
      <Screen>
        <View style={[styles.hero, { backgroundColor: c.surface, borderColor: c.border }]}>
          <AppText variant="label" muted center>
            {t(lent ? 'loans.theyOweYou' : 'loans.youOwe', { name })}
          </AppText>
          <AppText variant="title" center color={amountColor(loan, uid, c)} selectable>
            {formatMoney(loan.amountMinor, loan.currency, fmt)}
          </AppText>
          <View style={{ alignItems: 'center', gap: space.xs }}>
            <StatusChip status={loan.status} />
            <AppText variant="caption" muted center>
              {t(`statusHint.${loan.status}`, { name })}
            </AppText>
          </View>
          {loan.pending ? (
            <View style={{ flexDirection: 'row', gap: space.xs, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="cloud-upload-outline" size={18} color={c.textMuted} />
              <AppText variant="caption" muted>
                {t('loans.notSynced')}
              </AppText>
            </View>
          ) : null}
        </View>

        <Section>
          <Row title={t('loans.loanDate')} value={formatDate(loan.loanDate, fmt)} />
          {loan.dueDate ? (
            <Row title={t('loans.dueDate')} value={formatDate(loan.dueDate, fmt)} subtitle={overdue ? t('loans.overdue', { date: formatDate(loan.dueDate, fmt) }) : undefined} />
          ) : null}
          {loan.counterpartyPhone ? <Row title={t('loans.phone')} value={`⁦${loan.counterpartyPhone}⁩`} /> : null}
          <Row title={t('loans.note')} subtitle={loan.note || '—'} last />
        </Section>

        {photoUri ? (
          <Pressable accessibilityRole="imagebutton" accessibilityLabel={t('loans.photo')} onPress={() => setPhotoOpen(true)}>
            <Image source={{ uri: photoUri }} style={[styles.photo, { borderColor: c.border }]} resizeMode="cover" accessibilityIgnoresInvertColors />
          </Pressable>
        ) : null}

        <View style={{ gap: space.md }}>
          <AppText variant="heading">{t('loans.history')}</AppText>
          {versions.data && versions.data.length > 0 ? (
            <LoanTimeline versions={versions.data} userId={uid} otherName={name} />
          ) : null}
          {!online || (versions.data?.length ?? 0) === 0 ? <Banner text={t('loans.historyOffline')} /> : null}
        </View>

        {canEdit ? <Button title={t('loans.cancelRecord')} variant="danger" icon="close-circle-outline" onPress={confirmCancel} /> : null}
      </Screen>

      <Modal visible={photoOpen} transparent animationType="fade" onRequestClose={() => setPhotoOpen(false)}>
        <Pressable style={styles.viewer} onPress={() => setPhotoOpen(false)} accessibilityLabel={t('common.close')}>
          {photoUri ? <Image source={{ uri: photoUri }} style={{ width: '100%', height: '80%' }} resizeMode="contain" /> : null}
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: space.lg, gap: space.sm },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
});
