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
const BY_LOWER = new Map(Object.keys(LABELS).map((k) => [k.toLowerCase(), k]));
// Tolerates "## Done", "1. Done:", "**Done:**", "**Done**:", indentation, wrong case, a full-width colon.
// Without a colon it counts only as a heading or bold line that holds nothing else.
const PART_LABEL = new RegExp(
  `^\\s*(#+\\s*)?(?:\\d+[.)]\\s*)?(\\*\\*|__)?(${Object.keys(LABELS).join('|')})(?:\\*\\*|__)?[ \\t]*([:：])?(?:\\*\\*|__)?[ \\t]*(.*)$`,
  'i',
);

function matchLabel(raw: string): { label: string; rest: string } | null {
  const m = PART_LABEL.exec(raw);
  if (!m) return null;
  const label = BY_LOWER.get(m[3]!.toLowerCase());
  if (!label) return null;
  const rest = m[5]!.trim();
  if (!m[4] && (rest || !(m[1] || m[2]))) return null;
  return { label, rest };
}

export interface Line { bullet: boolean; text: string }
export interface Part { key: PartKey; label: string; lines: Line[] }
export interface Parsed { pre: string; parts: Part[] }

/** null when the text does not follow the format (fewer than two labels): show it as-is. */
export function parseExplanation(text: string): Parsed | null {
  const parts: Part[] = [];
  const pre: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = matchLabel(raw);
    if (m) {
      parts.push({ key: LABELS[m.label]!, label: m.label, lines: [] });
      if (m.rest) parts[parts.length - 1]!.lines.push(toLine(m.rest));
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

// Gap is shown calm only when it is one short sentence that says nothing is missing, has no "but" clause
// and reports no unrequested change (the prompt asks Gap to list those too).
const NOTHING_MISSING = /\bnothing (?:is )?missing\b|\beverything (?:requested |asked for )?(?:is )?(?:covered|there|done|included|in place)\b|\ball there\b|\bno gaps?\b|모두 (?:반영|들어|포함)|빠진 (?:것|부분|기능)(?:이|은|도) 없|차이(?:가|는) 없/i;
const BUT = /\bbut\b|\bhowever\b|\bexcept\b|\balthough\b|지만|다만|그러나|단,/i;
const UNREQUESTED_EN = /unrequested|not (?:requested|asked)|outside (?:of )?(?:the|your) request|beyond the request|out of scope/gi;
const UNREQUESTED_KO = /요청하지 (?:않은|않았)|요청 밖|요청에 없는|요청 범위 밖/g;
const NEGATION_BEFORE = /\b(?:no|nothing|none|without|zero)\b[^.;,:]{0,30}$/i;
const NEGATION_AFTER = /^[^.;,:]{0,20}없/;
function hasUnrequested(all: string): boolean {
  for (const m of all.matchAll(UNREQUESTED_EN)) {
    if (!NEGATION_BEFORE.test(all.slice(Math.max(0, m.index - 40), m.index))) return true;
  }
  for (const m of all.matchAll(UNREQUESTED_KO)) {
    if (!NEGATION_AFTER.test(all.slice(m.index + m[0].length))) return true;
  }
  return false;
}
const CALM_MAX = 160;
export function gapIsCalm(part: Part): boolean {
  if (part.lines.length !== 1) return false;
  const all = part.lines[0]!.text;
  if (all.length > CALM_MAX || /[.!?。]\s+\S/.test(all)) return false;
  return NOTHING_MISSING.test(all) && !BUT.test(all) && !hasUnrequested(all);
}

/** The changed file a "Check yourself" line starts with (longest match), followed by a space, punctuation or the end. */
export function leadingPath(text: string, paths: string[]): string | null {
  let best: string | null = null;
  const s = text.startsWith('`') ? text.slice(1) : text; // a path wrapped in backticks
  for (const p of paths) {
    if (!p || !s.startsWith(p)) continue;
    const next = s.charAt(p.length);
    if (next !== '' && !/[\s,:;()'"`]/.test(next) && !(next === '.' && /^\s*$/.test(s.charAt(p.length + 1)))) continue;
    if (!best || p.length > best.length) best = p;
  }
  return best;
}
