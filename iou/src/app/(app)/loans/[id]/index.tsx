import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Image, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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
  useSyncStatus,
} from '@/features/loans/service';
import { useFormat } from '@/i18n';
import { todayIso } from '@/shared/calendars';
import { formatDate, formatMoney } from '@/shared/format';
import { directionFor, isClosed } from '@/shared/loans';
import { minTapSize, radius, space, useColors, useFontFamily } from '@/theme';

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

      <DisputeSheet
        visible={disputing}
        busy={answering}
        onClose={() => setDisputing(false)}
        onSend={(comment) => void answer('dispute', comment)}
      />

      <Modal visible={photoOpen} transparent animationType="fade" onRequestClose={() => setPhotoOpen(false)}>
        <Pressable style={styles.viewer} onPress={() => setPhotoOpen(false)} accessibilityLabel={t('common.close')}>
          {photoUri ? <Image source={{ uri: photoUri }} style={{ width: '100%', height: '80%' }} resizeMode="contain" /> : null}
        </Pressable>
      </Modal>
    </>
  );
}

function DisputeSheet({
  visible,
  busy,
  onClose,
  onSend,
}: {
  visible: boolean;
  busy: boolean;
  onClose: () => void;
  onSend: (comment: string) => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const fontFamily = useFontFamily();
  const [comment, setComment] = useState('');
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.close')} />
      <SafeAreaView edges={['bottom']} style={[styles.sheet, { backgroundColor: c.surface }]}>
        <AppText variant="heading">{t('web.disputeLabel')}</AppText>
        <TextInput
          accessibilityLabel={t('web.disputeLabel')}
          value={comment}
          onChangeText={setComment}
          placeholder={t('web.disputePlaceholder')}
          placeholderTextColor={c.textMuted}
          multiline
          maxLength={500}
          autoFocus
          style={[styles.comment, { color: c.text, borderColor: c.border, backgroundColor: c.background, fontFamily }]}
        />
        <Button title={t('web.sendDispute')} onPress={() => onSend(comment.trim())} disabled={!comment.trim()} loading={busy} />
        <Button title={t('common.cancel')} variant="ghost" onPress={onClose} />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.lg, padding: space.md, gap: space.sm },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { borderTopStartRadius: radius.lg, borderTopEndRadius: radius.lg, padding: space.md, gap: space.md },
  comment: { minHeight: 120, borderWidth: 1.5, borderRadius: radius.md, padding: space.md, fontSize: 18, textAlignVertical: 'top' },
  hero: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: space.lg, gap: space.sm },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
});
