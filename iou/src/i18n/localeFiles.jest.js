// Jest stand-in for localeFiles.ts (Jest has no require.context).
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, 'locales');
exports.localeFiles = Object.fromEntries(
  fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => [f.replace(/\.json$/, ''), require(path.join(dir, f))]),
);
