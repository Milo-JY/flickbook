import { basename } from 'node:path';
import { git, parseBatch } from './git.js';
import type { Repo } from './repo.js';

// Size and nesting numbers for a session. Everything here is derived from git objects (numstat + blob
// text); nothing is executed and nothing is written. The numbers describe change volume and indentation,
// they are not a quality score.

export const MAX_BLOB_BYTES = 1024 * 1024;
/** Total blob bytes read for one computation; files past it are listed as unmeasured ('budget'). */
export const READ_BUDGET_BYTES = 64 * 1024 * 1024;
const TAB_COLUMNS = 4;

export const LOCKFILES: ReadonlySet<string> = new Set([
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'Cargo.lock', 'poetry.lock', 'Gemfile.lock', 'composer.lock', 'go.sum',
]);

const DIFF_TREE = ['diff-tree', '-r', '-M', '--no-color', '--no-ext-diff', '--no-textconv'];

export interface NumstatEntry {
  path: string;
  oldPath?: string;
  added: number;
  removed: number;
  binary: boolean;
}

/**
 * Parse `git diff-tree -r -M --numstat -z` output. A normal record is `<added>\t<removed>\t<path>\0`;
 * a binary file has `-` for both counts; a rename is `<added>\t<removed>\t\0<old>\0<new>\0`
 * (the path field of the first record is empty and the two names follow as separate NUL fields).
 */
export function parseNumstat(out: string): NumstatEntry[] {
  const parts = out.split('\0');
  const res: NumstatEntry[] = [];
  let i = 0;
  while (i < parts.length) {
    const rec = parts[i++]!;
    if (!rec) break;
    const t1 = rec.indexOf('\t');
    const t2 = t1 < 0 ? -1 : rec.indexOf('\t', t1 + 1);
    if (t2 < 0) break;
    const a = rec.slice(0, t1);
    const r = rec.slice(t1 + 1, t2);
    const rest = rec.slice(t2 + 1);
    const binary = a === '-' && r === '-';
    const added = binary ? 0 : Number.parseInt(a, 10) || 0;
    const removed = binary ? 0 : Number.parseInt(r, 10) || 0;
    if (rest === '') {
      const oldPath = parts[i++] ?? '';
      const path = parts[i++] ?? '';
      res.push({ path, oldPath, added, removed, binary });
    } else {
      res.push({ path: rest, added, removed, binary });
    }
  }
  return res;
}

/** Indentation over the non-blank lines of `text`: leading whitespace in columns (tab = 4), summed and maximised. */
export function indentMetrics(text: string): { sum: number; max: number } {
  let sum = 0;
  let max = 0;
  for (const line of text.split('\n')) {
    let col = 0;
    let k = 0;
    for (; k < line.length; k++) {
      const c = line[k];
      if (c === ' ') col += 1;
      else if (c === '\t') col += TAB_COLUMNS;
      else break;
    }
    // blank = only whitespace (including a lone "\r" from CRLF files)
    if (line.slice(k).trim() === '') continue;
    sum += col;
    if (col > max) max = col;
  }
  return { sum, max };
}

export interface StepFile {
  path: string;
  oldPath?: string;
  added: number;
  removed: number;
  binary: boolean;
}

export interface StepMetrics {
  /** Lines added / removed in the diff from step 0 to this step (measured files only). */
  added: number;
  removed: number;
  /** Measured files that differ from step 0. */
  filesTouched: number;
  /** Indentation columns summed / maximised over non-blank lines of the files the session touched. */
  indentSum: number;
  indentMax: number;
}

export interface StepStats {
  n: number;
  /** Files changed since the previous step (empty for step 0). */
  files: StepFile[];
  metrics: StepMetrics;
}

export type UnmeasuredReason = 'binary' | 'lockfile' | 'too-large' | 'unreadable' | 'budget';
export interface Unmeasured {
  path: string;
  reason: UnmeasuredReason;
}

export interface SessionStats {
  steps: StepStats[];
  unmeasured: Unmeasured[];
}

interface StepRef {
  n: number;
  commit: string;
}

const numstat = async (repo: Repo, a: string, b: string): Promise<NumstatEntry[]> =>
  parseNumstat((await git([...DIFF_TREE, '--numstat', '-z', '--end-of-options', a, b], { cwd: repo.top })).stdout);

