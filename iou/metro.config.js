// Default Expo config, plus .wasm assets so expo-sqlite also runs in the web preview.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('wasm');

module.exports = config;
