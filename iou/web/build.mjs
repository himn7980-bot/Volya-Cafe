// Builds the public confirmation site into web/dist:
//   dist/index.html        small landing page
//   dist/c/index.html      the confirmation page (https://<site>/c/#<token>)
//   dist/confirm.js        bundled page script (reuses src/shared)
//   dist/locales/*.json    the parts of each app locale the page uses
//
// Reads EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY (from the
// environment or .env.local / .env) and brand.json.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const dist = path.join(here, 'dist');

function loadEnv() {
  const env = {};
  for (const file of ['.env', '.env.local']) {
    const p = path.join(root, file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return { ...env, ...process.env };
}

const env = loadEnv();
const supabaseUrl = (env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
const anonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
if (!supabaseUrl || !anonKey) {
  console.error('Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (see .env.example).');
  process.exit(1);
}
const brand = JSON.parse(fs.readFileSync(path.join(root, 'brand.json'), 'utf8'));

// Locales: keep only what the page needs.
const KEEP = ['web', 'common', 'settings', 'currency', 'date', 'months', 'status'];
const localesDir = path.join(root, 'src', 'i18n', 'locales');
const languages = [];
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'locales'), { recursive: true });
for (const file of fs.readdirSync(localesDir).filter((f) => f.endsWith('.json')).sort()) {
  const code = file.replace(/\.json$/, '');
  const data = JSON.parse(fs.readFileSync(path.join(localesDir, file), 'utf8'));
  const { nativeName, dir, script, nativeDigits, defaultDigits, defaultCalendar } = data.meta;
  languages.push({ code, nativeName, dir, script, nativeDigits, defaultDigits, defaultCalendar });
  const subset = Object.fromEntries(KEEP.filter((k) => k in data).map((k) => [k, data[k]]));
  fs.writeFileSync(path.join(dist, 'locales', file), JSON.stringify(subset));
}
languages.sort((a, b) => (a.code === 'en' ? -1 : b.code === 'en' ? 1 : a.nativeName.localeCompare(b.nativeName)));

await build({
  entryPoints: [path.join(here, 'src', 'main.ts')],
  outfile: path.join(dist, 'confirm.js'),
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020', 'safari15', 'chrome80'],
  define: {
    __CONFIG__: JSON.stringify({
      supabaseUrl,
      anonKey,
      brand: { name: brand.name, scheme: brand.scheme, appStoreUrl: brand.appStoreUrl, playStoreUrl: brand.playStoreUrl },
      languages,
    }),
  },
});

// Change when the privacy policy text changes.
const PRIVACY_UPDATED = '2026-10-15';

const fill = (html) =>
  html
    .replaceAll('__APP_NAME__', brand.name)
    .replaceAll('__SUPABASE_ORIGIN__', new URL(supabaseUrl).origin)
    .replaceAll('__PLAY_URL__', brand.playStoreUrl)
    .replaceAll('__APPSTORE_URL__', brand.appStoreUrl)
    .replaceAll('__CONTACT_EMAIL__', brand.contactEmail)
    .replaceAll('__UPDATED__', PRIVACY_UPDATED);

fs.mkdirSync(path.join(dist, 'c'), { recursive: true });
fs.writeFileSync(path.join(dist, 'c', 'index.html'), fill(fs.readFileSync(path.join(here, 'public', 'c', 'index.html'), 'utf8')));
for (const page of ['index.html', 'privacy.html']) {
  fs.writeFileSync(path.join(dist, page), fill(fs.readFileSync(path.join(here, 'public', page), 'utf8')));
}
for (const file of ['style.css', '_headers']) fs.copyFileSync(path.join(here, 'public', file), path.join(dist, file));

const size = fs.statSync(path.join(dist, 'confirm.js')).size;
console.log(`web/dist ready (${languages.length} languages, confirm.js ${(size / 1024).toFixed(1)} KB)`);
