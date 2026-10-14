# IOU

A small, friendly app for writing down informal loans between friends, family and
colleagues ("I lent Ali 500,000 toman", "I owe Sara $20"). IOU **never moves money**:
it records, lets the other person confirm, and sends polite reminders.

> Working name. To rename the app, edit [`brand.json`](brand.json) (name, URL scheme,
> bundle IDs). Every screen and translation reads the name from there via `{{appName}}`.

## Status

The work is delivered in phases, with a review after each one.

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Project setup, i18n + RTL foundation, auth, profile | **done** |
| 2 | Loans CRUD, local cache and sync | **done** |
| 3 | Share link + public confirmation web page | next |
| 4 | Repayments, reminders, push notifications | |
| 5 | Dashboard, export, settings, polish | |
| 6 | Tests, EAS build config, store publishing guide | |

## Tech stack

- **Expo SDK 57** (managed workflow, TypeScript, Expo Router), one codebase for Android and iOS
- **Supabase**: Postgres with Row Level Security, Auth (phone OTP, email magic link, Google), Storage
- **State**: Zustand (device preferences, session) + TanStack Query (server data)
- **i18n**: i18next + react-i18next + expo-localization, 16 languages, full RTL
- **Fonts**: Vazirmatn (Arabic script), Noto Sans / Devanagari / Bengali / Hebrew; system font for Chinese

## Project layout

```
brand.json                 app name, scheme, bundle IDs (rename here)
app.config.ts              Expo config (reads brand.json and the locale list)
src/
  app/                     screens (Expo Router: every file is a route)
    onboarding.tsx         language picker, then welcome
    sign-in.tsx, verify.tsx, auth-callback.tsx
    (app)/                 signed-in area: dashboard, loans/, profile, settings
  components/              UI kit, calendar-aware date picker, currency list
  features/
    auth/, profile/        sign-in and profile data
    loans/
      localStore.ts        SQLite cache + outbox of unsent changes
      syncEngine.ts        push/pull logic (pure, unit-tested)
      remote.ts            Supabase implementation of the sync "Remote"
      service.ts           hooks, sync scheduling, photos
      LoanForm.tsx, components.tsx
  i18n/
    locales/*.json         one file per language  <- add languages here
    languages.ts           registry + device language matching
    direction.ts           RTL switching
  shared/                  pure TS (no React Native): money, currencies,
                           calendars, digits, formatting, loan rules.
                           Reused by the web page.
  stores/settings.ts       device preferences (persisted)
  theme/                   colors (light/dark), type scale, fonts
supabase/
  migrations/              SQL schema + RLS policies
  tests/                   RLS tests (plain SQL), runnable without Docker
  config.toml              local Supabase settings
scripts/
  check-i18n.js            validates every locale against en.json
  test-db.sh               runs migrations + RLS tests
```

## Run locally

Requirements: Node 20+ and npm. For a device, use a development build (see below) or Expo Go.

```bash
cd iou
npm install
cp .env.example .env.local      # fill in your Supabase URL and anon key
npx expo start                  # press a for Android, i for iOS
```

Useful scripts:

```bash
npm run typecheck     # TypeScript
npm run lint          # ESLint (also blocks left/right styles, see "RTL rules")
npm test              # unit tests (money, calendars, formatting, languages, loan rules,
                      #   local store + sync engine on a real SQLite database)
npm run i18n:check    # every locale has every key and matching {{variables}}
npm run test:db       # database migrations + RLS tests (see below)
```

**Expo Go vs. development build.** Everything in Phase 1 runs in Expo Go. Switching
between LTR and RTL languages restarts the app; in Expo Go that uses the dev reload. A
development build (`npx expo run:android` / `run:ios`, or `eas build --profile
development`) behaves exactly like the store app.

## Set up Supabase

### Local (Docker)

```bash
npx supabase start          # starts Postgres, Auth, Storage, Studio and a mail inbox
npx supabase db reset       # applies supabase/migrations
```

`supabase start` prints the API URL and anon key; put them in `.env.local`. Sign-in
emails (with the link and the 6-digit code) land in the local inbox at
http://127.0.0.1:54324. For phone sign-in without an SMS provider, use the test numbers
in `supabase/config.toml` (`+15555550100`, code `123456`).

On a physical phone, `127.0.0.1` is the phone itself. Use your computer's LAN IP in
`EXPO_PUBLIC_SUPABASE_URL`.

### Hosted project

