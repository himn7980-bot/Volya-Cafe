import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Image, Modal, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Banner, Button, Icon, Row, Screen, Section } from '@/components/ui';
import { useSession } from '@/features/auth/auth';
import { amountColor, LoanTimeline, StatusChip } from '@/features/loans/components';
import {
  answerLoan,
  cancelLoan,
  otherPartyName,
  shareLoan,
  useLoan,
  useLoanPhotoUrl,
  useLoanVersions,
  usePeople,
  useRepayments,
  useSyncStatus,
} from '@/features/loans/service';
import { BalanceBar, CommentSheet, ReminderSheet, RepaymentsSection } from '@/features/loans/repaymentsUI';
import { useFormat } from '@/i18n';
import { balanceOf } from '@/shared/balance';
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
  const { data: people } = usePeople();
  const [photoOpen, setPhotoOpen] = useState(false);
  const [disputing, setDisputing] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [reminding, setReminding] = useState(false);
  const { data: repayments = [] } = useRepayments(id);

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
  const name = otherPartyName(loan, uid, people);
  const waiting = loan.status === 'pending' || loan.status === 'disputed';
  const balance = balanceOf(loan.amountMinor, repayments);
  const iAmLender = loan.lenderId === uid;
  const canRemind = iAmLender && loan.status === 'confirmed' && balance.remaining > 0;
  // The reminder greets the borrower: by my label if I wrote the record, else by their profile name.
  const greetName = isCreator ? loan.counterpartyName : name;

  async function answer(action: 'confirm' | 'dispute', comment: string | null) {
    setAnswering(true);
    try {
      await answerLoan(loan!.id, action, comment);
      setDisputing(false);
      Alert.alert(t('loans.detailTitle'), t('answer.sent', { name }));
    } catch {
      Alert.alert(t('loans.detailTitle'), t(online ? 'common.somethingWrong' : 'common.offline'));
    } finally {
      setAnswering(false);
    }
  }
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
          {loan.status === 'confirmed' || loan.status === 'settled' || balance.repaid > 0 ? (
            <BalanceBar balance={balance} currency={loan.currency} />
          ) : null}
          {loan.pending ? (
            <View style={{ flexDirection: 'row', gap: space.xs, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="cloud-upload-outline" size={18} color={c.textMuted} />
              <AppText variant="caption" muted>
                {t('loans.notSynced')}
              </AppText>
            </View>
          ) : null}
        </View>

        {isCreator && waiting ? (
          <View style={[styles.box, { backgroundColor: c.primarySoft }]}>
            {loan.shareToken ? (
              <>
                <Button title={t('share.button', { name })} icon="share-outline" onPress={() => void shareLoan(loan, uid, people)} />
                <AppText variant="caption" center>
                  {t('share.hint')}
                </AppText>
              </>
            ) : (
              <AppText variant="caption" center>
                {t('share.notReady')}
              </AppText>
            )}
          </View>
        ) : null}

        {!isCreator && waiting ? (
          <View style={[styles.box, { backgroundColor: c.primarySoft }]}>
            <AppText variant="label" bold center>
              {t('answer.title', { name })}
            </AppText>
            <Button title={t('web.confirm')} icon="checkmark-circle-outline" onPress={() => void answer('confirm', null)} loading={answering} />
            {loan.status === 'pending' ? (
              <Button title={t('web.dispute')} variant="secondary" onPress={() => setDisputing(true)} disabled={answering} />
            ) : null}
          </View>
        ) : null}

        {canRemind ? (
          <Button title={t('reminders.button')} variant="secondary" icon="notifications-outline" onPress={() => setReminding(true)} />
        ) : null}

        <RepaymentsSection
          loan={loan}
          repayments={repayments}
          userId={uid}
          name={name}
          online={online}
          canAdd={loan.status === 'confirmed' && balance.maxNewRepayment > 0 && (iAmLender || loan.borrowerId === uid)}
        />

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

      <CommentSheet
        visible={disputing}
        title={t('web.disputeLabel')}
        placeholder={t('web.disputePlaceholder')}
        busy={answering}
        onClose={() => setDisputing(false)}
        onSend={(comment) => void answer('dispute', comment)}
      />
      <ReminderSheet
        visible={reminding}
        loan={loan}
        remainingMinor={balance.remaining}
        greetName={greetName}
        name={name}
        onClose={() => setReminding(false)}
      />

      <Modal visible={photoOpen} transparent animationType="fade" onRequestClose={() => setPhotoOpen(false)}>
        <Pressable style={styles.viewer} onPress={() => setPhotoOpen(false)} accessibilityLabel={t('common.close')}>
          {photoUri ? <Image source={{ uri: photoUri }} style={{ width: '100%', height: '80%' }} resizeMode="contain" /> : null}
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.lg, padding: space.md, gap: space.sm },
  hero: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: space.lg, gap: space.sm },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
});
