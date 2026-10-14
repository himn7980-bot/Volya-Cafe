// Calendar conversions for Gregorian, Persian (Solar Hijri) and Islamic (Hijri).
//
// All dates in the app are plain calendar dates stored as ISO strings
// ('YYYY-MM-DD', Gregorian). Conversion goes through the Julian Day Number.
//
// - Persian uses the 33-year-cycle "jalaali" algorithm (Borkowski), which
//   matches the official Iranian calendar for 1178-3177 AP.
// - Islamic uses the arithmetic (tabular, civil) Hijri calendar. It is
//   deterministic on every device and on the web, but can differ by a day from
//   moon-sighting based calendars.
//
// Pure TS with no React Native imports so the web page can share it.

export type CalendarSystem = 'gregory' | 'persian' | 'islamic';

export interface CalendarDate {
  year: number;
  month: number; // 1-12
  day: number;
}

const div = (a: number, b: number) => ~~(a / b);
const mod = (a: number, b: number) => a - ~~(a / b) * b;

// ---------- Gregorian <-> JDN ----------

export function gregorianToJdn(gy: number, gm: number, gd: number): number {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
    div(153 * mod(gm + 9, 12) + 2, 5) +
    gd -
    34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

export function jdnToGregorian(jdn: number): CalendarDate {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const day = div(mod(i, 153), 5) + 1;
  const month = mod(div(i, 153), 12) + 1;
  const year = div(j, 1461) - 100100 + div(8 - month, 6);
  return { year, month, day };
}

// ---------- Persian (Solar Hijri) ----------

const BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394,
  2456, 3178,
];

function jalCal(jy: number) {
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0];
  let jump = 0;
  if (jy < jp || jy >= BREAKS[BREAKS.length - 1]) {
    throw new RangeError(`Persian year out of range: ${jy}`);
  }
  for (let i = 1; i < BREAKS.length; i += 1) {
    const jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

export function persianToJdn(jy: number, jm: number, jd: number): number {
  const r = jalCal(jy);
  return gregorianToJdn(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

export function jdnToPersian(jdn: number): CalendarDate {
  const gy = jdnToGregorian(jdn).year;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = gregorianToJdn(gy, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) return { year: jy, month: 1 + div(k, 31), day: mod(k, 31) + 1 };
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1; // r is the following year: leap === 1 means jy was leap
  }
  return { year: jy, month: 7 + div(k, 30), day: mod(k, 30) + 1 };
}

export function isPersianLeapYear(jy: number): boolean {
  return jalCal(jy).leap === 0;
}

// ---------- Islamic (tabular / civil) ----------

const ISLAMIC_EPOCH = 1948440; // JDN of 1 Muharram 1 AH (civil epoch, Friday 16 July 622)

export function islamicToJdn(y: number, m: number, d: number): number {
  return d + Math.ceil(29.5 * (m - 1)) + (y - 1) * 354 + Math.floor((3 + 11 * y) / 30) + ISLAMIC_EPOCH - 1;
}

export function jdnToIslamic(jdn: number): CalendarDate {
  const year = Math.floor((30 * (jdn - ISLAMIC_EPOCH) + 10646) / 10631);
  const month = Math.min(12, Math.ceil((jdn - (29 + islamicToJdn(year, 1, 1))) / 29.5) + 1);
  const day = jdn - islamicToJdn(year, month, 1) + 1;
  return { year, month, day };
}

export function isIslamicLeapYear(y: number): boolean {
  return mod(14 + 11 * y, 30) < 11;
}

// ---------- Generic API ----------

export function parseIsoDate(iso: string): CalendarDate {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) throw new RangeError(`Not an ISO date: ${iso}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function toIsoDate({ year, month, day }: CalendarDate): string {
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** Today's date (device local time) as an ISO string. */
export function todayIso(now: Date = new Date()): string {
  return toIsoDate({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
}

/** Convert a Gregorian ISO date into the given calendar. */
export function fromIso(iso: string, calendar: CalendarSystem): CalendarDate {
  const g = parseIsoDate(iso);
  if (calendar === 'gregory') return g;
  const jdn = gregorianToJdn(g.year, g.month, g.day);
  return calendar === 'persian' ? jdnToPersian(jdn) : jdnToIslamic(jdn);
}

/** Convert a date in the given calendar back to a Gregorian ISO string. */
export function toIso(date: CalendarDate, calendar: CalendarSystem): string {
  if (calendar === 'gregory') return toIsoDate(date);
  const jdn =
    calendar === 'persian'
      ? persianToJdn(date.year, date.month, date.day)
      : islamicToJdn(date.year, date.month, date.day);
  return toIsoDate(jdnToGregorian(jdn));
}

export function daysInMonth(year: number, month: number, calendar: CalendarSystem): number {
  switch (calendar) {
    case 'gregory':
      return new Date(Date.UTC(year, month, 0)).getUTCDate();
    case 'persian':
      if (month <= 6) return 31;
      if (month <= 11) return 30;
      return isPersianLeapYear(year) ? 30 : 29;
    case 'islamic':
      if (month === 12) return isIslamicLeapYear(year) ? 30 : 29;
      return month % 2 === 1 ? 30 : 29;
  }
}

/** Day of the week, 0 = Sunday ... 6 = Saturday (same in every calendar). */
export function weekdayOfIso(iso: string): number {
  const g = parseIsoDate(iso);
  return (gregorianToJdn(g.year, g.month, g.day) + 1) % 7;
}

/** Add whole days to an ISO date. */
export function addDays(iso: string, days: number): string {
  const g = parseIsoDate(iso);
  return toIsoDate(jdnToGregorian(gregorianToJdn(g.year, g.month, g.day) + days));
}

/** Add calendar months in the given calendar, clamping the day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(iso: string, months: number, calendar: CalendarSystem): string {
  const d = fromIso(iso, calendar);
  const index = d.year * 12 + (d.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return toIso({ year, month, day: Math.min(d.day, daysInMonth(year, month, calendar)) }, calendar);
}
