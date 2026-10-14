#!/usr/bin/env node
// Checks every locale in src/i18n/locales against en.json:
//  - same keys (missing keys fall back to English at runtime, but we want to know)
//  - same {{variables}} in each string
//  - month arrays have 12 entries
//  - meta block is valid
// Usage: npm run i18n:check   (exit code 1 on errors; missing keys are warnings with --lenient)

const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'src', 'i18n', 'locales');
const lenient = process.argv.includes('--lenient');
const DIGITS = ['latn', 'arab', 'arabext', 'deva', 'beng'];
const SCRIPTS = ['latn', 'cyrl', 'arab', 'hebr', 'deva', 'beng', 'hans', 'hant', 'other'];
const CALENDARS = ['gregory', 'persian', 'islamic'];

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

const vars = (s) => (typeof s === 'string' ? [...s.matchAll(/\{\{(\w+)\}\}|\{(\w+)\}/g)].map((m) => m[1] || m[2]).sort().join(',') : '');

const en = flatten(JSON.parse(fs.readFileSync(path.join(dir, 'en.json'), 'utf8')));
let errors = 0;
let warnings = 0;
const err = (file, msg) => { errors += 1; console.error(`✗ ${file}: ${msg}`); };
const warn = (file, msg) => { warnings += 1; console.warn(`! ${file}: ${msg}`); };

for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  } catch (e) {
    err(file, `invalid JSON: ${e.message}`);
    continue;
  }
  const meta = data.meta || {};
  if (!meta.name || !meta.nativeName) err(file, 'meta.name and meta.nativeName are required');
  if (!['ltr', 'rtl'].includes(meta.dir)) err(file, 'meta.dir must be "ltr" or "rtl"');
  if (!SCRIPTS.includes(meta.script)) err(file, `meta.script must be one of ${SCRIPTS.join(', ')}`);
  if (!DIGITS.includes(meta.nativeDigits)) err(file, `meta.nativeDigits must be one of ${DIGITS.join(', ')}`);
  if (!['native', 'latin'].includes(meta.defaultDigits)) err(file, 'meta.defaultDigits must be "native" or "latin"');
  if (!CALENDARS.includes(meta.defaultCalendar)) err(file, `meta.defaultCalendar must be one of ${CALENDARS.join(', ')}`);

  const flat = flatten(data);
  for (const [key, value] of Object.entries(en)) {
    if (key.startsWith('meta.')) continue;
    if (!(key in flat)) {
      (lenient ? warn : err)(file, `missing key ${key}`);
      continue;
    }
    if (Array.isArray(value)) {
      if (!Array.isArray(flat[key]) || flat[key].length !== value.length) err(file, `${key} must have ${value.length} entries`);
    } else if (vars(value) !== vars(flat[key])) {
      err(file, `${key} variables differ: expected [${vars(value)}], got [${vars(flat[key])}]`);
    }
  }
  for (const key of Object.keys(flat)) {
    if (!key.startsWith('meta.') && !(key in en)) warn(file, `unused key ${key}`);
  }
}

console.log(errors ? `\n${errors} error(s), ${warnings} warning(s)` : `All locales OK (${warnings} warning(s)).`);
process.exit(errors ? 1 : 0);
