import { describe, expect, it } from 'vitest';
import { MESSAGES, pickLang, translate } from '../web/i18n.js';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('web i18n tables', () => {
  it('every key exists in both en and ko, with the same placeholders', () => {
    const en = Object.keys(MESSAGES.en).sort();
    expect(Object.keys(MESSAGES.ko).sort()).toEqual(en);
    for (const k of en) {
      const key = k as keyof typeof MESSAGES.en;
      expect(MESSAGES.ko[key].trim(), k).not.toBe('');
      expect(placeholders(MESSAGES.ko[key]), k).toEqual(placeholders(MESSAGES.en[key]));
    }
  });

  it('falls back to en for unknown or missing languages', () => {
    expect(pickLang('ko')).toBe('ko');
    expect(pickLang('fr')).toBe('en');
    expect(pickLang(undefined)).toBe('en');
    expect(translate('fr', 'diff.prev')).toBe('vs previous');
    expect(translate('ko', 'step.files', { n: 2 })).toBe('파일 2개');
    expect(translate('en', 'step.files', { n: 2 })).toBe('2 file(s)');
  });
});
