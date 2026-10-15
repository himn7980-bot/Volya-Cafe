import { Contact } from 'expo-contacts';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Image, Modal, Pressable, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CurrencyList } from '@/components/CurrencyList';
import { DateField } from '@/components/DatePicker';
import { AppText, Banner, Button, Icon, Screen, TextField } from '@/components/ui';
import { normalizePhone } from '@/features/auth/auth';
import { currencyName, useFormat, usePrefs } from '@/i18n';
import { todayIso } from '@/shared/calendars';
import { formatMoney } from '@/shared/format';
import { minorToDecimalString, parseAmount } from '@/shared/money';
import { validateDraft, type Direction, type LoanDraft } from '@/shared/loans';
import { minTapSize, radius, space, useColors } from '@/theme';

export type PhotoChange = { kind: 'keep' } | { kind: 'add'; uri: string } | { kind: 'remove' };

export interface LoanFormValues {
  draft: LoanDraft;
  photo: PhotoChange;
}

export interface LoanFormProps {
  initial?: LoanDraft;
  /** Photo already on the record (local file or signed URL). */
  existingPhotoUri?: string | null;
  /** Editing: direction can't change, and a confirmed loan shows the re-confirmation note. */
  editing?: { reconfirmName: string | null };
  submitLabel: string;
  onSubmit: (values: LoanFormValues) => Promise<void>;
}

