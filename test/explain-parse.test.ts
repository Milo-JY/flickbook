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

  it('shows Gap calm only when it says nothing is missing without a "but"', () => {
    const gap = (s: string) => gapIsCalm({ key: 'gap', label: 'Gap', lines: [{ bullet: false, text: s }] });
    expect(gap('everything requested is covered and nothing unrequested changed.')).toBe(true);
    expect(gap('the feature is all there, but there is no range validation.')).toBe(false);
    expect(gap('the tests for 0% are missing.')).toBe(false);
    expect(gap('요청한 내용은 모두 반영됐고, 요청하지 않은 변경은 없습니다.')).toBe(true);
    expect(gap('요청한 테스트는 들어갔지만, 경계값은 테스트하지 않습니다.')).toBe(false);
    expect(gap('요청한 기능은 모두 들어갔습니다. 다만 범위 검사는 없습니다.')).toBe(false);
  });

  it('finds the changed file a Check yourself line starts with (longest, whole path only)', () => {
    const files = ['cart.js', 'cart.test.js', 'src/a.ts'];
    expect(leadingPath('cart.js, total(): check', files)).toBe('cart.js');
    expect(leadingPath('cart.test.js, the asserts', files)).toBe('cart.test.js');
    expect(leadingPath('cart.js 의 total()', files)).toBe('cart.js');
    expect(leadingPath('cart.jsx is not changed', files)).toBeNull();
    expect(leadingPath('total() in cart.js', files)).toBeNull();
    expect(leadingPath('src/a.ts', files)).toBe('src/a.ts');
  });
});
