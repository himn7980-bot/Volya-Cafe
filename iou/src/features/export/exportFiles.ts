// Export my records as a CSV file or a PDF report, then open the share sheet
// (save to Files, send by mail...). Everything is built on the phone from the
// local copy; nothing is uploaded.
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { TFunction } from 'i18next';

import { getStore, otherPartyName } from '@/features/loans/service';
import { brand } from '@/lib/brand';
import { todayIso } from '@/shared/calendars';
import { buildCsv, buildReportHtml, type ExportRow } from '@/shared/exportData';
import type { FormatContext } from '@/shared/format';

async function rows(userId: string): Promise<ExportRow[]> {
  const store = await getStore();
  const [loans, people] = await Promise.all([store.listLoans(), store.listPeople()]);
  return loans
    .filter((l) => l.status !== 'cancelled')
    .map((loan) => ({ loan, name: otherPartyName(loan, userId, people) }));
}

const fileName = (ext: string) => `${brand.slug}-${todayIso()}.${ext}`;

export async function exportCsv(userId: string, t: TFunction): Promise<void> {
  const file = new File(Paths.cache, fileName('csv'));
  if (file.exists) file.delete();
  file.create();
  file.write(buildCsv(await rows(userId), userId, (k, p) => t(k, p)));
  await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: t('export.csv') });
}

export async function exportPdf(userId: string, t: TFunction, fmt: FormatContext, dir: 'ltr' | 'rtl'): Promise<void> {
  const html = buildReportHtml(await rows(userId), userId, (k, p) => t(k, p), fmt, {
    dir,
    today: todayIso(),
    appName: brand.name,
  });
  const { uri } = await Print.printToFileAsync({ html });
  // Give the file a readable name instead of the random one.
  const named = new File(Paths.cache, fileName('pdf'));
  if (named.exists) named.delete();
  new File(uri).move(named);
  await Sharing.shareAsync(named.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: t('export.pdf') });
}
