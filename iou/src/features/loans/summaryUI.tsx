// Dashboard pieces: totals per currency and one row per person.
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Avatar, Icon } from '@/components/ui';
import { useFormat } from '@/i18n';
import { formatMoney } from '@/shared/format';
import type { PersonSummary, Totals } from '@/shared/people';
import { radius, space, useColors } from '@/theme';

/** "Owed to you" and "You owe", one line per currency (never added together). */
export function TotalsCard({ totals }: { totals: Totals }) {
  const { t } = useTranslation();
  const c = useColors();
  const fmt = useFormat();
  if (totals.owedToMe.size === 0 && totals.iOwe.size === 0) {
    return (
      <View style={[styles.card, { backgroundColor: c.primarySoft, borderColor: c.border, alignItems: 'center', flexDirection: 'row', gap: space.sm }]}>
        <Icon name="checkmark-circle-outline" color={c.primary} />
        <AppText variant="label">{t('dashboard.allSettled')}</AppText>
      </View>
    );
  }
  const column = (title: string, values: Map<string, number>, color: string) => (
    <View style={{ flex: 1, gap: space.xs }} accessible accessibilityLabel={`${title}: ${[...values].map(([cur, v]) => formatMoney(v, cur, fmt)).join(', ') || '0'}`}>
      <AppText variant="caption" muted>
        {title}
      </AppText>
      {values.size === 0 ? (
        <AppText variant="heading" color={c.textMuted}>
          —
        </AppText>
      ) : (
        [...values].map(([cur, v]) => (
          <AppText key={cur} variant="heading" bold color={color}>
            {formatMoney(v, cur, fmt)}
          </AppText>
        ))
      )}
    </View>
  );
  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, flexDirection: 'row', gap: space.md }]}>
      {column(t('dashboard.owedToYou'), totals.owedToMe, c.positive)}
      <View style={{ width: StyleSheet.hairlineWidth, backgroundColor: c.border }} />
      {column(t('dashboard.youOweTotal'), totals.iOwe, c.negative)}
    </View>
  );
}

/** "Owes you $20 · You owe them €5", one line per currency. */
export function NetLines({ net, center }: { net: Map<string, number>; center?: boolean }) {
  const { t } = useTranslation();
  const c = useColors();
  const fmt = useFormat();
  if (net.size === 0) {
    return (
      <AppText variant="caption" muted center={center}>
        {t('dashboard.allSettled')}
      </AppText>
    );
  }
  return (
    <>
      {[...net].map(([cur, v]) => (
        <AppText key={cur} variant="label" bold color={v > 0 ? c.positive : c.negative} center={center}>
          {t(v > 0 ? 'dashboard.owesYou' : 'dashboard.youOweThem', { amount: formatMoney(Math.abs(v), cur, fmt) })}
        </AppText>
      ))}
    </>
  );
}

export function PersonRow({ person, onPress }: { person: PersonSummary; onPress: () => void }) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.card, styles.row, { backgroundColor: c.surface, borderColor: c.border, opacity: pressed ? 0.85 : 1 }]}
    >
      <Avatar name={person.name} size={48} />
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="label" bold numberOfLines={1}>
          {person.name}
        </AppText>
        <NetLines net={person.net} />
        {person.openCount > 0 ? (
          <AppText variant="caption" muted>
            {t('dashboard.openCount', { n: String(person.openCount) })}
          </AppText>
        ) : null}
      </View>
      <Icon name="chevron-forward" size={20} color={c.textMuted} directional />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.lg, padding: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
