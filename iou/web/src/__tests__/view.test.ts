import en from '../../../src/i18n/locales/en.json';
import fa from '../../../src/i18n/locales/fa.json';
import { describeRecord, formatContextFor, makeT, pickLanguage, type LangMeta, type SharedLoan } from '../view';

const meta = (code: string, m: typeof en.meta): LangMeta => ({ code, ...m }) as LangMeta;

const loan: Extract<SharedLoan, { open: true }> = {
  status: 'pending', open: true, creator_name: 'Ali', language: 'fa', creator_role: 'lender',
  counterparty_name: 'Sara', amount_minor: 5000000, currency: 'IRR', note: 'rent',
  loan_date: '2026-10-14', due_date: '2026-11-01', has_photo: true, dispute_comment: null, version: 1,
};

describe('pickLanguage', () => {
  const codes = ['en', 'fa', 'ar', 'he', 'id', 'ckb'];
  it('prefers ?lang, then the saved choice, then the browser, then the writer', () => {
    expect(pickLanguage(codes, { query: 'ar', stored: 'fa', browser: ['en-US'], writer: 'fa' })).toBe('ar');
    expect(pickLanguage(codes, { stored: 'fa', browser: ['en-US'] })).toBe('fa');
    expect(pickLanguage(codes, { browser: ['de-DE', 'fa-IR'], writer: 'en' })).toBe('fa');
    expect(pickLanguage(codes, { browser: ['de-DE'], writer: 'fa' })).toBe('fa');
    expect(pickLanguage(codes, { browser: ['iw-IL'] })).toBe('he');
    expect(pickLanguage(codes, {})).toBe('en');
  });
});

describe('makeT', () => {
  it('interpolates, falls back to English, and returns the key when missing', () => {
    const t = makeT({ a: { b: 'سلام {{name}}' } }, { a: { c: 'Hi {{appName}}' } }, { appName: 'IOU' });
    expect(t('a.b', { name: 'X' })).toBe('سلام X');
    expect(t('a.c')).toBe('Hi IOU');
    expect(t('nope.key')).toBe('nope.key');
  });
});

describe('describeRecord', () => {
  it('describes a loan in English', () => {
    const t = makeT(en, en, { appName: 'IOU' });
    const v = describeRecord(loan, t, formatContextFor(meta('en', en.meta), t));
    expect(v.headline).toBe(`\u2068Ali\u2069 wrote down that they lent you ${v.amount}.`);
    expect(v.amount).toMatch(/5,000,000/);
    expect(v.details).toEqual(['Date: 14 October 2026', 'Pay back by: 1 November 2026', 'Note: rent', 'A receipt photo is attached in the app.']);
    expect(v.disputed).toBeNull();
  });

  it('uses toman, Persian digits and the Persian calendar for Persian visitors', () => {
    const t = makeT(fa, en, { appName: 'IOU' });
    const v = describeRecord({ ...loan, creator_role: 'borrower' }, t, formatContextFor(meta('fa', fa.meta as typeof en.meta), t));
    expect(v.amount).toBe('۵۰۰٬۰۰۰ تومان');
    expect(v.headline).toBe('⁨Ali⁩ ثبت کرده که ۵۰۰٬۰۰۰ تومان از شما قرض گرفته است.');
    expect(v.details[0]).toBe('تاریخ: ۲۲ مهر ۱۴۰۵');
  });

  it('shows the earlier dispute comment', () => {
    const t = makeT(en, en, {});
    const v = describeRecord({ ...loan, status: 'disputed', dispute_comment: 'It was 400' }, t, formatContextFor(meta('en', en.meta), t));
    expect(v.disputed).toBe("You said: “It was 400”. If it's been fixed, you can confirm it now.");
  });
});
