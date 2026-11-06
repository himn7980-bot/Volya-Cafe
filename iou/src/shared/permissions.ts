import { Alert, Linking } from 'react-native';

import { i18n } from '@/i18n';

/**
 * A permission was refused. Explain why it is needed and offer one tap to the
 * app's own page in the phone settings, so nobody has to hunt for it.
 */
export function explainDenied(title: string, message: string): void {
  Alert.alert(title, message, [
    { text: i18n.t('common.cancel'), style: 'cancel' },
    { text: i18n.t('common.openSettings'), onPress: () => void Linking.openSettings() },
  ]);
}
