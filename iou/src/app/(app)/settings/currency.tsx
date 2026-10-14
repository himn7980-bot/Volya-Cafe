import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionList, View } from 'react-native';

import { AppText, Row, TextField } from '@/components/ui';
import { useSavePrefs } from '@/features/profile/prefs';
import { currencyName, usePrefs } from '@/i18n';
import { CURRENCY_CODES, POPULAR_CURRENCIES } from '@/shared/currencies';
import { space, useColors } from '@/theme';

export default function CurrencySettings() {
  const { t } = useTranslation();
  const c = useColors();
  const prefs = usePrefs();
  const save = useSavePrefs();
  const [query, setQuery] = useState('');

  const sections = useMemo(() => {
    const locale = prefs.language.code;
    const item = (code: string) => ({ code, name: currencyName(code, locale) });
    const q = query.trim().toLowerCase();
    if (q) {
      const matches = CURRENCY_CODES.map(item).filter(
        (x) => x.code.toLowerCase().includes(q) || x.name.toLowerCase().includes(q),
      );
      return [{ title: '', data: matches }];
    }
    return [
      { title: t('currency.popular'), data: POPULAR_CURRENCIES.map(item) },
      {
        title: t('currency.all'),
        data: CURRENCY_CODES.map(item).sort((a, b) => a.name.localeCompare(b.name, locale)),
      },
    ];
  }, [prefs.language.code, query, t]);

  return (
    <SectionList
      style={{ backgroundColor: c.background }}
      contentContainerStyle={{ padding: space.md, gap: space.xs }}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={{ marginBottom: space.md }}>
          <TextField
            label={t('common.search')}
            placeholder={t('currency.searchPlaceholder')}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
          />
        </View>
      }
      sections={sections}
      keyExtractor={(x, i) => `${x.code}-${i}`}
      renderSectionHeader={({ section }) =>
        section.title ? (
          <AppText variant="caption" bold muted style={{ paddingTop: space.md, paddingBottom: space.xs, backgroundColor: c.background }}>
            {section.title}
          </AppText>
        ) : null
      }
      renderItem={({ item }) => (
        <View style={{ backgroundColor: c.surface, borderRadius: 12 }}>
          <Row
            title={item.name}
            subtitle={item.code === 'IRR' && prefs.irrAsToman ? `${item.code} · ${t('currency.toman')}` : item.code}
            selected={item.code === prefs.defaultCurrency}
            last
            onPress={() => {
              save({ defaultCurrency: item.code });
              router.back();
            }}
          />
        </View>
      )}
    />
  );
}
