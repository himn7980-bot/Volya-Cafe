# Long-term roadmap (after launch)

Direction agreed 2026-10-15: grow from "money between friends" into a **travel and
group companion**, one step at a time, without losing what makes the core work:
simple, warm, offline-first, every language.

Nothing here is built before the MVP (friendly loans, phases 1-6) has launched and real users tell
us which of these they want most.

## Principles

1. **Integrate, don't rebuild.** Navigation exists (Google Maps, Waze, Neshan,
   Balad). We open them with the right destination and remember places; we don't
   build a map app.
2. **Hands-free for drivers.** A driver must never need to look at or type on the
   phone. Voice goes through the phone's own assistants (Siri / App Intents, Google
   Assistant App Actions): "Hey Siri, add 200,000 toman fuel to the trip". (CarPlay and
   Android Auto only allow navigation, audio and messaging apps, so a companion app
   can't put screens there.)
3. **Still never hold or move money.** Anything that keeps or transfers money needs a
   banking licence. We stay a shared, trusted record.
4. **Every feature works offline and in all languages,** like the core.

## Stage A: travel companion (builds on [group trips](group-trips.md), the first post-launch feature)

- Trip checklist and shared notes (packing, documents, who brings what).
- Reminders: departure, check-in times, passport / visa / insurance expiry,
  medication.
- Saved places on a trip (hotel, meeting point, restaurants), opened in the person's
  navigation app. Expenses can be tagged with where they happened.
- Optional, time-limited live location sharing inside a trip group ("where is
  everyone?"), off by default.
- Voice capture of expenses and notes through Siri / Google Assistant, including
  Persian amounts ("دویست هزار تومن"). Speech recognition quality per language must be
  verified first; some languages need a cloud service (cost, like receipt reading).
- Pilgrimage and group-tour modes (e.g. Arbaeen: Iran → Iraq, toman / dinar / dollar),
  where one organizer manages many members.

## Stage B: more money between people

- Recurring shared bills (flatmates: rent, internet, utilities), split automatically
  each month.
- Family / friends savings circles (rotating "dowreh" / qard al-hasan funds): who paid
  in this round, whose turn it is. Records only, no money held.
- Trip and household budgets: planned vs. spent, per currency.
- Shared IOU groups outside trips (a team's lunch fund).

## Stage C: content (only if users ask)

- City / route guides are expensive to write and keep current. Prefer
  community-written tips inside a group, or partnerships, over our own guide content.

## What we do now to keep this cheap later

- Features stay in separate modules (`src/features/*`) on shared foundations: local
  store and sync, history, notifications, i18n.
- The notification and reminder system in phase 4 is built generically (any kind of
  reminder, not just loans).
- Large tap targets and short flows now make voice and "glance" use easier later.
- The name is one file (`brand.json`): if the product outgrows "IOU", renaming is cheap.
