import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useSession } from '@/features/auth/auth';
import { LoanForm } from '@/features/loans/LoanForm';
import { attachPhoto, editLoan, removePhoto, useLoan, useLoanPhotoUrl } from '@/features/loans/service';
import { directionFor } from '@/shared/loans';

export default function EditLoan() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const uid = useSession((s) => s.session?.user.id)!;
  const { data: loan } = useLoan(id);
  const remotePhoto = useLoanPhotoUrl(loan?.localPhotoUri ? null : loan?.photoPath);

  if (!loan) return null;
  const agreed = loan.status === 'confirmed' || loan.status === 'disputed';

  return (
    <LoanForm
      editing={{ reconfirmName: agreed ? loan.counterpartyName : null }}
      existingPhotoUri={loan.localPhotoUri ?? remotePhoto.data ?? null}
      initial={{
        direction: directionFor(loan, uid),
        counterpartyName: loan.counterpartyName,
        counterpartyPhone: loan.counterpartyPhone,
        amountMinor: loan.amountMinor,
        currency: loan.currency,
        note: loan.note,
        loanDate: loan.loanDate,
        dueDate: loan.dueDate,
        autoRemind: loan.autoRemind,
      }}
      submitLabel={t('loans.saveChanges')}
      onSubmit={async ({ draft, photo }) => {
        await editLoan(loan.id, {
          counterpartyName: draft.counterpartyName.trim(),
          counterpartyPhone: draft.counterpartyPhone,
          amountMinor: draft.amountMinor!,
          currency: draft.currency,
          note: draft.note,
          loanDate: draft.loanDate,
          dueDate: draft.dueDate,
          autoRemind: draft.autoRemind,
        });
        if (photo.kind === 'remove') await removePhoto(loan);
        if (photo.kind === 'add') await attachPhoto(loan.id, photo.uri);
        router.back();
      }}
    />
  );
}
