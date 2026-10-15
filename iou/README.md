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
| 3 | Share link + public confirmation web page | **done** |
| 4 | Repayments, reminders, push notifications | **done** |
| 5 | Dashboard, export, settings, polish | **done** |
| 6 | Tests, CI, EAS build config, store publishing guide | **done** |

Ready for full testing: see the step-by-step guide in Persian,
[docs/testing-fa.md](docs/testing-fa.md).

After launch: group trips ([design](docs/group-trips.md)), then a travel companion and
more group-money features ([roadmap](docs/roadmap.md)).

## Tech stack

- **Expo SDK 57** (managed workflow, TypeScript, Expo Router), one codebase for Android and iOS
- **Supabase**: Postgres with Row Level Security, Auth (phone OTP, email magic link, Google, Apple on iOS), Storage
- **State**: Zustand (device preferences, session) + TanStack Query (server data)
- **i18n**: i18next + react-i18next + expo-localization, 16 languages, full RTL
- **Fonts**: Vazirmatn (Arabic script), Noto Sans / Devanagari / Bengali / Hebrew; system font for Chinese

## Project layout

```
brand.json                 app name, scheme, bundle IDs, contact email (rename here)
app.config.ts              Expo config (reads brand.json and the locale list)
eas.json                   EAS build profiles (development, preview, production)
src/
  app/                     screens (Expo Router: every file is a route)
    onboarding.tsx         language picker, then welcome
    sign-in.tsx, verify.tsx, auth-callback.tsx
    (app)/                 signed-in area: dashboard, loans/, person/, profile, settings
    _layout.tsx            root providers, auth guards, crash screen (ErrorBoundary)
  components/              UI kit, calendar-aware date picker, currency list
  features/
    auth/, profile/        sign-in and profile data
    loans/
      localStore.ts        SQLite cache + outbox of unsent changes
      syncEngine.ts        push/pull logic (pure, unit-tested)
      remote.ts            Supabase implementation of the sync "Remote"
      service.ts           hooks, sync scheduling, photos
      LoanForm.tsx, components.tsx, summaryUI.tsx (totals, people)
    notifications/         push permission, token, opening tapped notifications
    export/                CSV and PDF export
    account/               account deletion
  i18n/
    locales/*.json         one file per language  <- add languages here
    languages.ts           registry + device language matching
    direction.ts           RTL switching
  shared/                  pure TS (no React Native): money, currencies,
                           calendars, digits, formatting, loan rules,
                           balances, dashboard totals, export.
                           Reused by the web page and the Edge Functions.
  stores/settings.ts       device preferences (persisted)
  theme/                   colors (light/dark), type scale, fonts
supabase/
  migrations/              SQL schema + RLS policies
  tests/                   RLS tests (plain SQL), runnable without Docker
  functions/               Edge Functions (Deno): push, delete-account
  setup/push_cron.sql      one-time job that calls the push function every minute
  config.toml              local Supabase settings
web/                       public confirmation page (static site, see below)
  src/main.ts, view.ts     page code (reuses src/shared and the app's locale files)
  public/                  HTML (incl. privacy.html), CSS, security headers
  build.mjs                builds web/dist
scripts/
  check-i18n.js            validates every locale against en.json
  test-db.sh               runs migrations + RLS tests
  sync-functions.mjs       copies shared code + texts into supabase/functions
docs/                      testing guide (Persian), future plans
../.github/workflows/iou-ci.yml   CI: every check below on each push
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
npm run check         # everything below that needs no database or Deno, in one go
npm run typecheck     # TypeScript
npm run lint          # ESLint (also blocks left/right styles, see "RTL rules")
npm test              # unit tests (money, calendars, formatting, languages, loan rules,
                      #   local store + sync engine on a real SQLite database)
npm run i18n:check    # every locale has every key and matching {{variables}}
npm run test:db       # database migrations + RLS tests (see below)
npm run web:build     # build the public confirmation page into web/dist
npm run functions:sync  # copy shared code + texts into supabase/functions (add -- --check in CI)
deno test supabase/functions   # Edge Function tests (needs Deno 2)
```