1. Create a project at [supabase.com](https://supabase.com).
2. Link it and push the schema:
   ```bash
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```
3. **Authentication → URL configuration**: add `iou://auth-callback` (or
   `<your scheme>://auth-callback` after renaming) to *Redirect URLs*. For Expo Go
   during development, also add `exp://**`.
4. **Email**: Authentication → Email templates → *Magic link*. Paste
   `supabase/templates/magic_link.html` so the email shows the 6-digit code as well as
   the link. Set up custom SMTP before launch (the built-in sender is heavily rate-limited).
5. **Phone**: Authentication → Providers → Phone. Enable it and connect an SMS provider
   (Twilio, MessageBird, Vonage or Textlocal).
6. **Google**: create an OAuth client (type *Web application*) in Google Cloud Console,
   with redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`. Paste the
   client ID and secret into Authentication → Providers → Google.
7. Copy *Project URL* and the *anon public* key into `.env.local` (and later into EAS
   secrets for builds).

### Database tests

The RLS tests are plain SQL and run in two ways:

```bash
# Against local Supabase (after `supabase db reset`):
DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run test:db

# Against any plain PostgreSQL 15+, no Docker needed (CI): installs a minimal stand-in
# for Supabase's auth/storage schemas into a scratch database, then migrates and tests.
SHIM=1 DB_URL=postgresql://postgres@localhost:5432/postgres npm run test:db
```

## Internationalization

### What is supported

- 16 languages ship: English, Persian, Arabic, Kurdish (Sorani), Turkish, Urdu, Hindi,
  Russian, Chinese (Simplified), Spanish, French, German, Portuguese, Indonesian,
  Bengali and Hebrew.
- The device language is detected on first launch. The language picker is the first
  onboarding screen and can be changed later in Settings without reinstalling.
- RTL (Persian, Arabic, Kurdish Sorani, Urdu, Hebrew) mirrors the whole layout,
  navigation and directional icons. When a language change also changes direction, the
  app restarts once, because that is how React Native applies layout direction.
- Numbers, money and dates are formatted per locale. Native digits (۱۲۳, ١٢٣, १२३, ১২৩)
  can be switched to Latin digits in Settings. Typed amounts accept any of those digits.
- Calendars: Gregorian, Persian (Solar Hijri) and Islamic (Hijri, tabular civil), chosen
  in Settings. The calendar code is tested day-by-day against ICU for 1900-2100.
- Currencies: all active ISO 4217 codes, with correct minor units (JPY 0, KWD 3, ...).
  Iranian rial can be shown as **toman** (1 toman = 10 rial); amounts are always stored
  in rial.
- Money is always an integer number of minor units. Parsing and display never use
  floating point.

### Add a new language

1. Copy `src/i18n/locales/en.json` to `src/i18n/locales/<code>.json`. `<code>` is a BCP 47
   tag, e.g. `it`, `pt-BR`, `zh-Hant`.
2. Translate the values (keep the keys, and keep `{{variables}}` and `{day}`-style
   placeholders as they are).
3. Fill in `meta`:
   ```json
   "meta": {
     "name": "Italian",           // English name
     "nativeName": "Italiano",    // shown in the language picker
     "dir": "ltr",                // or "rtl"
     "script": "latn",            // latn|cyrl|arab|hebr|deva|beng|hans|hant|other (selects the font)
     "nativeDigits": "latn",      // latn|arab|arabext|deva|beng
     "defaultDigits": "latin",    // "native" to show native digits by default
     "defaultCalendar": "gregory" // gregory|persian|islamic
   }
   ```
4. Run `npm run i18n:check`.

That's all. The language list, device detection and the iOS/Android per-app language
settings all pick up the new file automatically. A key missing from a translation falls
back to English at runtime.

### RTL rules for contributors

- Use logical style properties only: `marginStart`/`marginEnd`, `paddingStart`/`paddingEnd`,
  `start`/`end`, `borderStartWidth`... ESLint rejects `left`/`right` variants.
- Leave `textAlign` unset (it follows the language) unless you need `center`.
- Arrows and chevrons: use `<Icon directional />` so they flip in RTL.
- Phone numbers, emails and codes stay LTR (`<TextField ltr />`, or wrap the value in
  `⁦…⁩` inside a sentence).
- Never hard-code user-facing text: add a key to `en.json` (and the other locales).

## Records (loans), offline use and sync

- **Create / edit / cancel** a record: direction (I lent / I borrowed), the other person
  (typed or picked from contacts, phone optional), amount and currency, date, optional
  pay-back date, note and a receipt photo. Dates are picked in the person's calendar.
- **Nothing is ever overwritten.** Every change, cancellation included, creates a new
  version in `loan_versions` (written by a database trigger, not by the app), and the
  record screen shows that history. Records are cancelled, never deleted.
- **Re-confirmation.** Changing the amount, currency, dates, note or photo of a record
  the other person already confirmed (or disputed) puts it back to *waiting for
  confirmation*. Renaming the other person doesn't.
- **Local-first.** Every screen reads from a SQLite copy on the phone, so the app works
  fully offline. Changes go into an outbox and are sent when the network is back: on app
  start, on return to the foreground, on reconnect, every minute, and on pull-to-refresh.
  - Records get their ID on the phone, so a retry after a lost reply never creates a
    duplicate.
  - Several edits made offline are merged into one change.
  - If the server copy changed in the meantime (e.g. the other person confirmed), the
    edit is re-applied on top of the latest version: the fields you changed win, and
    the server's rules still apply.
  - If the server refuses a change for good (the record was settled meanwhile), the
    change is dropped and a short notice explains it.
- Photos are copied into the app's storage and uploaded with the next sync. Old photos
  are kept, because older versions in the history refer to them.
- Signing out deletes this account's local data from the phone (with a warning if some
  changes haven't been sent yet).

## Privacy and security

- Row Level Security on every table: a person can read and change only their own
  profile. A record and its history are visible only to its two parties, and only its
  creator can edit it.
- The app can't confirm its own records, mark them settled, change who the parties are,
  or touch the share token. Column privileges and triggers enforce this in the database,
  and `supabase/tests/002_loans.test.sql` checks each rule.
- Receipt photos live in a private bucket under `<record id>/`. Both parties can view
  them; only the creator can add them.
- `phone` and `email` on a profile are copied from the verified sign-in by a database
  trigger and cannot be written by the app, so nobody can claim someone else's number.
- Avatars live in a private bucket under `<user id>/`. Only the owner can read or write
  them, through short-lived signed URLs.
- Session tokens are stored in the iOS Keychain / Android Keystore (`expo-secure-store`),
  chunked because sessions are larger than one SecureStore item allows.
- Sign-in uses PKCE. OTP codes and links are rate-limited by Supabase Auth.

## Building and publishing

EAS build profiles and the step-by-step Google Play and App Store guide are part of
Phase 6.
