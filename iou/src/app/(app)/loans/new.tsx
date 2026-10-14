import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useSession } from '@/features/auth/auth';
import { LoanForm } from '@/features/loans/LoanForm';
import { attachPhoto, createLoan } from '@/features/loans/service';

export default function NewLoan() {
  const { t } = useTranslation();
  const uid = useSession((s) => s.session?.user.id)!;

  return (
    <LoanForm
      submitLabel={t('loans.save')}
      onSubmit={async ({ draft, photo }) => {
        const id = await createLoan(draft, uid);
        if (photo.kind === 'add') await attachPhoto(id, photo.uri);
        router.replace({ pathname: '/loans/[id]', params: { id } });
      }}
    />
  );
}
