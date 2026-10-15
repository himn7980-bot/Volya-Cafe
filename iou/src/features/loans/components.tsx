import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Avatar, Icon } from '@/components/ui';
import { useFormat } from '@/i18n';
import { todayIso } from '@/shared/calendars';
import { formatDate, formatMoney, type FormatContext } from '@/shared/format';
import { describeVersion, directionFor, isClosed, type LoanChange, type LoanStatus, type LoanVersion } from '@/shared/loans';
import { radius, space, useColors, type Palette } from '@/theme';

import type { LocalLoan } from './localStore';

export function statusColors(status: LoanStatus, c: Palette) {
  switch (status) {
    case 'confirmed':
      return { bg: c.primarySoft, fg: c.primary };
    case 'disputed':
      return { bg: c.surfaceAlt, fg: c.danger };
    case 'settled':
      return { bg: c.primarySoft, fg: c.positive };
    case 'cancelled':
      return { bg: c.surfaceAlt, fg: c.textMuted };
    default:
      return { bg: c.surfaceAlt, fg: c.negative };
  }
}

const STATUS_ICON = {
  pending: 'time-outline',
  confirmed: 'checkmark-circle-outline',
  disputed: 'alert-circle-outline',
  settled: 'checkmark-done-circle-outline',
  cancelled: 'close-circle-outline',
} as const;

export function StatusChip({ status }: { status: LoanStatus }) {
  const { t } = useTranslation();
  const c = useColors();
  const { bg, fg } = statusColors(status, c);
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      <Icon name={STATUS_ICON[status]} size={16} color={fg} />
      <AppText variant="caption" bold color={fg}>
        {t(`status.${status}`)}
      </AppText>
    </View>
  );
}

/** Amount color: green when they owe me, amber when I owe (owing isn't a failure). */
export function amountColor(loan: LocalLoan, userId: string, c: Palette) {
  if (isClosed(loan.status)) return c.textMuted;
  return directionFor(loan, userId) === 'lent' ? c.positive : c.negative;
}

export function LoanCard({ loan, userId, name, onPress }: { loan: LocalLoan; userId: string; name: string; onPress: () => void }) {
  const { t } = useTranslation();
  const c = useColors();
  const fmt = useFormat();
  const lent = directionFor(loan, userId) === 'lent';
  const sentence = t(lent ? 'loans.theyOweYou' : 'loans.youOwe', { name });
  // Partly paid back: show what is still open.
  const open = isClosed(loan.status) ? loan.amountMinor : loan.amountMinor - loan.repaidMinor;
  const amount = formatMoney(open, loan.currency, fmt);
  const overdue = !!loan.dueDate && loan.dueDate < todayIso() && !isClosed(loan.status);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${sentence}, ${amount}, ${t(`status.${loan.status}`)}`}
      style={({ pressed }) => [styles.card, { backgroundColor: c.surface, borderColor: c.border, opacity: pressed ? 0.85 : 1 }]}
    >
      <Avatar name={name} size={48} />
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="label" bold numberOfLines={1}>
          {name}
        </AppText>
        <AppText variant="caption" muted numberOfLines={1}>
          {sentence}
        </AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, alignItems: 'center' }}>
          <StatusChip status={loan.status} />
          {loan.pending ? <Icon name="cloud-upload-outline" size={18} color={c.textMuted} /> : null}
        </View>
        {loan.dueDate && !isClosed(loan.status) ? (
          <AppText variant="caption" color={overdue ? c.danger : c.textMuted}>
            {t(overdue ? 'loans.overdue' : 'loans.due', { date: formatDate(loan.dueDate, fmt) })}
          </AppText>
        ) : null}
      </View>
      <AppText variant="label" bold color={amountColor(loan, userId, c)} style={{ maxWidth: '40%' }}>
        {amount}
      </AppText>
    </Pressable>
  );
}

// ---------- History ----------

function changeText(change: LoanChange, t: TFunction, fmt: FormatContext): string {
  switch (change.kind) {
    case 'created':
      return t('history.created');
    case 'amount':
      return t('history.amount', {
        from: formatMoney(change.from.amountMinor, change.from.currency, fmt),
        to: formatMoney(change.to.amountMinor, change.to.currency, fmt),
      });
    case 'loanDate':
      return t('history.loanDate', { from: formatDate(change.from, fmt), to: formatDate(change.to, fmt) });
    case 'dueDate':
      return change.to ? t('history.dueDate', { to: formatDate(change.to, fmt) }) : t('history.dueRemoved');
    case 'note':
      return t('history.note');
    case 'photo':
      return t(change.added ? 'history.photoAdded' : 'history.photoRemoved');
    case 'name':
      return t('history.name', { to: change.to });
    case 'phone':
      return t('history.phone');
    case 'status': {
      const line = t('history.status', { status: t(`status.${change.to}`) });
      return change.comment ? `${line}\n${t('history.comment', { comment: change.comment })}` : line;
    }
    case 'joined':
      return t('history.joined');
  }
}

export function LoanTimeline({
  versions,
  userId,
  otherName,
}: {
  versions: LoanVersion[];
  userId: string;
  otherName: string;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const fmt = useFormat();
  // Newest first: what changed last is what people look for.
  const entries = versions.map((v, i) => ({ v, changes: describeVersion(versions[i - 1] ?? null, v) })).reverse();

  return (
    <View style={{ gap: space.md }}>
      {entries.map(({ v, changes }, i) => (
        <View key={v.version} style={{ flexDirection: 'row', gap: space.md }}>
          <View style={{ alignItems: 'center' }}>
            <View style={[styles.dot, { backgroundColor: i === 0 ? c.primary : c.border }]} />
            {i < entries.length - 1 ? <View style={[styles.line, { backgroundColor: c.border }]} /> : null}
          </View>
          <View style={{ flex: 1, gap: 2, paddingBottom: space.sm }}>
            <AppText variant="caption" muted>
              {`${v.changedBy === userId ? t('loans.you') : otherName} · ${formatDate(todayIso(new Date(v.createdAt)), fmt)}`}
            </AppText>
            {changes.map((ch, j) => (
              <AppText key={j} variant="label">
                {changeText(ch, t, fmt)}
              </AppText>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dot: { width: 14, height: 14, borderRadius: 7, marginTop: 4 },
  line: { width: 2, flex: 1, marginTop: 2 },
});
