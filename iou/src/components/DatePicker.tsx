// Date picker that works in the person's calendar (Gregorian, Persian or
// Islamic). The platform pickers only do Gregorian, so this is our own:
// a month grid with large cells and quick "Today" / "Yesterday" choices.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useFormat } from '@/i18n';
import { addDays, daysInMonth, fromIso, todayIso, toIso, weekdayOfIso } from '@/shared/calendars';
import { toDigitSystem } from '@/shared/digits';
import { formatDate } from '@/shared/format';
import { minTapSize, radius, space, useColors } from '@/theme';

import { AppText, Button, Icon } from './ui';

export function DateField({
  label,
  value,
  onChange,
  optional,
  min,
  error,
}: {
  label: string;
  value: string | null;
  onChange: (iso: string | null) => void;
  /** Allow clearing the date ("No date"). */
  optional?: boolean;
  min?: string;
  error?: string | null;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const fmt = useFormat();
  const [open, setOpen] = useState(false);

  return (
    <View style={{ gap: space.xs }}>
      <AppText variant="label" bold>
        {label}
      </AppText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ? formatDate(value, fmt) : t('loans.noDueDate')}`}
        onPress={() => setOpen(true)}
        style={[styles.field, { backgroundColor: c.surface, borderColor: error ? c.danger : c.border }]}
      >
        <Icon name="calendar-outline" color={c.primary} />
        <AppText style={{ flex: 1 }} muted={!value}>
          {value ? formatDate(value, fmt) : t('loans.noDueDate')}
        </AppText>
      </Pressable>
      {error ? (
        <AppText variant="caption" color={c.danger}>
          {error}
        </AppText>
      ) : null}
      {open ? (
        <DatePickerModal
          value={value}
          min={min}
          optional={optional}
          onClose={() => setOpen(false)}
          onPick={(iso) => {
            setOpen(false);
            onChange(iso);
          }}
        />
      ) : null}
    </View>
  );
}

function DatePickerModal({
  value,
  min,
  optional,
  onPick,
  onClose,
}: {
  value: string | null;
  min?: string;
  optional?: boolean;
  onPick: (iso: string | null) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const fmt = useFormat();
  const cal = fmt.calendar;
  const today = todayIso();
  const start = fromIso(value ?? (min && min > today ? min : today), cal);
  const [view, setView] = useState({ year: start.year, month: start.month });

  const weekdays = t('date.weekdays', { returnObjects: true }) as unknown as string[];
  const firstDay = Number(t('date.firstDayOfWeek')) || 0;
  const order = Array.from({ length: 7 }, (_, i) => (firstDay + i) % 7);

  const firstOfMonth = toIso({ year: view.year, month: view.month, day: 1 }, cal);
  const offset = (weekdayOfIso(firstOfMonth) - firstDay + 7) % 7;
  const count = daysInMonth(view.year, view.month, cal);
  const cells: (string | null)[] = [
    ...Array<null>(offset).fill(null),
    ...Array.from({ length: count }, (_, i) => addDays(firstOfMonth, i)),
  ];
  while (cells.length % 7) cells.push(null);

  const move = (delta: number) =>
    setView((v) => {
      const index = v.year * 12 + (v.month - 1) + delta;
      return { year: Math.floor(index / 12), month: (index % 12) + 1 };
    });

  const monthTitle = `${fmt.labels.months[cal][view.month - 1]} ${toDigitSystem(String(view.year), fmt.digits)}`;
  const yesterday = addDays(today, -1);
  const allowed = (iso: string) => !min || iso >= min;

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.close')} />
      <SafeAreaView edges={['bottom']} style={[styles.sheet, { backgroundColor: c.surface }]}>
        <AppText variant="heading" center>
          {t('date.pick')}
        </AppText>

        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('date.prevMonth')} onPress={() => move(-1)} style={styles.navButton}>
            <Icon name="chevron-back" directional />
          </Pressable>
          <AppText variant="label" bold style={{ flex: 1 }} center>
            {monthTitle}
          </AppText>
          <Pressable accessibilityRole="button" accessibilityLabel={t('date.nextMonth')} onPress={() => move(1)} style={styles.navButton}>
            <Icon name="chevron-forward" directional />
          </Pressable>
        </View>

        <View style={styles.week}>
          {order.map((d) => (
            <AppText key={d} variant="caption" muted center style={styles.cellText}>
              {weekdays[d]}
            </AppText>
          ))}
        </View>
        {Array.from({ length: cells.length / 7 }, (_, row) => (
          <View key={row} style={styles.week}>
            {cells.slice(row * 7, row * 7 + 7).map((iso, i) => {
              if (!iso) return <View key={i} style={styles.cell} />;
              const selected = iso === value;
              const enabled = allowed(iso);
              const day = fromIso(iso, cal).day;
              return (
                <Pressable
                  key={iso}
                  disabled={!enabled}
                  accessibilityRole="button"
                  accessibilityState={{ selected, disabled: !enabled }}
                  accessibilityLabel={formatDate(iso, fmt)}
                  onPress={() => onPick(iso)}
                  style={[
                    styles.cell,
                    selected && { backgroundColor: c.primary },
                    !selected && iso === today && { borderColor: c.primary, borderWidth: 1.5 },
                  ]}
                >
                  <AppText
                    variant="label"
                    bold={selected}
                    color={selected ? c.onPrimary : enabled ? c.text : c.border}
                    style={styles.cellText}
                    center
                  >
                    {toDigitSystem(String(day), fmt.digits)}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        ))}

        <View style={styles.quick}>
          {allowed(today) ? (
            <View style={{ flex: 1 }}>
              <Button title={t('date.today')} variant="secondary" onPress={() => onPick(today)} />
            </View>
          ) : null}
          {allowed(yesterday) && !optional ? (
            <View style={{ flex: 1 }}>
              <Button title={t('date.yesterday')} variant="secondary" onPress={() => onPick(yesterday)} />
            </View>
          ) : null}
          {optional ? (
            <View style={{ flex: 1 }}>
              <Button title={t('loans.noDueDate')} variant="secondary" onPress={() => onPick(null)} />
            </View>
          ) : null}
        </View>
        <Button title={t('common.cancel')} variant="ghost" onPress={onClose} />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  field: {
    minHeight: minTapSize,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    borderTopStartRadius: radius.lg,
    borderTopEndRadius: radius.lg,
    padding: space.md,
    gap: space.sm,
  },
  header: { flexDirection: 'row', alignItems: 'center' },
  navButton: { width: minTapSize, height: minTapSize, alignItems: 'center', justifyContent: 'center' },
  week: { flexDirection: 'row' },
  cell: { flex: 1, height: 48, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  cellText: { flex: 1, textAlign: 'center', textAlignVertical: 'center', lineHeight: 48 },
  quick: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
});
