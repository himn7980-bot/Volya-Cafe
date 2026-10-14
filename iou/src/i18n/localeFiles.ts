// Every JSON file in ./locales, keyed by language code. Metro bundles them via
// require.context, so a new language is just a new file. (Jest uses
// localeFiles.jest.js instead, see package.json "moduleNameMapper".)
const context = require.context('./locales', false, /\.json$/);

export const localeFiles: Record<string, unknown> = Object.fromEntries(
  context.keys().map((key) => [key.replace(/^.*\//, '').replace(/\.json$/, ''), context(key)]),
);