**Expo Go vs. development build.** Most of the app runs in Expo Go, but push
notifications need a development build. Switching
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
7. **Apple** (iOS): in the Apple Developer portal, enable *Sign in with Apple* for the
   app's identifier (EAS does this on the first build because `usesAppleSignIn` is on).
   In Supabase → Authentication → Providers → Apple, enable it and add the bundle id
   from `brand.json` (`app.iou.mobile`) to *Client IDs*. The native flow needs no secret.
   The button shows on iOS only; Android keeps phone, email and Google.
8. Copy *Project URL* and the *anon public* key into `.env.local` (and into EAS
   environment variables for builds, see "Building and publishing").

### Database tests

The RLS tests are plain SQL and run in two ways:

```bash
# Against local Supabase (after `supabase db reset`):
DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run test:db

# Against any plain PostgreSQL 15+, no Docker needed (CI): installs a minimal stand-in
# for Supabase's auth/storage schemas into a scratch database, then migrates and tests.
SHIM=1 DB_URL=postgresql://postgres:postgres@localhost:5432/postgres npm run test:db
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

## Share links and the confirmation page

Every record has a long random token (~244 random bits). The creator taps **Send to …**
on the record. The share sheet opens (WhatsApp, Telegram, SMS…) with a friendly message
and a link:

```
https://<your site>/c/#<token>
```

The token sits after `#`, so browsers never send it to any server: not to the static
host, not in logs, not to other sites via the Referer header.

The message is written in the **other person's language** when they have an account
(their profile language), otherwise in the sender's language. Amounts and dates in it
use that language's digits, calendar and toman setting.

The **page** opens without an app or account. It shows the record in the visitor's
language: `?lang=`, then their earlier choice, then the browser's languages, then the
writer's language. A language picker is always visible. The visitor can:

- **Confirm** → status *confirmed*.
- **Dispute with a comment** → status *disputed*. The comment shows up in the record's
  history for both people. The creator can fix the record, which asks again; a
  disputed record can still be confirmed later.

They're then invited to install the app. **"I have the app"** opens
`iou://claim?token=…`, which links the record to their account (even if they still have
to sign in first).

Rules enforced in the database (`supabase/migrations/*_sharing.sql`, tested in
`supabase/tests/003_sharing.test.sql`):

- The page only works while the record waits for an answer (pending or disputed) and for
  30 days after the last change. Once confirmed, the link shows only "already
  confirmed".
- An answer must name the version the visitor saw, so nobody confirms an amount the
  creator changed a moment ago.
- The public functions never return phone numbers or the token.
- Rate limits per IP address (hashed): 120 page views per 10 minutes, 20 failed lookups
  per hour (guessing tokens is pointless), 20 answers per hour; 5 answers per link per
  hour.
- Answers given through the link appear in the history without an account; answers in
  the app show who gave them.

**Linking accounts.** When someone signs up with the phone number the creator entered,
the records with that number become theirs too (both see them, and they can answer in the
app). Opening a share link in the app does the same.

### Deploy the confirmation page

The page is a static site (about 13 KB of JavaScript plus one small JSON file per
language). Host it anywhere static: Cloudflare Pages, Netlify, Vercel, GitHub Pages, S3…
(It isn't served from Supabase Edge Functions because they serve HTML as plain text on
`*.supabase.co`.)

```bash
# Uses EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY from .env.local
npm run web:build
# then upload web/dist, e.g.
npx wrangler pages deploy web/dist --project-name iou-confirm   # Cloudflare Pages
npx netlify deploy --prod --dir web/dist                        # Netlify
```

Then put your site's address in `brand.json` → `webBaseUrl` (the app uses it to build
links), and the real store URLs in `appStoreUrl` / `playStoreUrl`.

