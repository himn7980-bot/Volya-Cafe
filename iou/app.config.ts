import fs from 'node:fs';
import path from 'node:path';
import type { ConfigContext, ExpoConfig } from 'expo/config';

import brand from './brand.json';

// Every JSON file in src/i18n/locales is a supported language. Listing them here
// lets iOS / Android 13+ offer the per-app language setting for each of them.
const localesDir = path.join(__dirname, 'src', 'i18n', 'locales');
const supportedLocales = fs
  .readdirSync(localesDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''));

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: brand.name,
  slug: brand.slug,
  scheme: brand.scheme,
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {
    supportsTablet: true,
    bundleIdentifier: brand.iosBundleIdentifier,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: brand.androidPackage,
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-font',
    'expo-web-browser',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 160,
        resizeMode: 'contain',
        backgroundColor: '#FFFFFF',
        dark: { backgroundColor: '#111315' },
      },
    ],
    [
      'expo-localization',
      {
        supportsRTL: true,
        allowDynamicLocaleChangesAndroid: true,
        supportedLocales,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'Allow $(PRODUCT_NAME) to attach a photo to your profile or a record.',
        cameraPermission: 'Allow $(PRODUCT_NAME) to take a photo of a receipt.',
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    brand,
    supportedLocales,
  },
});
