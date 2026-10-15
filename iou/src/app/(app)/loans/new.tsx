import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useSession } from '@/features/auth/auth';
import { LoanForm } from '@/features/loans/LoanForm';
import { attachPhoto, createLoan } from '@/features/loans/service';
import { askForPushPermission } from '@/features/notifications/push';
import { usePrefs } from '@/i18n';
import { todayIso } from '@/shared/calendars';

export default function NewLoan() {
  const { t } = useTranslation();
  const uid = useSession((s) => s.session?.user.id)!;
  const prefs = usePrefs();
  // Opened from a person's page: start with their name and number.
  const { name, phone } = useLocalSearchParams<{ name?: string; phone?: string }>();
  const initial = name
    ? {
        direction: 'lent' as const,
        counterpartyName: name,
        counterpartyPhone: phone || null,
        amountMinor: null,
        currency: prefs.defaultCurrency,
        note: '',
        loanDate: todayIso(),
        dueDate: null,
        autoRemind: false,
      }
    : undefined;

  return (
    <LoanForm
      initial={initial}
      submitLabel={t('loans.save')}
      onSubmit={async ({ draft, photo }) => {
        const id = await createLoan(draft, uid);
        if (photo.kind === 'add') await attachPhoto(id, photo.uri);
        router.replace({ pathname: '/loans/[id]', params: { id } });
        // Now it's clear why notifications help: "we'll tell you when they confirm".
        void askForPushPermission();
      }}
    />
  );
}
