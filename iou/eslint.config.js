// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

// RTL support depends on logical properties (start/end). Physical left/right
// properties do not mirror, so they are banned in styles.
const physicalProps = [
  'left', 'right', 'marginLeft', 'marginRight', 'paddingLeft', 'paddingRight',
  'borderLeftWidth', 'borderRightWidth', 'borderLeftColor', 'borderRightColor',
  'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius',
];

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['**/dist/**', 'supabase/functions/*', 'src/i18n/localeFiles.jest.js', 'metro.config.js'],
  },
  {
    files: ['scripts/**/*.js'],
    languageOptions: {
      globals: { __dirname: 'readonly', require: 'readonly', process: 'readonly', module: 'writable', console: 'readonly' },
    },
  },
  {
    rules: {
      'no-restricted-syntax': [
        'error',
        ...physicalProps.map((name) => ({
          selector: `Property[key.name='${name}']`,
          message: `Use logical start/end properties instead of "${name}" so layouts mirror in RTL.`,
        })),
        {
          selector: "Property[key.name='textAlign'][value.value=/^(left|right)$/]",
          message: 'Leave textAlign unset (it follows the language direction) or use "center".',
        },
      ],
    },
  },
]);
