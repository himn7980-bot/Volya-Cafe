import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText, Button, Row, Section } from '@/components/ui';
import { useFormat } from '@/i18n';
import type { Balance } from '@/shared/balance';
import { todayIso } from '@/shared/calendars';
import { toDigitSystem } from '@/shared/digits';
import { formatDate, formatMoney, type FormatContext } from '@/shared/format';
import type { Loan } from '@/shared/loans';
import { reminderMessage, type Tone } from '@/shared/notifications';
import { minTapSize, radius, space, useColors, useFontFamily } from '@/theme';

import type { LocalLoan, LocalRepayment } from './localStore';
import { answerRepayment, remind, withdrawRepayment } from './service';

// ---------- Balance ----------

export function BalanceBar({ balance, currency }: { balance: Balance; currency: string }) {
  const { t } = useTranslation();
  const c = useColors();
  const fmt = useFormat();
  return (
    <View style={{ gap: space.xs }}>
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(balance.progress * 100) }}
        style={[styles.track, { backgroundColor: c.surfaceAlt }]}
      >
        <View style={[styles.fill, { width: `${balance.progress * 100}%`, backgroundColor: c.positive }]} />
      </View>
      <AppText variant="caption" muted center>
        {t('repayments.paidOf', { paid: formatMoney(balance.repaid, currency, fmt), total: formatMoney(balance.total, currency, fmt) })}
      </AppText>
      {balance.remaining > 0 ? (
        <AppText variant="label" bold center>
          {t('repayments.remaining', { amount: formatMoney(balance.remaining, currency, fmt) })}
        </AppText>
      ) : null}
    </View>
  );
}

// ---------- Repayments list ----------

