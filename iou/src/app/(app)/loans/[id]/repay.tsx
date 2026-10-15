import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { DateField } from '@/components/DatePicker';
import { AppText, Banner, Button, Screen, TextField } from '@/components/ui';
import { useSession } from '@/features/auth/auth';
import { addRepayment, otherPartyName, useLoan, usePeople, useRepayments } from '@/features/loans/service';
import { useFormat, usePrefs } from '@/i18n';
import { balanceOf } from '@/shared/balance';
import { todayIso } from '@/shared/calendars';
import { formatMoney } from '@/shared/format';
import { minorToDecimalString, parseAmount } from '@/shared/money';
import { space } from '@/theme';

export default function Repay() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const prefs = usePrefs();
  const { id } = useLocalSearchParams<{ id: string }>();
  const uid = useSession((s) => s.session?.user.id)!;
  const { data: loan } = useLoan(id);
  const { data: repayments = [] } = useRepayments(id);
  const { data: people } = usePeople();
  const [amountText, setAmountText] = useState('');
  const [paidOn, setPaidOn] = useState(todayIso());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!loan) return null;
  const moneyOpts = { irrAsToman: prefs.irrAsToman };
  const balance = balanceOf(loan.amountMinor, repayments);
  const iAmLender = loan.lenderId === uid;
  const name = otherPartyName(loan, uid, people);
  const max = balance.maxNewRepayment;

  async function save() {
    const amountMinor = parseAmount(amountText, loan!.currency, moneyOpts);
    if (!amountMinor || amountMinor <= 0) {
      setError(t('errors.amountInvalid'));
      return;
    }
    if (amountMinor > max) {
      setError(t('repayments.tooMuch', { amount: formatMoney(max, loan!.currency, fmt) }));
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await addRepayment(loan!, uid, { amountMinor, paidOn, note });
      router.back();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen footer={<Button title={t('repayments.save')} onPress={save} loading={saving} disabled={max <= 0} />}>
      <AppText variant="label" muted>
        {t('repayments.remaining', { amount: formatMoney(balance.remaining, loan.currency, fmt) })}
      </AppText>

      <View style={{ gap: space.sm }}>
        <TextField
          label={t(iAmLender ? 'repayments.amountLender' : 'repayments.amountBorrower')}
          value={amountText}
          onChangeText={setAmountText}
          error={error}
          keyboardType="decimal-pad"
          ltr
          autoFocus
          style={{ fontSize: 26 }}
        />
        {max > 0 ? (
          <Button
            title={t('repayments.all', { amount: formatMoney(max, loan.currency, fmt) })}
            variant="secondary"
            onPress={() => setAmountText(minorToDecimalString(max, loan.currency, moneyOpts))}
          />
        ) : null}
      </View>

      <DateField label={t('repayments.date')} value={paidOn} onChange={(d) => d && setPaidOn(d)} min={loan.loanDate} />

      <TextField
        label={t('repayments.note')}
        value={note}
        onChangeText={setNote}
        maxLength={300}
        multiline
        style={{ minHeight: 72, textAlignVertical: 'top', paddingTop: space.sm }}
      />

      <Banner text={iAmLender ? t('repayments.lenderNote') : t('repayments.borrowerNote', { name })} />
    </Screen>
  );
}
