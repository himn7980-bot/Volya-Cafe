# Group trips (planned: first feature after launch)

A group (friends on a trip, flatmates, a team dinner) records shared expenses as
they happen. When the trip is over, the app works out who owes whom and turns
the result into ordinary IOU records, so confirmation, repayments, reminders,
history and the dashboard all apply without extra work. As everywhere in IOU,
no money is moved.

## Decisions (agreed 2026-10-15)

| Topic | Decision |
| --- | --- |
| Closing a trip | The **creator** closes it. Members then have **24 hours** to object. |
| Reading receipts | Manual amounts. Automatic reading of receipts is a later, **optional paid add-on**. Photos are stored from day one so it can plug in later. |
| Currencies | Domestic trips: one currency. Trips abroad: **up to 3 currencies**, with exchange rates **entered by the group** from their exchange office. |
| Order | First feature after the MVP (friendly loans) has launched. |

## Members

- The creator makes a trip (name, currencies) and shares an invite link or QR code.
  Each person joins with their own phone, email or Google account, so their name is
  known.
- Someone without the app can be added by name (and optionally phone number). If they
  later sign up with that number, they are linked automatically, as share links are
  today.

## Expenses

- Who paid, amount, currency, date, optional note, category and receipt photo.
- Split: equally among everyone, equally among selected people ("only three of us had
  dinner"), or exact amounts per person.
- Any member can add expenses. Only the person who added an expense (or the creator)
  can edit it. Every change is versioned, like loans.
- Works offline: expenses go through the same local store and outbox as loans.

## Currencies and exchange rates

- A trip has a **settlement currency** (e.g. toman) and up to two other currencies
  (e.g. Iraqi dinar and US dollar).
- With three currencies, two rates connect them all. The group enters two rates from
  the exchange office, as any pair (toman→dinar and toman→dollar, or toman→dinar and
  dinar→dollar). The third is derived, so the rates can never contradict each other.
- Rates are stored as exact ratios (two integers), never floats. Every share is
  converted to the settlement currency in minor units with one fixed rounding rule.
- Rates can be changed until the trip is final. Changes are recorded in the trip
  history, and everyone sees the rate used.

## Closing and settling

1. The creator taps **Close trip**. Everyone gets a notification and sees the proposed
   result: what each person paid, their share, and the payments that settle it.
2. **24-hour window.** Members can still fix their own expenses, or raise an objection
   with a comment. An objection pauses the automatic finalization until the creator
   either fixes things and restarts the 24 hours, or closes anyway (visible to all).
3. After 24 hours without an open objection, the trip is **final** (done by a
   scheduled job on the server, even if nobody opens the app). Expenses and rates are
   locked.
4. Balances are settled with the **fewest payments**: the largest debtor pays the
   largest creditor, repeated. Instead of a dozen small transfers, a group of 6
   typically needs 5 payments or fewer.
5. Each payment becomes a normal IOU record between the two members ("Ali owes Sara
   320,000 toman, from trip *Karbala 1405*"), created as **confirmed** because everyone
   had the chance to object. Partial repayments and reminders then work as for any
   record.

Rounding: shares are computed in minor units. A remainder (e.g. 1 toman when 10 is
split three ways) is assigned deterministically, rotating by member order, so totals
always add up exactly.

## Later: reading receipts (optional, paid)

- On-device text recognition (Google ML Kit) is free and offline, but does not read
  Persian or Arabic script, so Persian receipts need a cloud service.
- Offered as an opt-in paid add-on. On phones, a digital feature like this has to be
  sold through Apple/Google in-app purchases.
- The app only **suggests** the total. The person always confirms or corrects it.
