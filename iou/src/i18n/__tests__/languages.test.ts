import { LANGUAGES, getLanguage, matchLanguage } from '../languages';

describe('language registry', () => {
  it('loads every locale file', () => {
    const codes = LANGUAGES.map((l) => l.code).sort();
    expect(codes).toEqual(
      ['ar', 'bn', 'ckb', 'de', 'en', 'es', 'fa', 'fr', 'he', 'hi', 'id', 'pt', 'ru', 'tr', 'ur', 'zh'].sort(),
    );
    expect(LANGUAGES[0]!.code).toBe('en');
  });

  it('marks RTL languages', () => {
    const rtl = LANGUAGES.filter((l) => l.meta.dir === 'rtl').map((l) => l.code).sort();
    expect(rtl).toEqual(['ar', 'ckb', 'fa', 'he', 'ur']);
  });

  it('matches device locales', () => {
    expect(matchLanguage(['fa-IR'])).toBe('fa');
    expect(matchLanguage(['ckb-IQ'])).toBe('ckb');
    expect(matchLanguage(['iw-IL'])).toBe('he');
    expect(matchLanguage(['zh-Hans-CN'])).toBe('zh');
    expect(matchLanguage(['xx-YY', 'pt-BR'])).toBe('pt');
    expect(matchLanguage(['xx'])).toBe('en');
  });

  it('falls back to English', () => {
    expect(getLanguage('nope').code).toBe('en');
  });
});
