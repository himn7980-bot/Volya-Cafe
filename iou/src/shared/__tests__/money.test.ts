import { minorDigits } from '../currencies';
import { minorToDecimalString, parseAmount, splitMinor } from '../money';

describe('minorDigits', () => {
  it('knows the common exceptions', () => {
    expect(minorDigits('USD')).toBe(2);
    expect(minorDigits('JPY')).toBe(0);
    expect(minorDigits('KWD')).toBe(3);
    expect(minorDigits('IRR')).toBe(0);
    expect(minorDigits('XYZ')).toBe(2);
  });
});

describe('parseAmount', () => {
  it.each([
    ['12', 'USD', 1200],
    ['12.5', 'USD', 1250],
    ['12,50', 'USD', 1250],
    ['1,250.50', 'USD', 125050],
    ['1.250,50', 'EUR', 125050],
    ['1,000', 'USD', 100000],
    ['1.000.000', 'EUR', 100000000],
    ['1 250', 'EUR', 125000],
    ['0.01', 'USD', 1],
    ['1.500', 'JPY', 1500],
    ['500000', 'IRR', 500000],
    ['1.234', 'KWD', 1234],
    ['  42 ', 'USD', 4200],
    // More digits after a single separator than the currency allows: it's grouping.
    ['12.345', 'USD', 1234500],
  ])('%s %s -> %d', (input, currency, expected) => {
    expect(parseAmount(input, currency)).toBe(expected);
  });

  it('reads Persian, Arabic-Indic, Devanagari and Bengali digits', () => {
    expect(parseAmount('۵۰۰٬۰۰۰', 'IRR')).toBe(500000);
    expect(parseAmount('١٢٫٥', 'USD')).toBe(1250);
    expect(parseAmount('१२३', 'INR')).toBe(12300);
    expect(parseAmount('৫০', 'BDT')).toBe(5000);
  });

  it('treats IRR input as toman when toman display is on (stored in rial)', () => {
    expect(parseAmount('50,000', 'IRR', { irrAsToman: true })).toBe(500000);
    expect(parseAmount('1.5', 'IRR', { irrAsToman: true })).toBe(15);
    expect(parseAmount('1.5', 'IRR')).toBe(15); // "1.5" rial is not valid -> grouping -> 15
  });

  it.each([[''], ['abc'], ['1.234,567'], ['1-2'], ['.'], ['--5'], ['5e3']])('rejects %p', (input) => {
    expect(parseAmount(input, 'USD')).toBeNull();
  });

  it('rejects amounts beyond safe integer range', () => {
    expect(parseAmount('99999999999999999999', 'USD')).toBeNull();
  });
});

describe('splitMinor / minorToDecimalString', () => {
  it('splits without floating point', () => {
    expect(splitMinor(125050, 'USD')).toEqual({ negative: false, integer: '1250', fraction: '5' });
    expect(splitMinor(5, 'USD')).toEqual({ negative: false, integer: '0', fraction: '05' });
    expect(splitMinor(-100, 'USD')).toEqual({ negative: true, integer: '1', fraction: '' });
    expect(splitMinor(1234, 'KWD')).toEqual({ negative: false, integer: '1', fraction: '234' });
    expect(splitMinor(500000, 'IRR', { irrAsToman: true })).toEqual({ negative: false, integer: '50000', fraction: '' });
    expect(splitMinor(15, 'IRR', { irrAsToman: true })).toEqual({ negative: false, integer: '1', fraction: '5' });
  });

  it('round-trips with parseAmount', () => {
    for (const [minor, cur] of [[1, 'USD'], [123456789, 'USD'], [1001, 'KWD'], [77, 'JPY']] as const) {
      expect(parseAmount(minorToDecimalString(minor, cur), cur)).toBe(minor);
    }
  });

  it('refuses non-integers', () => {
    expect(() => splitMinor(1.5, 'USD')).toThrow();
  });
});