`web/public/_headers` sets security headers (no framing, no referrer, no caching of
`/c/`) on hosts that read it (Cloudflare Pages, Netlify); set the same headers elsewhere.
The page itself has a strict Content-Security-Policy and only talks to your Supabase
project.

## Repayments, reminders and notifications

**Repayments.** On a confirmed record, either person can record a repayment, partial or
full. The remaining balance updates automatically.

- Recorded by the **lender** (the one getting the money back): counts at once, because it
  only lowers what they're owed.
- Recorded by the **borrower**: the lender confirms or disputes it (with a comment). This
  happens in the app or, if the lender has no account, on the same confirmation page
  through the share link.
- Nobody can record more than is still open. When confirmed repayments cover the amount,
  the record becomes **settled** (and that's part of its history).
- A pending repayment can be withdrawn by whoever recorded it. Repayments are never edited.
- Repayments work offline like everything else.

**Reminders.** Only the lender can send them, and at most **one every 48 hours per
record** (enforced by the database), so nobody gets nagged.

- Pick a tone (gentle, neutral or firm) and see the message before sending.
- If the borrower has the app, they get a notification in their language. Otherwise the
  share sheet opens with the message, to send by WhatsApp, SMS, etc.
- With **"Remind them on the pay-back date"**, a daily job sends a gentle reminder on the
  due date (06:00 UTC) and tells the lender it's due.

**Notifications** are sent for:

- a record confirmed or disputed
- a record changed and needing confirmation again
- a repayment to confirm, recorded, confirmed or disputed
- a record settled
- reminders, and due dates

Events go into a queue table (`notifications`). The `push` Edge Function sends them
through the Expo Push API in each recipient's language, removes phones that uninstalled
the app, and retries failures. The app asks for notification permission after the first
record is created, when the benefit is obvious.

### Set up push notifications

1. `npx eas-cli init` and put the project id in `.env.local` as `EAS_PROJECT_ID`.
2. Android: create a Firebase project and upload its FCM v1 service account key with
   `npx eas-cli credentials` (Expo's push guide walks through it). iOS: EAS handles the
   APNs key during the first build.
3. Deploy the function and set its secret:
   ```bash
   npm run functions:sync
   npx supabase functions deploy push --no-verify-jwt
   npx supabase secrets set PUSH_CRON_SECRET=<a long random string>
   # optional, if you turn on "push security" in Expo: EXPO_ACCESS_TOKEN=...
   ```
4. Enable `pg_cron` and `pg_net` (Database → Extensions), then run
   `supabase/setup/push_cron.sql` once in the SQL editor, after filling in your project
   URL and the secret.

Push needs a development or store build: Expo Go can't receive remote notifications on
Android.

## Dashboard, people and export

- **Totals** at the top of the home screen: what others owe you and what you owe, one
  line per currency. Different currencies are never added together. Only what is still
  open counts (amount minus confirmed repayments); cancelled and settled records don't.
- **Records** tab (open / closed) and **People** tab: one row per person with the net
  balance per currency ("Owes you $20", "You owe €5"). A person is matched by their
  account when linked, otherwise by the phone number or name you typed. Tap a person to
  see every record between you and add a new one with their details filled in.
- **Export** (Settings → Your data): a CSV file for spreadsheets (UTF-8 with BOM so Excel
  shows every script, plain decimals, ISO dates, formula injection neutralised) or a
  printable PDF report in your language and direction. Both are built on the phone from
  the local copy and opened in the share sheet.

## Delete account

Settings → **Delete my account** calls the `delete-account` Edge Function with the
user's own access token. It removes their avatar and the receipt photos of every record
they wrote from Storage, then deletes the auth user. The database cascade does the rest:
profile, records they wrote and their history, push tokens, queued notifications.
Records the other person wrote stay with them, with the link to the deleted account
removed (`supabase/tests/005_delete_account.test.sql`). The phone then clears its local
copy and returns to the sign-in screen.

Deploy it once (the gateway checks the JWT, so keep JWT verification on):

```bash
npx supabase functions deploy delete-account
```

## Privacy and security

- Row Level Security on every table: a person can read and change only their own
  profile. A record and its history are visible only to its two parties, and only its
  creator can edit it.
- The app can't confirm its own records, mark them settled, change who the parties are,
  or touch the share token. Column privileges and triggers enforce this in the database,
  and `supabase/tests/002_loans.test.sql` checks each rule.
- About the other person, the app only ever receives their name, language and photo
  (`my_counterparts()`), and only for people you share a record with. Never their
  phone number or email.
- The notification queue and push tokens can't be read through the API. Only the push
  function (service role) uses them, and a token always belongs to whoever signed in
  last on that phone.
- Receipt photos live in a private bucket under `<record id>/`. Both parties can view
  them; only the creator can add them.
- `phone` and `email` on a profile are copied from the verified sign-in by a database
  trigger and cannot be written by the app, so nobody can claim someone else's number.
- Avatars live in a private bucket under `<user id>/`. Only the owner can read or write
  them, through short-lived signed URLs.
- Session tokens are stored in the iOS Keychain / Android Keystore (`expo-secure-store`),
  chunked because sessions are larger than one SecureStore item allows.
- Sign-in uses PKCE. OTP codes and links are rate-limited by Supabase Auth.
- People can export all their records and delete their account and data from Settings,
  as both stores require. The privacy policy template is `web/public/privacy.html`
  (served at `https://<site>/privacy.html`); have it reviewed before launch.

## Continuous integration

`.github/workflows/iou-ci.yml` (at the repository root) runs on every push and pull
request that touches `iou/`:

- **app**: `npm ci`, typecheck, lint, i18n check, unit tests, the Edge Function copy
  check, the confirmation page build and an Android + iOS JavaScript bundle
- **database**: all migrations and RLS tests on a PostgreSQL 16 service (`SHIM=1`)
- **functions**: `deno test` for the Edge Functions

## Building and publishing

Builds run on [EAS](https://expo.dev/eas) (Expo's build service), so you don't need
Android Studio or a Mac. Profiles in `eas.json`:

| Profile | What you get | Use it for |
| --- | --- | --- |
| `development` | APK / iOS build with the dev client | daily development on a real phone, push testing |
| `development-simulator` | iOS simulator build | development on a Mac |
| `preview` | APK / ad-hoc iOS build, installed from a link | testers before a release |
| `production` | AAB (Android) / App Store build, version auto-incremented | the stores |

### One-time setup

1. Create an account on [expo.dev](https://expo.dev), then:
   ```bash
   npx eas-cli login
   npx eas-cli init                 # creates the EAS project; copy its id
   ```
   Put the project id in `.env.local` as `EAS_PROJECT_ID`, and add it to EAS too (below).
2. Rename the app if you haven't (`brand.json`), replace the icons in `assets/`, and set
   `webBaseUrl` to where the confirmation page and privacy policy are deployed.
3. Give EAS builds the same settings as `.env.local`, once per environment
   (`development`, `preview`, `production`):
   ```bash
   npx eas-cli env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL --value https://<ref>.supabase.co --visibility plaintext
   npx eas-cli env:create --environment production --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon key> --visibility plaintext
   npx eas-cli env:create --environment production --name EAS_PROJECT_ID --value <project id> --visibility plaintext
   ```
   (The anon key is public by design, so it's embedded in the app. Never put the
   service-role key in the app or in `EXPO_PUBLIC_*` variables.)
4. Production backend: hosted Supabase set up as in "Set up Supabase", both Edge
   Functions deployed, the push cron job running, the web page deployed.

### Development and test builds

```bash
npx eas-cli build --profile development --platform android   # install the APK from the link
npx expo start --dev-client                                    # then open the app on the phone
npx eas-cli device:create                                      # iOS: register test iPhones first
npx eas-cli build --profile preview --platform all             # builds to hand to testers
```

### Google Play

1. Create a [Play Console](https://play.google.com/console) developer account (one-time
   fee). Personal accounts created after November 2023 must run a closed test with at
   least 12 testers for 14 days before they can publish to production. Plan for it.
2. **Create app**: name, default language, *App*, *Free*.
3. **App content** (all required):
   - *Privacy policy*: `https://<site>/privacy.html`
   - *App access*: give reviewers a way in. The easiest is a test phone number with a
     fixed code (Supabase → Authentication → Providers → Phone → test OTP, e.g.
     `+15555550100` / `123456`).
   - *Ads*: no ads. *Content rating*: fill the questionnaire (no objectionable content).
   - *Target audience*: 18+ (it's about money between adults).
   - *Data safety*: collected and linked to the user, not shared, not sold, encrypted in
     transit, deletable in the app: **personal info** (name, email, phone number),
     **photos** (optional receipt photos and avatar), **financial info → other**
     (records the user types), **app activity → other user-generated content** (notes,
     comments), **device IDs** (push token). Purpose: app functionality and account
     management.
   - *Account deletion*: in the app (Settings → Delete my account), and the web link
     `https://<site>/privacy.html#delete`.
   - *Financial features*: the app doesn't offer loans or move money; choose the option
     that it provides none of the listed features.
4. **Store listing**: short and full description, icon 512×512, feature graphic
   1024×500, at least 2 phone screenshots. Add translations for your main languages.
5. **First build**:
   ```bash
   npx eas-cli build --profile production --platform android
   ```
   Download the `.aab` and upload it by hand to *Testing → Internal testing* the first
   time (Google requires one manual upload for a new app). Play App Signing is on by
   default; EAS keeps your upload key.
6. **Later builds** can be submitted from the command line. In Google Cloud, create a
   service account, grant it access in Play Console → Users and permissions, download its
   JSON key as `google-service-account.json` (git-ignored) and run:
   ```bash
   npx eas-cli submit --platform android --profile production   # uploads to the internal track as a draft
   ```
7. Promote internal → closed testing → production from Play Console when ready.

### App Store

1. Join the [Apple Developer Program](https://developer.apple.com/programs/) (yearly fee).
2. In [App Store Connect](https://appstoreconnect.apple.com) → *Apps* → *+*: new iOS app
   with the bundle ID from `brand.json` (`iosBundleIdentifier`). Put its *Apple ID*
   (a number) in `eas.json` → `submit.production.ios.ascAppId`.
3. Build and send to TestFlight. EAS creates the certificates and provisioning profiles
   the first time (answer *yes* when it asks to log in to Apple):
   ```bash
   npx eas-cli build --profile production --platform ios
   npx eas-cli submit --platform ios --profile production
   ```
4. **App Privacy** (App Store Connect → App Privacy): data linked to the user, not used
   for tracking: *Contact info* (name, email, phone number), *User content* (photos,
   other user content), *Identifiers* (user ID), *Financial info → other financial info*.
   Purpose: app functionality.
5. **Review information**: the same test phone number and code as for Google, plus a
   short note: "Records informal loans between friends. The app never moves money."
6. **Sign in with Apple** is built in on iOS (guideline 4.8 asks for it when Google
   sign-in is offered). Make sure it is enabled in Supabase (see "Hosted project").
7. Account deletion (guideline 5.1.1(v)) is in the app. Encryption export compliance is
   already answered in `app.config.ts` (`ITSAppUsesNonExemptEncryption: false`).
8. Fill in the listing (description, keywords, support URL, privacy policy URL,
   screenshots for 6.9" and 6.5" iPhones; iPad too, since `supportsTablet` is on), pick
   the TestFlight build and *Submit for Review*.

### Releasing an update

1. Raise `version` in `app.config.ts` (for example `1.0.1`). Build numbers are
   incremented by EAS automatically (`autoIncrement`, remote version source).
2. Apply new migrations to production first (`npx supabase db push`) and redeploy
   functions if they changed. Migrations must stay compatible with the app version
   people already have.
3. `npx eas-cli build --profile production --platform all`, then `eas submit` for each
   platform.
