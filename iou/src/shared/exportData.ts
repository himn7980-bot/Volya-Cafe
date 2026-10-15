// Export of a person's records as CSV (for spreadsheets) and as an HTML
// document that the app prints to PDF. Pure TS.

import { formatDate, formatMoney, type FormatContext } from './format';
import { directionFor } from './loans';
import { minorToDecimalString } from './money';
import { remainingOf, totals, type SummaryLoan } from './people';

export type Translate = (key: string, params?: Record<string, string>) => string;

export interface ExportRow {
  loan: SummaryLoan;
  /** The other person's name as shown in the app. */
  name: string;
}

/**
 * Spreadsheet cell: quoted when needed. Cells starting with = + - @ are
 * prefixed with ' so a spreadsheet never runs them as formulas (someone else
 * could have typed the name or note).
 */
export function csvCell(value: string): string {
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** CSV with machine-friendly values (ISO dates, plain decimals) and translated headers. */
export function buildCsv(rows: readonly ExportRow[], userId: string, t: Translate): string {
  const header = [
    t('export.colDate'),
    t('export.colDirection'),
    t('export.colPerson'),
    t('export.colAmount'),
    t('export.colCurrency'),
    t('export.colRepaid'),
    t('export.colRemaining'),
    t('export.colStatus'),
    t('export.colDue'),
    t('export.colNote'),
  ];
  const lines = rows.map(({ loan: l, name }) => [
    l.loanDate,
    t(directionFor(l, userId) === 'lent' ? 'export.lent' : 'export.borrowed'),
    name,
    // Plain decimals in the stored unit (IRR in rial) so spreadsheets can add them up.
    minorToDecimalString(l.amountMinor, l.currency),
    l.currency,
    minorToDecimalString(l.repaidMinor, l.currency),
    minorToDecimalString(remainingOf(l), l.currency),
    t(`status.${l.status}`),
    l.dueDate ?? '',
    l.note,
  ]);
  // BOM so Excel opens UTF-8 (Persian, Arabic...) correctly.
  return '﻿' + [header, ...lines].map((cols) => cols.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** A printable report: totals per currency, then every record. */
export function buildReportHtml(
  rows: readonly ExportRow[],
  userId: string,
  t: Translate,
  fmt: FormatContext,
  opts: { dir: 'ltr' | 'rtl'; today: string; appName: string },
): string {
  const e = escapeHtml;
  const sum = totals(rows.map((r) => r.loan), userId);
  const totalList = (m: Map<string, number>) =>
    m.size ? [...m].map(([cur, v]) => `<li>${e(formatMoney(v, cur, fmt))}</li>`).join('') : '<li>—</li>';
  const body = rows
    .map(({ loan: l, name }) => {
      const lent = directionFor(l, userId) === 'lent';
      return `<tr>
  <td>${e(formatDate(l.loanDate, fmt))}</td>
  <td>${e(name)}</td>
  <td>${e(t(lent ? 'export.lent' : 'export.borrowed'))}</td>
  <td class="num">${e(formatMoney(l.amountMinor, l.currency, fmt))}</td>
  <td class="num">${e(formatMoney(remainingOf(l), l.currency, fmt))}</td>
  <td>${e(t(`status.${l.status}`))}</td>
  <td>${e(l.note)}</td>
</tr>`;
    })
    .join('\n');

  return `<!doctype html>
<html dir="${opts.dir}" lang="${e(fmt.locale)}">
<head>
<meta charset="utf-8">
<style>
  body { font-family: -apple-system, system-ui, "Noto Sans", "Vazirmatn", sans-serif; color: #1C1B19; margin: 32px; font-size: 13px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .muted { color: #5E5B54; }
  .totals { display: flex; gap: 32px; margin: 16px 0 24px; }
  .totals h2 { font-size: 14px; margin: 0 0 4px; }
  .totals ul { margin: 0; padding: 0; list-style: none; font-size: 16px; font-weight: bold; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: start; padding: 6px 8px; border-bottom: 1px solid #D9D5CB; vertical-align: top; }
  th { background: #EFEDE6; }
  td.num { white-space: nowrap; unicode-bidi: plaintext; }
</style>
</head>
<body>
  <h1>${e(t('export.reportTitle'))}</h1>
  <p class="muted">${e(opts.appName)} · ${e(t('export.generated', { date: formatDate(opts.today, fmt) }))}</p>
  <div class="totals">
    <div><h2>${e(t('dashboard.owedToYou'))}</h2><ul>${totalList(sum.owedToMe)}</ul></div>
    <div><h2>${e(t('dashboard.youOweTotal'))}</h2><ul>${totalList(sum.iOwe)}</ul></div>
  </div>
  <table>
    <thead><tr>
      <th>${e(t('export.colDate'))}</th><th>${e(t('export.colPerson'))}</th><th>${e(t('export.colDirection'))}</th>
      <th>${e(t('export.colAmount'))}</th><th>${e(t('export.colRemaining'))}</th><th>${e(t('export.colStatus'))}</th><th>${e(t('export.colNote'))}</th>
    </tr></thead>
    <tbody>
${body}
    </tbody>
  </table>
</body>
</html>`;
}