export async function computeStats(repo: Repo, input: StepRef[], budget: number = READ_BUDGET_BYTES): Promise<SessionStats> {
  const steps = [...input].sort((x, y) => x.n - y.n);
  const base = steps.find((s) => s.n === 0) ?? steps[0];
  if (!base) return { steps: [], unmeasured: [] };

  // 1. what changed: since the previous step (piano roll) and since step 0 (metrics)
  const perStep = new Map<number, NumstatEntry[]>();
  const sinceBase = new Map<number, NumstatEntry[]>();
  for (const s of steps) {
    if (s === base) continue;
    const prev = steps.find((x) => x.n === s.n - 1);
    perStep.set(s.n, prev ? await numstat(repo, prev.commit, s.commit) : []);
    sinceBase.set(s.n, await numstat(repo, base.commit, s.commit));
  }

  // 2. which files can be measured
  const touched = new Set<string>();
  const binary = new Set<string>();
  for (const list of [...perStep.values(), ...sinceBase.values()]) {
    for (const e of list) {
      touched.add(e.path);
      if (e.oldPath) touched.add(e.oldPath);
      if (e.binary) {
        binary.add(e.path);
        if (e.oldPath) binary.add(e.oldPath);
      }
    }
  }
  const unmeasured = new Map<string, UnmeasuredReason>();
  for (const p of touched) {
    if (LOCKFILES.has(basename(p))) unmeasured.set(p, 'lockfile');
    else if (binary.has(p)) unmeasured.set(p, 'binary');
    // a newline cannot be sent to cat-file on stdin; U+FFFD means the name was not valid UTF-8 and was decoded lossily,
    // so it could name a different path than the one in git
    else if (/[\n\r\uFFFD]/.test(p)) unmeasured.set(p, 'unreadable');
  }
  const candidates = [...touched].filter((p) => !unmeasured.has(p)).sort();

  // 3. sizes first (one --batch-check call), so a huge blob is never read; then the text of the rest (one --batch call)
  const requests: string[] = [];
  for (const s of steps) for (const p of candidates) requests.push(`${s.commit}:${p}`);
  const infos: { oid: string; size: number }[] = [];
  // infos is laid out step by step: all candidate paths of step 0, then of step 1, ...
  const infoAt = (si: number, ci: number) => infos[si * candidates.length + ci];
  if (requests.length) {
    const r = await git(['cat-file', '--batch-check'], { cwd: repo.top, input: requests.join('\n') + '\n' });
    const lines = r.stdout.split('\n');
    for (let i = 0; i < requests.length; i++) {
      const line = lines[i] ?? '';
      const [oid, type, size] = line.split(' ');
      infos.push(!line.endsWith(' missing') && type === 'blob' && oid ? { oid, size: Number(size) } : { oid: '', size: 0 });
    }
    candidates.forEach((p, ci) => {
      for (let si = 0; si < steps.length; si++) {
        if (infoAt(si, ci)!.size > MAX_BLOB_BYTES) unmeasured.set(p, 'too-large');
      }
    });
  }
  // read budget: count each distinct blob once, in path order; a file that would cross the line is left out whole
  let spent = 0;
  const counted = new Set<string>();
  candidates.forEach((p, ci) => {
    if (unmeasured.has(p)) return;
    const fresh = new Map<string, number>();
    for (let si = 0; si < steps.length; si++) {
      const x = infoAt(si, ci)!;
      if (x.oid && !counted.has(x.oid)) fresh.set(x.oid, x.size);
    }
    const cost = [...fresh.values()].reduce((a, b) => a + b, 0);
    if (spent + cost > budget) { unmeasured.set(p, 'budget'); return; }
    spent += cost;
    for (const o of fresh.keys()) counted.add(o);
  });
  const blobs = new Map<string, { sum: number; max: number; nul: boolean }>();
  const wanted = [...counted].sort();
  if (wanted.length) {
    const r = await git(['cat-file', '--batch'], { cwd: repo.top, input: wanted.join('\n') + '\n' });
    for (const e of parseBatch(r.stdoutBuf)) {
      if (e.type !== 'blob') continue;
      const nul = e.body.includes(0);
      blobs.set(e.id, nul ? { sum: 0, max: 0, nul } : { ...indentMetrics(e.body.toString('utf8')), nul });
    }
  }
  candidates.forEach((p, ci) => {
    for (let si = 0; si < steps.length; si++) {
      const oid = infoAt(si, ci)?.oid;
      if (oid && blobs.get(oid)?.nul && !unmeasured.has(p)) unmeasured.set(p, 'binary');
    }
  });
  const measured = (e: NumstatEntry): boolean => !unmeasured.has(e.path) && !(e.oldPath && unmeasured.has(e.oldPath));

  // 4. per-step numbers
  const out: StepStats[] = steps.map((s, si) => {
    let indentSum = 0;
    let indentMax = 0;
    candidates.forEach((p, ci) => {
      if (unmeasured.has(p)) return;
      const oid = infoAt(si, ci)?.oid;
      const b = oid ? blobs.get(oid) : undefined; // missing path counts as 0
      if (!b) return;
      indentSum += b.sum;
      if (b.max > indentMax) indentMax = b.max;
    });
    const files: StepFile[] = (perStep.get(s.n) ?? []).map((e) => ({
      path: e.path,
      ...(e.oldPath !== undefined ? { oldPath: e.oldPath } : {}),
      added: e.added,
      removed: e.removed,
      binary: e.binary,
    }));
    const since = sinceBase.get(s.n);
    let added = 0;
    let removed = 0;
    let filesTouched = 0;
    since?.forEach((e) => {
      if (!measured(e)) return;
      added += e.added;
      removed += e.removed;
      filesTouched += 1;
    });
    return { n: s.n, files, metrics: { added, removed, filesTouched, indentSum, indentMax } };
  });

  return {
    steps: out,
    unmeasured: [...unmeasured]
      .map(([path, reason]) => ({ path, reason }))
      .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0)),
  };
}