export function RepaymentsSection({
  loan,
  repayments,
  userId,
  name,
  canAdd,
  online,
}: {
  loan: Loan;
  repayments: LocalRepayment[];
  userId: string;
  name: string;
  canAdd: boolean;
  online: boolean;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const fmt = useFormat();
  const [disputing, setDisputing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const visible = repayments.filter((r) => r.status !== 'cancelled' || r.pending);
  if (!visible.length && !canAdd) return null;

  async function answer(id: string, action: 'confirm' | 'dispute', comment: string | null) {
    setBusy(true);
    try {
      await answerRepayment(id, action, comment);
      setDisputing(null);
    } catch {
      Alert.alert(t('repayments.title'), t(online ? 'common.somethingWrong' : 'repayments.needsOnline'));
    } finally {
      setBusy(false);
    }
  }

  function confirmWithdraw(id: string) {
    Alert.alert(t('repayments.withdrawTitle'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('repayments.withdraw'), style: 'destructive', onPress: () => void withdrawRepayment(id) },
    ]);
  }

  const statusColor = (s: LocalRepayment['status']) =>
    s === 'confirmed' ? c.positive : s === 'disputed' ? c.danger : c.textMuted;

  return (
    <View style={{ gap: space.sm }}>
      <AppText variant="heading">{t('repayments.title')}</AppText>
      {visible.length ? (
        <Section>
          {visible.map((r, i) => {
            const needsMe = r.status === 'pending' && loan.lenderId === userId && r.createdBy !== userId && !r.pending;
            const mine = r.status === 'pending' && r.createdBy === userId;
            return (
              <View key={r.id} style={[styles.repayment, i < visible.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <AppText variant="label" bold style={{ flex: 1 }}>
                    {formatMoney(r.amountMinor, loan.currency, fmt)}
                  </AppText>
                  <AppText variant="caption" muted>
                    {formatDate(r.paidOn, fmt)}
                  </AppText>
                </View>
                <AppText variant="caption" color={statusColor(r.status)}>
                  {t(`repayments.${r.status}Status`)}
                  {r.pending ? ` · ${t('loans.notSynced')}` : ''}
                </AppText>
                {r.note ? <AppText variant="caption" muted>{r.note}</AppText> : null}
                {r.status === 'disputed' && r.responseComment ? (
                  <AppText variant="caption">{t('history.comment', { comment: r.responseComment })}</AppText>
                ) : null}
                {needsMe ? (
                  <View style={{ gap: space.sm, marginTop: space.xs }}>
                    <AppText variant="label">
                      {t('repayments.needsYou', { name, amount: formatMoney(r.amountMinor, loan.currency, fmt) })}
                    </AppText>
                    <Button title={t('repayments.confirm')} onPress={() => void answer(r.id, 'confirm', null)} loading={busy} />
                    <Button title={t('repayments.dispute')} variant="secondary" onPress={() => setDisputing(r.id)} disabled={busy} />
                  </View>
                ) : null}
                {mine ? <Button title={t('repayments.withdraw')} variant="ghost" onPress={() => confirmWithdraw(r.id)} /> : null}
              </View>
            );
          })}
        </Section>
      ) : null}
      {canAdd ? (
        <Button
          title={t('repayments.add')}
          variant="secondary"
          icon="add-circle-outline"
          onPress={() => router.push({ pathname: '/loans/[id]/repay', params: { id: loan.id } })}
        />
      ) : null}
      <CommentSheet
        visible={!!disputing}
        title={t('repayments.disputeLabel')}
        busy={busy}
        onClose={() => setDisputing(null)}
        onSend={(comment) => disputing && void answer(disputing, 'dispute', comment)}
      />
    </View>
  );
}

// ---------- Sheets ----------

export function CommentSheet({
  visible,
  title,
  placeholder,
  busy,
  onClose,
  onSend,
}: {
  visible: boolean;
  title: string;
  placeholder?: string;
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
        <AppText variant="heading">{title}</AppText>
        <TextInput
          accessibilityLabel={title}
          value={comment}
          onChangeText={setComment}
          placeholder={placeholder}
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

/** "Wed 16 Mehr 1405, 14:30" in the person's calendar and digits. */
function formatWhen(iso: string, fmt: FormatContext): string {
  const d = new Date(iso);
  const time = toDigitSystem(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, fmt.digits);
  return `${formatDate(todayIso(d), fmt)} ${time}`;
}

export function ReminderSheet({
  visible,
  loan,
  remainingMinor,
  greetName,
  name,
  onClose,
}: {
  visible: boolean;
  loan: LocalLoan;
  remainingMinor: number;
  /** How the message greets the borrower. */
  greetName: string;
  /** The other person, for confirmations. */
  name: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const fmt = useFormat();
  const [tone, setTone] = useState<Tone>('gentle');
  const [busy, setBusy] = useState(false);
  const preview = reminderMessage(tone, { greetName, amountMinor: remainingMinor, currency: loan.currency, loanDate: loan.loanDate }, t, fmt);

  async function send() {
    setBusy(true);
    try {
      const result = await remind(loan, tone, remainingMinor);
      onClose();
      if (result.ok && loan.borrowerId) Alert.alert(t('reminders.title'), t('reminders.sentPush', { name }));
      if (!result.ok && result.reason === 'too_soon' && result.nextAt) {
        Alert.alert(t('reminders.title'), t('reminders.tooSoon', { when: formatWhen(result.nextAt, fmt) }));
      }
    } catch {
      Alert.alert(t('reminders.title'), t('reminders.needsOnline'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.close')} />
      <SafeAreaView edges={['bottom']} style={[styles.sheet, { backgroundColor: c.surface }]}>
        <AppText variant="heading">{t('reminders.title')}</AppText>
        <AppText variant="label" muted>
          {t('reminders.tone')}
        </AppText>
        <Section>
          {(['gentle', 'neutral', 'firm'] as const).map((k, i) => (
            <Row key={k} title={t(`reminders.${k}`)} selected={tone === k} onPress={() => setTone(k)} last={i === 2} />
          ))}
        </Section>
        <View style={[styles.preview, { backgroundColor: c.primarySoft }]}>
          <AppText>{preview}</AppText>
        </View>
        <Button title={t('reminders.send')} icon="paper-plane-outline" onPress={send} loading={busy} />
        <Button title={t('common.cancel')} variant="ghost" onPress={onClose} />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  track: { height: 12, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },
  repayment: { padding: space.md, gap: 2, minHeight: minTapSize },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { borderTopStartRadius: radius.lg, borderTopEndRadius: radius.lg, padding: space.md, gap: space.md },
  comment: { minHeight: 120, borderWidth: 1.5, borderRadius: radius.md, padding: space.md, fontSize: 18, textAlignVertical: 'top' },
  preview: { borderRadius: radius.md, padding: space.md },
});
