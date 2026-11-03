import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DateField } from '@/components/DatePicker';
import { AppText, Banner, Button, Icon, type IconName } from '@/components/ui';
import { useFormat } from '@/i18n';
import { addDays, todayIso } from '@/shared/calendars';
import { formatDate, formatNumber } from '@/shared/format';
import { radius, space, useColors, useFontFamily } from '@/theme';

import {
  proposeExtension,
  respondToExtension,
  useCardForLoan,
  useExtensions,
  type Extension,
  type TrustCard,
  type TrustLevel,
} from './api';

const LEVEL_ICON: Record<TrustLevel, IconName> = {
  excellent: 'ribbon',
  good: 'thumbs-up',
  fair: 'remove-circle-outline',
  weak: 'alert-circle-outline',
  poor: 'warning',
};

export function useLevelColor() {
  const c = useColors();
  return (level: TrustLevel | null) =>
    level === 'excellent' || level === 'good' ? c.primary : level === 'weak' || level === 'poor' ? c.danger : c.textMuted;
}

/** A trust card: coarse numbers only, never amounts or other people's names. */
export function TrustCardView({ card, title }: { card: TrustCard; title?: string }) {
  const { t } = useTranslation();
  const c = useColors();
  const fmt = useFormat();
  const levelColor = useLevelColor();
  const n = (v: number) => formatNumber(v, fmt);

  if (card.error) {
    return <Banner text={t(card.error === 'no_account' ? 'trust.noAccount' : card.error === 'expired' ? 'trust.expired' : 'trust.notFound')} />;
  }
  const name = `⁨${card.display_name}⁩`;
  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
      <AppText variant="label" muted>
        {title ?? t('trust.cardTitle', { name })}
      </AppText>
      {card.hidden ? (
        <AppText muted>{t('trust.hidden', { name })}</AppText>
      ) : (
        <>
          {card.is_new || card.level === null || card.score === null ? (
            <View style={styles.headline}>
              <Icon name="sparkles-outline" size={28} color={c.textMuted} />
              <AppText variant="heading">{t('trust.newUser')}</AppText>
            </View>
          ) : (
            <View style={styles.headline}>
              <Icon name={LEVEL_ICON[card.level]} size={28} color={levelColor(card.level)} />
              <View style={{ flex: 1 }}>
                <AppText variant="heading" color={levelColor(card.level)}>
                  {t(`trust.level.${card.level}`)}
                </AppText>
                <AppText variant="caption" muted>
                  {t('trust.score', { score: n(card.score) })}
                </AppText>
              </View>
            </View>
          )}
          {card.on_time_pct !== null ? <Fact icon="time-outline" text={t('trust.onTime', { pct: n(card.on_time_pct) })} /> : null}
          <Fact icon="checkmark-done-outline" text={t('trust.settled', { count: n(card.settled_count) })} />
          <Fact icon="people-outline" text={t('trust.people', { count: n(card.counterparties) })} />
          <Fact icon="pulse-outline" text={t('trust.volume', { band: t(`trust.band.${card.volume_band}`) })} />
          <Fact icon="calendar-outline" text={t('trust.memberSince', { date: formatDate(card.member_since, fmt) })} />
        </>
      )}
      <AppText variant="caption" muted>
        {t('trust.disclaimer')}
      </AppText>
    </View>
  );
}

function Fact({ icon, text }: { icon: IconName; text: string }) {
  const c = useColors();
  return (
    <View style={styles.fact}>
      <Icon name={icon} size={18} color={c.textMuted} />
      <AppText variant="label" style={{ flex: 1 }}>
        {text}
      </AppText>
    </View>
  );
}

/** On a record: the other person's card (they see mine the same way). */
export function CounterpartyCard({ loanId, enabled }: { loanId: string; enabled: boolean }) {
  const { data, isPending, isError } = useCardForLoan(loanId, enabled);
  const c = useColors();
  if (!enabled || isError) return null;
  if (isPending) return <ActivityIndicator color={c.primary} />;
  if (!data || data.error === 'not_found') return null;
  return <TrustCardView card={data} />;
}

// ---------- Extensions ----------

