import { toDigitSystem, toLatinDigits } from '../digits';
import { formatAmount, formatDate, formatMoney, type FormatContext, type FormatLabels } from '../format';

import en from '../../i18n/locales/en.json';
import fa from '../../i18n/locales/fa.json';

const labels = (l: typeof en): FormatLabels => ({
  toman: l.currency.toman,
  months: l.months as FormatLabels['months'],
  dateLong: l.date.long,
  dateShort: l.date.short,
});

const enCtx: FormatContext = { locale: 'en', digits: 'latn', calendar: 'gregory', labels: labels(en) };
const faCtx: FormatContext = { locale: 'fa', digits: 'arabext', calendar: 'persian', irrAsToman: true, labels: labels(fa) };

describe('digits', () => {
  it('transliterates both ways', () => {
    expect(toDigitSystem('2024', 'arabext')).toBe('۲۰۲۴');
    expect(toDigitSystem('1,250.5', 'arab', true)).toBe('١٬٢٥٠٫٥');
    expect(toDigitSystem('a, b.', 'arab')).toBe('a, b.'); // free text keeps punctuation
    expect(toLatinDigits('۱۲۳٫۴')).toBe('123.4');
  });
});

describe('formatMoney', () => {
  it('formats in English', () => {
    expect(formatMoney(125050, 'USD', enCtx)).toBe('$1,250.5');
    expect(formatMoney(100000, 'USD', enCtx)).toBe('$1,000');
    expect(formatMoney(-500, 'EUR', enCtx)).toBe('-€5');
  });

  it('shows IRR as toman with Persian digits', () => {
    expect(formatMoney(5000000, 'IRR', faCtx)).toBe('۵۰۰٬۰۰۰ تومان');
  });

  it('shows IRR in rial when toman is off', () => {
    expect(formatAmount(5000000, 'IRR', { ...faCtx, irrAsToman: false })).toBe('۵٬۰۰۰٬۰۰۰');
  });

  it('uses locale grouping', () => {
    expect(formatAmount(123456789, 'INR', { ...enCtx, locale: 'hi' })).toBe('12,34,567.89');
    expect(formatAmount(123456789, 'EUR', { ...enCtx, locale: 'de' })).toBe('1.234.567,89');
  });
});

describe('formatDate', () => {
  it('formats in each calendar', () => {
    expect(formatDate('2026-10-14', enCtx)).toBe('14 October 2026');
    expect(formatDate('2026-10-14', faCtx)).toBe('۲۲ مهر ۱۴۰۵');
    expect(formatDate('2026-10-14', faCtx, 'short')).toBe('۱۴۰۵/۰۷/۲۲');
    expect(formatDate('2024-07-08', { ...enCtx, calendar: 'islamic' })).toBe('1 Muharram 1446');
  });
});