export function LoanForm({ initial, existingPhotoUri, editing, submitLabel, onSubmit }: LoanFormProps) {
  const { t } = useTranslation();
  const c = useColors();
  const prefs = usePrefs();
  const fmt = useFormat();
  const moneyOpts = { irrAsToman: prefs.irrAsToman };

  const [direction, setDirection] = useState<Direction>(initial?.direction ?? 'lent');
  const [name, setName] = useState(initial?.counterpartyName ?? '');
  const [phone, setPhone] = useState(initial?.counterpartyPhone ?? '');
  const [currency, setCurrency] = useState(initial?.currency ?? prefs.defaultCurrency);
  const [amountText, setAmountText] = useState(
    initial?.amountMinor ? minorToDecimalString(initial.amountMinor, initial.currency, moneyOpts) : '',
  );
  const [loanDate, setLoanDate] = useState(initial?.loanDate ?? todayIso());
  const [dueDate, setDueDate] = useState<string | null>(initial?.dueDate ?? null);
  const [note, setNote] = useState(initial?.note ?? '');
  const [autoRemind, setAutoRemind] = useState(initial?.autoRemind ?? false);
  const [photo, setPhoto] = useState<PhotoChange>({ kind: 'keep' });
  const [pickingCurrency, setPickingCurrency] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const amountMinor = parseAmount(amountText, currency, moneyOpts);
  const shownPhoto = photo.kind === 'add' ? photo.uri : photo.kind === 'remove' ? null : (existingPhotoUri ?? null);

  async function pickContact() {
    try {
      const contact = await Contact.presentPicker();
      if (!contact) return;
      const fullName = (await contact.getFullName()).trim();
      if (fullName) setName(fullName);
      const numbers = await contact.getPhones();
      const first = numbers.find((p) => p.number)?.number;
      if (first) setPhone(normalizePhone(first) ?? first);
    } catch {
      Alert.alert(t('loans.pickContact'), t('loans.contactsPermission'));
    }
  }

  async function pickPhoto(source: 'camera' | 'library') {
    const perm =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('loans.photo'), t('profile.photoPermission'));
      return;
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6 };
    const result =
      source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (!result.canceled && result.assets[0]) setPhoto({ kind: 'add', uri: result.assets[0].uri });
  }

  async function submit() {
    const trimmedPhone = phone.trim();
    const normalized = trimmedPhone ? normalizePhone(trimmedPhone) : null;
    const draft: LoanDraft = {
      direction,
      counterpartyName: name,
      counterpartyPhone: trimmedPhone ? (normalized ?? trimmedPhone) : null,
      amountMinor,
      currency,
      note,
      loanDate,
      dueDate,
      // Only lenders remind, and only when there is a date to remind on.
      autoRemind: direction === 'lent' && !!dueDate && autoRemind,
    };
    const found = validateDraft(draft);
    const messages = Object.fromEntries(Object.entries(found).map(([k, v]) => [k, t(`errors.${v}`)]));
    setErrors(messages);
    if (Object.keys(messages).length) return;
    setSaving(true);
    setFailed(false);
    try {
      await onSubmit({ draft: { ...draft, note: note.trim() }, photo });
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen footer={<Button title={submitLabel} onPress={submit} loading={saving} />}>
      {editing?.reconfirmName ? <Banner text={t('loans.reconfirmWarning', { name: editing.reconfirmName })} /> : null}

      {!editing ? (
        <View style={{ flexDirection: 'row', gap: space.sm }} accessibilityRole="radiogroup">
          <DirectionOption icon="arrow-up-circle-outline" label={t('loans.iLent')} selected={direction === 'lent'} onPress={() => setDirection('lent')} />
          <DirectionOption icon="arrow-down-circle-outline" label={t('loans.iBorrowed')} selected={direction === 'borrowed'} onPress={() => setDirection('borrowed')} />
        </View>
      ) : null}

      <View style={{ gap: space.sm }}>
        <TextField
          label={t('loans.name')}
          placeholder={t('loans.namePlaceholder')}
          value={name}
          onChangeText={setName}
          error={errors.counterpartyName}
          maxLength={80}
          autoComplete="name"
        />
        <Button title={t('loans.pickContact')} variant="ghost" icon="people-outline" onPress={pickContact} />
      </View>

      <TextField
        label={t('loans.phone')}
        hint={t('loans.phoneHint')}
        placeholder={t('auth.phonePlaceholder')}
        value={phone}
        onChangeText={setPhone}
        error={errors.counterpartyPhone}
        keyboardType="phone-pad"
        autoComplete="tel"
        ltr
      />

      <View style={{ gap: space.xs }}>
        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <TextField
              label={t('loans.amount')}
              value={amountText}
              onChangeText={setAmountText}
              error={errors.amountMinor}
              keyboardType="decimal-pad"
              ltr
              style={{ fontSize: 26 }}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t('loans.currency')}: ${currencyName(currency, prefs.language.code)}`}
            onPress={() => setPickingCurrency(true)}
            style={[styles.currency, { borderColor: c.border, backgroundColor: c.surface, marginBottom: errors.amountMinor ? 26 : 0 }]}
          >
            <AppText variant="label" bold>
              {currency === 'IRR' && prefs.irrAsToman ? t('currency.toman') : currency}
            </AppText>
            <Icon name="chevron-down" size={18} color={c.textMuted} />
          </Pressable>
        </View>
        {amountMinor && !errors.amountMinor ? (
          <AppText variant="caption" muted>
            {formatMoney(amountMinor, currency, fmt)}
          </AppText>
        ) : null}
      </View>

      <DateField label={t('loans.loanDate')} value={loanDate} onChange={(d) => d && setLoanDate(d)} />
      <DateField
        label={t('loans.dueDate')}
        value={dueDate}
        onChange={setDueDate}
        optional
        min={loanDate}
        error={errors.dueDate}
      />

      {direction === 'lent' && dueDate ? (
        <View style={[styles.switchRow, { borderColor: c.border, backgroundColor: c.surface }]}>
          <View style={{ flex: 1 }}>
            <AppText variant="label">{t('reminders.autoLabel')}</AppText>
            <AppText variant="caption" muted>
              {t('reminders.autoHint')}
            </AppText>
          </View>
          <Switch
            accessibilityLabel={t('reminders.autoLabel')}
            value={autoRemind}
            onValueChange={setAutoRemind}
            trackColor={{ true: c.primary }}
          />
        </View>
      ) : null}

      <TextField
        label={t('loans.note')}
        placeholder={t('loans.notePlaceholder')}
        value={note}
        onChangeText={setNote}
        error={errors.note}
        multiline
        maxLength={500}
        style={{ minHeight: 96, textAlignVertical: 'top', paddingTop: space.sm }}
      />

      <View style={{ gap: space.sm }}>
        <AppText variant="label" bold>
          {t('loans.photo')}
        </AppText>
        {shownPhoto ? (
          <View style={{ gap: space.sm }}>
            <Image source={{ uri: shownPhoto }} style={[styles.photo, { borderColor: c.border }]} resizeMode="cover" accessibilityIgnoresInvertColors />
            <Button title={t('loans.removePhoto')} variant="danger" icon="trash-outline" onPress={() => setPhoto({ kind: 'remove' })} />
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button title={t('loans.takePhoto')} variant="secondary" icon="camera-outline" onPress={() => void pickPhoto('camera')} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title={t('loans.choosePhoto')} variant="secondary" icon="image-outline" onPress={() => void pickPhoto('library')} />
            </View>
          </View>
        )}
      </View>

      {failed ? <Banner tone="error" text={t('common.somethingWrong')} /> : null}

      <Modal visible={pickingCurrency} animationType="slide" onRequestClose={() => setPickingCurrency(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.md }}>
            <AppText variant="heading" style={{ flex: 1 }}>
              {t('currency.title')}
            </AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              onPress={() => setPickingCurrency(false)}
              style={{ width: minTapSize, height: minTapSize, alignItems: 'center', justifyContent: 'center' }}
            >
              <Icon name="close" />
            </Pressable>
          </View>
          <CurrencyList
            selected={currency}
            onSelect={(code) => {
              setCurrency(code);
              setPickingCurrency(false);
            }}
          />
        </SafeAreaView>
      </Modal>
    </Screen>
  );
}

function DirectionOption({
  icon,
  label,
  selected,
  onPress,
}: {
  icon: 'arrow-up-circle-outline' | 'arrow-down-circle-outline';
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[
        styles.direction,
        { borderColor: selected ? c.primary : c.border, backgroundColor: selected ? c.primarySoft : c.surface },
      ]}
    >
      <Icon name={icon} size={32} color={selected ? c.primary : c.textMuted} />
      <AppText variant="label" bold={selected} center>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  direction: {
    flex: 1,
    minHeight: 96,
    borderWidth: 2,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    padding: space.sm,
  },
  currency: {
    minHeight: minTapSize,
    minWidth: 96,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
  },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    minHeight: minTapSize,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
