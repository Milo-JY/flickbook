import { FORMAT_VERSION, LIMITS } from './config.js';
import { NAME } from './name.js';

export type Kind = 'baseline' | 'step' | 'end';

export interface StepMeta {
  format: number;
  session: string;
  kind: Kind;
  time: string;
  source: string;
  head: string;
  note: string;
  /** Prompt context (the "why"). */
  context: string;
  /** What the agent said at the end of the turn. */
  agentSummary: string;
}

const SECTION = /^--- ([a-z-]+) ---$/;

export function truncateBytes(s: string, max: number): string {
  const buf = Buffer.from(s, 'utf8');
  if (buf.length <= max) return s;
  // cut on a character boundary
  let end = max;
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString('utf8');
}

export function localIso(d = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const oh = p(Math.floor(Math.abs(off) / 60));
  const om = p(Math.abs(off) % 60);
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${sign}${oh}:${om}`
  );
}

/** C0 control characters except \t and \n (NUL included): never let user/agent text carry them into git. */
const CONTROL = /[\x00-\x08\x0b-\x1f]/g;

export function stripControl(s: string): string {
  return s.replace(CONTROL, '');
}

function oneLine(s: string, max: number): string {
  return stripControl(s).replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Keep free text from forging a section marker. */
function escapeBody(s: string): string {
  return s
    .split('\n')
    .map((l) => (SECTION.test(l) ? ' ' + l : l))
    .join('\n');
}

export function formatMessage(n: number, m: Omit<StepMeta, 'format' | 'time'> & { time?: string }): string {
  const lines = [
    `${NAME} ${m.kind} ${String(n).padStart(4, '0')}`,
    '',
    `${NAME}-format: ${FORMAT_VERSION}`,
    `session: ${m.session}`,
    `kind: ${m.kind}`,
    `time: ${m.time ?? localIso()}`,
    `source: ${oneLine(m.source, 40)}`,
    `head: ${oneLine(m.head, 64)}`,
    `note: ${oneLine(m.note, LIMITS.noteChars)}`,
  ];
  const context = stripControl(m.context);
  const agentSummary = stripControl(m.agentSummary);
  if (context) lines.push('--- context ---', escapeBody(truncateBytes(context, LIMITS.contextBytes)));
  if (agentSummary)
    lines.push('--- agent-summary ---', escapeBody(truncateBytes(agentSummary, LIMITS.agentSummaryBytes)));
  return lines.join('\n') + '\n';
}

/** Tolerant parser: unknown keys and sections are ignored (forward compatible). */
export function parseMessage(msg: string): StepMeta {
  const out: StepMeta = {
    format: 0,
    session: '',
    kind: 'step',
    time: '',
    source: '',
    head: '',
    note: '',
    context: '',
    agentSummary: '',
  };
  const sections: Record<string, string[]> = {};
  let cur: string | null = null;
  let seenBlank = false;
  for (const line of msg.split('\n')) {
    const sec = SECTION.exec(line);
    if (sec) {
      cur = sec[1]!;
      sections[cur] = [];
      continue;
    }
    if (cur) {
      sections[cur]!.push(line);
      continue;
    }
    if (!seenBlank) {
      if (line === '') seenBlank = true;
      continue;
    }
    const i = line.indexOf(': ');
    const key = i >= 0 ? line.slice(0, i) : line.endsWith(':') ? line.slice(0, -1) : '';
    const val = i >= 0 ? line.slice(i + 2) : '';
    switch (key) {
      case `${NAME}-format`:
        out.format = Number.parseInt(val, 10) || 0;
        break;
      case 'session':
        out.session = val;
        break;
      case 'kind':
        if (val === 'baseline' || val === 'step' || val === 'end') out.kind = val;
        break;
      case 'time':
        out.time = val;
        break;
      case 'source':
        out.source = val;
        break;
      case 'head':
        out.head = val;
        break;
      case 'note':
        out.note = val;
        break;
      default:
        break; // unknown key
    }
  }
  out.context = (sections['context'] ?? []).join('\n').trim();
  out.agentSummary = (sections['agent-summary'] ?? []).join('\n').trim();
  return out;
}
