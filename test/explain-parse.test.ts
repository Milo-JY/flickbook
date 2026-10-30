import { describe, expect, it } from 'vitest';
import { gapIsCalm, leadingPath, parseExplanation, splitConcept } from '../web/explain-parse.js';

const EN = [
  'Requested: an optional discount.',
  'Done:',
  '- total() takes discountPercent.',
  '- The result is multiplied.',
  'Gap: everything requested is covered and nothing unrequested changed.',
  'Check yourself:',
  '- cart.js, total(): check 150.',
  'Concepts:',
  '- Backward compatibility — the default keeps old calls working.',
  '- Input validation — check a value before using it.',
].join('\n');

const KO = [
  '요청한 것: 할인을 추가해 달라는 요청입니다.',
  '실제로 한 것:',
  '- total() 이 인자를 받습니다.',
  '차이: 요청한 기능은 들어갔지만, 범위 검사는 없습니다.',
  '직접 확인할 곳:',
  '- cart.js 의 total(): 150 을 넣어 보세요.',
  '쓰인 개념:',
  '- 입력 검증(input validation) — 값을 쓰기 전에 확인하는 것입니다.',
].join('\n');

describe('explanation parsing', () => {
  it('splits the five English parts and turns "- " lines into bullets', () => {
    const p = parseExplanation(EN)!;
    expect(p.parts.map((x) => x.key)).toEqual(['requested', 'done', 'gap', 'check', 'concepts']);
    expect(p.parts[0]!.lines).toEqual([{ bullet: false, text: 'an optional discount.' }]);
    expect(p.parts[1]!.lines).toEqual([
      { bullet: true, text: 'total() takes discountPercent.' },
      { bullet: true, text: 'The result is multiplied.' },
    ]);
    expect(p.parts[4]!.lines.map((l) => splitConcept(l.text))).toEqual([
      { name: 'Backward compatibility', meaning: 'the default keeps old calls working.' },
      { name: 'Input validation', meaning: 'check a value before using it.' },
    ]);
  });

  it('splits the five Korean parts, including 쓰인 개념', () => {
    const p = parseExplanation(KO)!;
    expect(p.parts.map((x) => x.key)).toEqual(['requested', 'done', 'gap', 'check', 'concepts']);
    expect(p.parts[4]!.label).toBe('쓰인 개념');
    expect(splitConcept(p.parts[4]!.lines[0]!.text)).toEqual({ name: '입력 검증(input validation)', meaning: '값을 쓰기 전에 확인하는 것입니다.' });
  });

  it('still accepts the older four-part output (cached before Concepts existed)', () => {
    const p = parseExplanation(EN.split('\nConcepts:')[0]!)!;
    expect(p.parts.map((x) => x.key)).toEqual(['requested', 'done', 'gap', 'check']);
  });

  it('returns null for text that does not follow the labels, so the UI shows it as plain text', () => {
    expect(parseExplanation('This step adds a discount.\n- some bullet')).toBeNull();
    expect(parseExplanation('Gap: only one label here')).toBeNull();
  });

  it('keeps text before the first label and never interprets markup', () => {
    const p = parseExplanation('<img src=x onerror=alert(1)>\nRequested: <b>x</b>\nDone: y')!;
    expect(p.pre).toBe('<img src=x onerror=alert(1)>');
    expect(p.parts[0]!.lines[0]!.text).toBe('<b>x</b>');
  });

  it('a concept without a separator is all name', () => {
    expect(splitConcept('Idempotency')).toEqual({ name: 'Idempotency', meaning: '' });
    expect(splitConcept('Atomicity: all or nothing')).toEqual({ name: 'Atomicity', meaning: 'all or nothing' });
  });

  it('shows Gap calm only when its whole text is "None." or "없음."', () => {
    const gap = (s: string) => gapIsCalm({ key: 'gap', label: 'Gap', lines: [{ bullet: false, text: s }] });
    expect(gap('None.')).toBe(true);
    expect(gap('None')).toBe(true);
    expect(gap(' none. ')).toBe(true);
    expect(gap('없음.')).toBe(true);
    expect(gap('없음')).toBe(true);
    expect(gap('No gaps, removed the auth check')).toBe(false);
    expect(gap('Nothing missing — I also refactored')).toBe(false);
    expect(gap('Nothing is missing and no unrequested changes.')).toBe(false);
    expect(gap('빠진 것은 없습니다.')).toBe(false);
    expect(gap('없음. 다만 테스트를 삭제했습니다.')).toBe(false);
    expect(gap('the tests for 0% are missing.')).toBe(false);
  });

  it('Gap with more than one line is not calm', () => {
    expect(gapIsCalm({ key: 'gap', label: 'Gap', lines: [{ bullet: true, text: 'None.' }, { bullet: true, text: 'deleted a file' }] })).toBe(false);
    expect(gapIsCalm({ key: 'gap', label: 'Gap', lines: [] })).toBe(false);
  });

  it('Gap is never calm when the explanation saw only part of the diff', () => {
    const none = { key: 'gap' as const, label: 'Gap', lines: [{ bullet: false, text: 'None.' }] };
    expect(gapIsCalm(none)).toBe(true);
    expect(gapIsCalm(none, false)).toBe(true);
    expect(gapIsCalm(none, true)).toBe(false);
  });

  it('recognizes label variants: heading, numbering, bold, indent, case, full-width colon, CRLF', () => {
    const keys = (t: string) => parseExplanation(t)!.parts.map((x) => x.key);
    const all = ['requested', 'done', 'gap', 'check', 'concepts'];
    expect(keys('**Requested:** a\n**Done**: b\n## Gap\n1. Check yourself: c\n   Concepts： d')).toEqual(all);
    expect(keys('Requested: a\r\nDONE: b\r\ngap: c\r\ncheck Yourself: d\r\n__Concepts__: e')).toEqual(all);
    expect(keys('2) Requested: a\n# **Done**\n**차이：** x\n직접 확인할 곳： y')).toEqual(['requested', 'done', 'gap', 'check']);
    const p = parseExplanation('**Requested:** a\r\n**Done:** b\r\n  more\r\n')!;
    expect(p.parts[0]!.lines).toEqual([{ bullet: false, text: 'a' }]);
    expect(p.parts[1]!.lines).toEqual([{ bullet: false, text: 'b' }, { bullet: false, text: 'more' }]);
  });

  it('does not start a card from prose that merely begins with a label word', () => {
    const p = parseExplanation('Requested: a\nDone: b\n- Done: refactor\nDone with the rest\n## Done it\n**Gap** is wide')!;
    expect(p.parts.map((x) => x.key)).toEqual(['requested', 'done']);
    expect(p.parts[1]!.lines.map((l) => l.text)).toEqual(['b', 'Done: refactor', 'Done with the rest', '## Done it', '**Gap** is wide']);
  });

  it('finds the changed file a Check yourself line starts with (longest, whole path only)', () => {
    const files = ['cart.js', 'cart.test.js', 'src/a.ts'];
    expect(leadingPath('cart.js, total(): check', files)).toBe('cart.js');
    expect(leadingPath('cart.test.js, the asserts', files)).toBe('cart.test.js');
    expect(leadingPath('cart.js 의 total()', files)).toBe('cart.js');
    expect(leadingPath('cart.jsx is not changed', files)).toBeNull();
    expect(leadingPath('total() in cart.js', files)).toBeNull();
    expect(leadingPath('src/a.ts', files)).toBe('src/a.ts');
    expect(leadingPath('src/a.ts.bak x', files)).toBeNull();
    expect(leadingPath('src/a.ts. Then', files)).toBe('src/a.ts');
    expect(leadingPath('src/a.ts.', files)).toBe('src/a.ts');
    expect(leadingPath('`src/a.ts` total()', files)).toBe('src/a.ts');
    expect(leadingPath('`cart.js`, total()', files)).toBe('cart.js');
  });
});
