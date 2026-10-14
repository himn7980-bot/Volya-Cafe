import { router } from 'expo-router';

import { CurrencyList } from '@/components/CurrencyList';
import { useSavePrefs } from '@/features/profile/prefs';
import { usePrefs } from '@/i18n';

export default function CurrencySettings() {
  const prefs = usePrefs();
  const save = useSavePrefs();
  return (
    <CurrencyList
      selected={prefs.defaultCurrency}
      onSelect={(code) => {
        save({ defaultCurrency: code });
        router.back();
      }}
    />
  );
}