export function ExtensionSection({
  loanId,
  dueDate,
  userId,
  name,
  canAsk,
  online,
}: {
  loanId: string;
  dueDate: string;
  userId: string;
  name: string;
  /** Confirmed, between two accounts, something still open. */
  canAsk: boolean;
  online: boolean;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const fmt = useFormat();
  const { data: list = [], refetch } = useExtensions(loanId, online);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = list.find((e) => e.status === 'pending');
  const last = list.find((e) => e.status !== 'pending' && e.status !== 'cancelled');
  const who = `⁨${name}⁩`;

  async function act(e: Extension, action: 'accept' | 'reject' | 'cancel') {
    setBusy(true);
    try {
      await respondToExtension(e.id, action);
      await refetch();
    } catch {
      Alert.alert(t('extension.title'), t(online ? 'common.somethingWrong' : 'common.offline'));
      await refetch();
    } finally {
      setBusy(false);
    }
  }

  if (!pending && !canAsk && !last) return null;

  return (
    <View style={[styles.box, { backgroundColor: c.surfaceAlt }]}>
      {pending ? (
        pending.proposed_by === userId ? (
          <>
            <AppText variant="label">{t('extension.pendingMine', { date: formatDate(pending.new_due_date, fmt), name: who })}</AppText>
            <Button title={t('extension.cancel')} variant="ghost" onPress={() => void act(pending, 'cancel')} loading={busy} />
          </>
        ) : (
          <>
            <AppText variant="label" bold>
              {t('extension.pendingTheirs', { date: formatDate(pending.new_due_date, fmt), name: who })}
            </AppText>
            {pending.reason ? <AppText variant="caption">{t('history.comment', { comment: pending.reason })}</AppText> : null}
            <Button title={t('extension.accept')} icon="checkmark-circle-outline" onPress={() => void act(pending, 'accept')} loading={busy} />
            <Button title={t('extension.reject')} variant="secondary" onPress={() => void act(pending, 'reject')} disabled={busy} />
          </>
        )
      ) : (
        <>
          {last ? (
            <AppText variant="caption" muted>
              {t(last.status === 'accepted' ? 'extension.accepted' : 'extension.rejected', { date: formatDate(last.new_due_date, fmt) })}
            </AppText>
          ) : null}
          {canAsk ? (
            <>
              <Button title={t('extension.button')} variant="secondary" icon="calendar-outline" onPress={() => setAsking(true)} disabled={!online} />
              <AppText variant="caption" muted>
                {t('extension.hint')}
              </AppText>
            </>
          ) : null}
        </>
      )}
      <ExtensionSheet
        visible={asking}
        dueDate={dueDate}
        onClose={() => setAsking(false)}
        onSend={async (date, reason) => {
          await proposeExtension(loanId, date, reason);
          setAsking(false);
          await refetch();
          Alert.alert(t('extension.title'), t('extension.sent', { name: who }));
        }}
      />
    </View>
  );
}

function ExtensionSheet({
  visible,
  dueDate,
  onClose,
  onSend,
}: {
  visible: boolean;
  dueDate: string;
  onClose: () => void;
  onSend: (date: string, reason: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const fmt = useFormat();
  const fontFamily = useFontFamily();
  const today = todayIso();
  const min = addDays(dueDate >= today ? dueDate : today, 1);
  const [date, setDate] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!date || date < min) {
      setError(t('extension.badDate', { date: formatDate(addDays(min, -1), fmt) }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSend(date, reason.trim());
      setDate(null);
      setReason('');
    } catch {
      setError(t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.close')} />
      <SafeAreaView edges={['bottom']} style={[styles.sheet, { backgroundColor: c.surface }]}>
        <AppText variant="heading">{t('extension.title')}</AppText>
        <AppText variant="caption" muted>
          {t('extension.current', { date: formatDate(dueDate, fmt) })}
        </AppText>
        <DateField label={t('extension.newDate')} value={date} onChange={setDate} min={min} error={error} />
        <TextInput
          accessibilityLabel={t('extension.reason')}
          value={reason}
          onChangeText={setReason}
          placeholder={t('extension.reason')}
          placeholderTextColor={c.textMuted}
          multiline
          maxLength={300}
          style={[styles.comment, { color: c.text, borderColor: c.border, backgroundColor: c.background, fontFamily }]}
        />
        <Button title={t('extension.send')} onPress={() => void send()} disabled={!date} loading={busy} />
        <Button title={t('common.cancel')} variant="ghost" onPress={onClose} />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: space.md, gap: space.sm },
  headline: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  fact: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  box: { borderRadius: radius.lg, padding: space.md, gap: space.sm },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { borderTopStartRadius: radius.lg, borderTopEndRadius: radius.lg, padding: space.md, gap: space.md },
  comment: { minHeight: 80, borderWidth: 1.5, borderRadius: radius.md, padding: space.md, fontSize: 18, textAlignVertical: 'top' },
});
