import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { AppText, Banner, Button, Row, Section } from '@/components/ui';
import { useProfile, useUpdateProfile } from '@/features/profile/api';
import { revokeCardLink, shareMyCard, useCardLinks, useInvalidateTrust, useMyTrust, type MyTrust } from '@/features/trust/api';
import { TrustCardView, useLevelColor } from '@/features/trust/components';
import { useFormat } from '@/i18n';
import { formatDate, formatMoney, formatNumber } from '@/shared/format';
import { minTapSize, radius, space, useColors } from '@/theme';

/** My portfolio: the full picture, only for me. Other people only ever see the card. */
export default function Portfolio() {
  const { t } = useTranslation();
  const c = useColors();
  const fmt = useFormat();
  const trust = useMyTrust();
  const links = useCardLinks();
  const invalidate = useInvalidateTrust();
  const { data: profile } = useProfile();
  const updateProfile = useUpdateProfile();
  const [sharing, setSharing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const n = (v: number) => formatNumber(v, fmt);

  async function refresh() {
    setRefreshing(true);
    await invalidate();
    setRefreshing(false);
  }

  async function share() {
    setSharing(true);
    try {
      await shareMyCard();
      await links.refetch();
    } catch {
      Alert.alert(t('trust.myCard'), t('common.somethingWrong'));
    } finally {
      setSharing(false);
    }
  }

  function revoke(token: string) {
    Alert.alert(t('trust.revokeTitle'), t('trust.revokeBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('trust.revoke'),
        style: 'destructive',
        onPress: () => void revokeCardLink(token).then(() => links.refetch()),
      },
    ]);
  }

  const data = trust.data;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{ padding: space.md, gap: space.lg, paddingBottom: space.xl }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.primary} />}
    >
      {trust.isPending ? <ActivityIndicator color={c.primary} size="large" /> : null}
      {trust.isError ? (
        <>
          <Banner tone="error" text={t('trust.loadFailed')} />
          <Button title={t('common.retry')} onPress={() => void trust.refetch()} />
        </>
      ) : null}

      {data ? (
        <>
          <TrustCardView card={data.card} title={t('trust.myCard')} />

          <View style={{ gap: space.sm }}>
            <Button title={t('trust.shareCard')} icon="share-outline" onPress={() => void share()} loading={sharing} />
            <AppText variant="caption" muted center>
              {t('trust.shareHint')}
            </AppText>
          </View>

          <Section title={t('trust.privacy')}>
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <AppText variant="label">{t('trust.hideCard')}</AppText>
                <AppText variant="caption" muted>
                  {t('trust.hideCardHint')}
                </AppText>
              </View>
              <Switch
                accessibilityLabel={t('trust.hideCard')}
                value={!!profile?.card_hidden}
                onValueChange={(v) => updateProfile.mutate({ card_hidden: v }, { onSuccess: () => void invalidate() })}
                trackColor={{ true: c.primary }}
              />
            </View>
            {(links.data ?? []).map((l, i, all) => (
              <Row
                key={l.token}
                icon="link-outline"
                title={t('trust.linkUntil', { date: formatDate(l.expires_at.slice(0, 10), fmt) })}
                value={t('trust.revoke')}
                onPress={() => revoke(l.token)}
                last={i === all.length - 1}
              />
            ))}
          </Section>

          {data.money.length === 0 ? (
            <AppText muted center>
              {t('portfolio.empty')}
            </AppText>
          ) : (
            data.money.map((m) => (
              <Section key={m.currency} title={t('portfolio.inCurrency', { currency: m.currency })}>
                <Row title={t('portfolio.borrowed')} value={formatMoney(m.borrowed, m.currency, fmt)} />
                <Row title={t('portfolio.repaid')} value={formatMoney(m.repaid, m.currency, fmt)} />
                <Row title={t('portfolio.toPay')} value={formatMoney(m.borrowed - m.repaid, m.currency, fmt)} />
                <Row title={t('portfolio.lent')} value={formatMoney(m.lent, m.currency, fmt)} />
                <Row title={t('portfolio.received')} value={formatMoney(m.received, m.currency, fmt)} />
                <Row title={t('portfolio.owedToYou')} value={formatMoney(m.lent - m.received, m.currency, fmt)} last />
              </Section>
            ))
          )}

          <Section title={t('portfolio.activity')}>
            <Row title={t('portfolio.taken')} value={n(data.counts.taken)} />
            <Row title={t('portfolio.given')} value={n(data.counts.given)} />
            <Row title={t('portfolio.settled')} value={n(data.counts.settled)} />
            <Row title={t('portfolio.open')} value={n(data.counts.open)} />
            <Row title={t('portfolio.overdue')} value={n(data.counts.overdue)} />
            <Row title={t('portfolio.extensions')} value={n(data.counts.extensions)} />
            <Row title={t('portfolio.disputes')} value={n(data.counts.disputes)} />
            <Row title={t('portfolio.counterparties')} value={n(data.counts.counterparties)} last />
          </Section>

          <Trend trend={data.trend} />

          <View style={{ gap: space.sm }}>
            <AppText variant="heading">{t('portfolio.changes')}</AppText>
            {data.events.length === 0 ? (
              <AppText muted>{t('portfolio.noChanges')}</AppText>
            ) : (
              <Section>
                {data.events.map((e, i) => (
                  <Row
                    key={`${e.loan_id}-${e.role}`}
                    title={t(`portfolio.event.${e.kind}`, { name: `⁨${e.name ?? '…'}⁩`, days: n(e.late_days) })}
                    subtitle={formatDate(e.date, fmt)}
                    value={`${e.points > 0 ? '+' : ''}${formatNumber(Math.round(e.points * 10) / 10, fmt)}`}
                    last={i === data.events.length - 1}
                  />
                ))}
              </Section>
            )}
          </View>

          <View style={[styles.box, { backgroundColor: c.surfaceAlt }]}>
            <AppText variant="label" bold>
              {t('portfolio.howTitle')}
            </AppText>
            <AppText variant="caption">{t('portfolio.how')}</AppText>
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

function Trend({ trend }: { trend: MyTrust['trend'] }) {
  const { t } = useTranslation();
  const c = useColors();
  const fmt = useFormat();
  const levelColor = useLevelColor();
  if (!trend.some((p) => p.score !== null)) return null;
  return (
    <View style={{ gap: space.sm }}>
      <AppText variant="heading">{t('portfolio.trend')}</AppText>
      <View style={[styles.chart, { backgroundColor: c.surface, borderColor: c.border }]} accessibilityRole="image" accessibilityLabel={t('portfolio.trend')}>
        {trend.map((p) => {
          const score = p.score ?? 0;
          const level = score >= 70 ? 'good' : score >= 50 ? 'fair' : 'weak';
          return (
            <View key={p.date} style={styles.barCol}>
              <AppText variant="caption" muted>
                {p.score === null ? '–' : formatNumber(p.score, fmt)}
              </AppText>
              <View style={[styles.barTrack, { backgroundColor: c.surfaceAlt }]}>
                <View style={{ height: `${score}%`, backgroundColor: p.score === null ? c.border : levelColor(level), borderRadius: 6 }} />
              </View>
              <AppText variant="caption" muted numberOfLines={1}>
                {formatDate(p.date, fmt, 'short')}
              </AppText>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, minHeight: minTapSize },
  box: { borderRadius: radius.lg, padding: space.md, gap: space.sm },
  chart: { flexDirection: 'row', gap: space.xs, padding: space.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, height: 200 },
  barCol: { flex: 1, alignItems: 'center', gap: space.xs },
  barTrack: { flex: 1, width: '70%', borderRadius: 6, justifyContent: 'flex-end', overflow: 'hidden' },
});
