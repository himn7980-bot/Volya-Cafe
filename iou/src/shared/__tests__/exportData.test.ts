import { buildCsv, buildReportHtml, csvCell, escapeHtml } from '../exportData';
import type { FormatContext } from '../format';
import type { SummaryLoan } from '../people';

const t = (key: string, params?: Record<string, string>) => (params ? `${key}(${Object.values(params).join(',')})` : key);
const fmt: FormatContext = {
  locale: 'en',
  digits: 'latn',
  calendar: 'gregory',
  labels: { toman: 'toman', months: { gregory: [], persian: [], islamic: [] }, dateLong: '', dateShort: '' },
};

const loan: SummaryLoan = {
  id: 'l1',
  creatorId: 'me',
  lenderId: 'me',
  borrowerId: null,
  counterpartyName: 'Sara',
  counterpartyPhone: null,
  amountMinor: 125050,
  currency: 'USD',
  note: '=HYPERLINK("x"), lunch',
  loanDate: '2026-10-01',
  dueDate: null,
  photoPath: null,
  autoRemind: false,
  status: 'confirmed',
  shareToken: null,
  version: 1,
  createdAt: '',
  updatedAt: '',
  repaidMinor: 25050,
};

describe('csvCell', () => {
  it('quotes and neutralises formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('-5')).toBe("'-5");
    expect(csvCell('@x')).toBe("'@x");
  });
});

describe('buildCsv', () => {
  it('writes a BOM, headers and plain decimals', () => {
    const csv = buildCsv([{ loan, name: 'Sara' }], 'me', t);
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('export.colDate,export.colDirection,export.colPerson,export.colAmount,export.colCurrency,export.colRepaid,export.colRemaining,export.colStatus,export.colDue,export.colNote');
    expect(lines[1]).toBe(`2026-10-01,export.lent,Sara,1250.5,USD,250.5,1000,status.confirmed,,"'=HYPERLINK(""x""), lunch"`);
    expect(lines[2]).toBe('');
  });
});

describe('buildReportHtml', () => {
  it('escapes everything people typed', () => {
    const html = buildReportHtml([{ loan: { ...loan, note: '<script>' }, name: '<b>Sara</b>' }], 'me', t, fmt, {
      dir: 'rtl',
      today: '2026-10-15',
      appName: 'IOU',
    });
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('&lt;b&gt;Sara&lt;/b&gt;');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('$1,000');
  });
  it('escapeHtml covers quotes', () => {
    expect(escapeHtml(`"'&`)).toBe('&quot;&#39;&amp;');
  });
});
