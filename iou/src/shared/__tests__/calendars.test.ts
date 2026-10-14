import { addDays, addMonths, daysInMonth, fromIso, toIso, weekdayOfIso } from '../calendars';

describe('calendars', () => {
  it('converts well-known dates', () => {
    // Nowruz 1403 = 20 March 2024
    expect(fromIso('2024-03-20', 'persian')).toEqual({ year: 1403, month: 1, day: 1 });
    expect(toIso({ year: 1403, month: 1, day: 1 }, 'persian')).toBe('2024-03-20');
    // 1 Muharram 1446 (tabular civil) = 8 July 2024; the day before ends 1445
    expect(fromIso('2024-07-08', 'islamic')).toEqual({ year: 1446, month: 1, day: 1 });
    expect(fromIso('2024-07-07', 'islamic')).toEqual({ year: 1445, month: 12, day: 30 });
    expect(fromIso('2026-10-14', 'gregory')).toEqual({ year: 2026, month: 10, day: 14 });
  });

  it('knows Persian leap years', () => {
    expect(daysInMonth(1403, 12, 'persian')).toBe(30); // 1403 is leap
    expect(daysInMonth(1404, 12, 'persian')).toBe(29);
    expect(daysInMonth(1404, 1, 'persian')).toBe(31);
    expect(daysInMonth(1404, 7, 'persian')).toBe(30);
  });

  it('round-trips every day from 1925 to 2075 in every calendar', () => {
    for (let t = Date.UTC(1925, 0, 1); t < Date.UTC(2075, 0, 1); t += 86_400_000) {
      const iso = new Date(t).toISOString().slice(0, 10);
      for (const cal of ['gregory', 'persian', 'islamic'] as const) {
        const d = fromIso(iso, cal);
        expect(d.day).toBeLessThanOrEqual(daysInMonth(d.year, d.month, cal));
        if (toIso(d, cal) !== iso) throw new Error(`${cal} round-trip failed for ${iso}`);
      }
    }
  });
});


describe('date helpers', () => {
  it('knows weekdays', () => {
    expect(weekdayOfIso('2000-01-01')).toBe(6); // Saturday
    expect(weekdayOfIso('2026-10-14')).toBe(3); // Wednesday
  });
  it('adds days across months and years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
  });
  it('adds months in each calendar, clamping the day', () => {
    expect(addMonths('2026-01-31', 1, 'gregory')).toBe('2026-02-28');
    // 31 Shahrivar 1405 + 1 month = 30 Mehr 1405 (Mehr has 30 days)
    expect(addMonths('2026-09-22', 1, 'persian')).toBe('2026-10-22');
    expect(addMonths('2026-10-14', 12, 'islamic')).toBe(addMonths(addMonths('2026-10-14', 6, 'islamic'), 6, 'islamic'));
  });
});
