import en from '../../i18n/locales/en.json';
import fa from '../../i18n/locales/fa.json';
import type { FormatContext } from '../format';
import { reminderMessage, renderNotification, type NotificationData } from '../notifications';

type Dict = Record<string, unknown>;
const makeT = (dict: Dict) => (key: string, params: Record<string, string> = {}) => {
  const raw = key.split('.').reduce<unknown>((n, p) => (n as Dict)?.[p], dict);
  return typeof raw === 'string' ? raw.replace(/\{\{(\w+)\}\}/g, (_, k: string) => params[k] ?? '') : key;
};
const ctx = (l: typeof en, locale: string, digits: FormatContext['digits'], calendar: FormatContext['calendar']): FormatContext => ({
  locale, digits, calendar, irrAsToman: locale === 'fa',
  labels: { toman: l.currency.toman, months: l.months as FormatContext['labels']['months'], dateLong: l.date.long, dateShort: l.date.short },
});

const data: NotificationData = {
  loan_id: 'x', name: 'Ali', amount_minor: 5000000, currency: 'IRR', remaining_minor: 3000000, repayment_minor: 2000000,
};
const I = (s: string) => `⁨${s}⁩`;

describe('renderNotification', () => {
  it('writes every kind in English without missing keys', () => {
    const t = makeT(en as Dict);
    for (const kind of ['loan_confirmed', 'loan_disputed', 'loan_changed', 'repayment_new', 'repayment_recorded',
      'repayment_confirmed', 'repayment_disputed', 'settled', 'reminder', 'due_today'] as const) {
      const n = renderNotification(kind, { ...data, comment: 'x', tone: 'neutral', greet_name: 'Sara', loan_date: '2026-10-01' }, t, ctx(en, 'en', 'latn', 'gregory'));
      expect(n.title).not.toMatch(/^push\./);
      expect(n.body).not.toMatch(/^push\.|reminders\./);
    }
  });

  it('renders Persian with toman, Persian digits and calendar', () => {
    const n = renderNotification('repayment_confirmed', data, makeT(fa as Dict), ctx(fa as typeof en, 'fa', 'arabext', 'persian'));
    expect(n.title).toBe(`${I('Ali')} بازپرداخت شما را تأیید کرد`);
    expect(n.body).toBe('۲۰۰٬۰۰۰ تومان تأیید شد. باقی‌مانده: ۳۰۰٬۰۰۰ تومان.');
  });

  it('greets the borrower by name in reminders and shows what is still open', () => {
    const n = renderNotification('reminder', { ...data, tone: 'gentle', greet_name: 'Sara', loan_date: '2026-10-01' },
      makeT(en as Dict), ctx(en, 'en', 'latn', 'gregory'));
    expect(n.title).toBe(`A reminder from ${I('Ali')}`);
    expect(n.body).toContain(`Hi ${I('Sara')}`);
    expect(n.body).toContain('1 October 2026');
    expect(n.body).toMatch(/3,000,000/);
  });

  it('tells a lender whose borrower has no app that they can send a reminder', () => {
    const n = renderNotification('due_today', { ...data, borrower_has_app: false }, makeT(en as Dict), ctx(en, 'en', 'latn', 'gregory'));
    expect(n.body).toMatch(/send them a reminder/);
  });
});

describe('reminderMessage', () => {
  it('has three tones that differ', () => {
    const t = makeT(en as Dict);
    const v = { greetName: 'Sara', amountMinor: 2000, currency: 'USD', loanDate: '2026-10-01' };
    const msgs = (['gentle', 'neutral', 'firm'] as const).map((tone) => reminderMessage(tone, v, t, ctx(en, 'en', 'latn', 'gregory')));
    expect(new Set(msgs).size).toBe(3);
    for (const m of msgs) expect(m).toContain('$20');
  });
});
