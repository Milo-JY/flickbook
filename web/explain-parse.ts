// Splits a model explanation into its labeled parts. Pure (no DOM) so it can be unit tested.
// The result is plain strings: the UI must show them with textContent only.

export type PartKey = 'requested' | 'done' | 'gap' | 'check' | 'concepts';

// en and ko labels, as the prompt asks for them (src/explain/prompt.ts)
const LABELS: Record<string, PartKey> = {
  'Requested': 'requested',
  'Done': 'done',
  'Gap': 'gap',
  'Check yourself': 'check',
  'Concepts': 'concepts',
  '요청한 것': 'requested',
  '실제로 한 것': 'done',
  '차이': 'gap',
  '직접 확인할 곳': 'check',
  '쓰인 개념': 'concepts',
};
const PART_LABEL = new RegExp(`^(?:- )?(${Object.keys(LABELS).join('|')}):[ \\t]*(.*)$`);

export interface Line { bullet: boolean; text: string }
export interface Part { key: PartKey; label: string; lines: Line[] }
export interface Parsed { pre: string; parts: Part[] }

/** null when the text does not follow the format (fewer than two labels): show it as-is. */
export function parseExplanation(text: string): Parsed | null {
  const parts: Part[] = [];
  const pre: string[] = [];
  for (const raw of text.split('\n')) {
    const m = PART_LABEL.exec(raw);
    if (m) {
      parts.push({ key: LABELS[m[1]!]!, label: m[1]!, lines: [] });
      if (m[2]!.trim()) parts[parts.length - 1]!.lines.push(toLine(m[2]!));
    } else if (parts.length) {
      if (raw.trim()) parts[parts.length - 1]!.lines.push(toLine(raw));
    } else pre.push(raw);
  }
  if (parts.length < 2) return null;
  return { pre: pre.join('\n').trim(), parts };
}

function toLine(raw: string): Line {
  const s = raw.trim();
  return s.startsWith('- ') ? { bullet: true, text: s.slice(2).trim() } : { bullet: false, text: s };
}

/** "name — meaning" (also " – ", " - ", ": "). No separator: the whole text is the name. */
export function splitConcept(text: string): { name: string; meaning: string } {
  const m = /^(.+?)\s+[—–-]\s+(.+)$/.exec(text) ?? /^([^:]+?):\s+(.+)$/.exec(text);
  return m ? { name: m[1]!.trim(), meaning: m[2]!.trim() } : { name: text.trim(), meaning: '' };
}

// Gap is shown calm only when it says nothing is missing and has no "but" clause.
const NOTHING_MISSING = /\bnothing (?:is )?missing\b|\beverything (?:requested |asked for )?(?:is )?(?:covered|there|done|included|in place)\b|\ball there\b|\bno gaps?\b|모두 (?:반영|들어|포함)|빠진 (?:것|부분|기능)(?:이|은|도) 없|차이(?:가|는) 없/i;
const BUT = /\bbut\b|\bhowever\b|\bexcept\b|\balthough\b|지만|다만|그러나|단,/i;
export function gapIsCalm(part: Part): boolean {
  const all = part.lines.map((l) => l.text).join(' ');
  return NOTHING_MISSING.test(all) && !BUT.test(all);
}

/** The changed file a "Check yourself" line starts with (longest match), followed by a space, punctuation or the end. */
export function leadingPath(text: string, paths: string[]): string | null {
  let best: string | null = null;
  for (const p of paths) {
    if (!p || !text.startsWith(p)) continue;
    const next = text.charAt(p.length);
    if (next !== '' && !/[\s,:;.()'"`]/.test(next)) continue;
    if (!best || p.length > best.length) best = p;
  }
  return best;
}
