import { readFile, writeFile, rm, link, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { git } from './git.js';
import type { Repo } from './repo.js';
import { RrError } from './errors.js';
import { REF_PREFIX, ZERO_OID, LIMITS } from './config.js';
import { snapshotTree, commitTree, createRef } from './snapshot.js';
import { formatMessage, localIso, parseMessage, type Kind, type StepMeta } from './meta.js';
import { NAME } from './name.js';

export interface Step {
  n: number;
  ref: string;
  commit: string;
  tree: string;
  meta: StepMeta;
}

export interface SessionSummary {
  id: string;
  steps: number;
  start: string;
  last: string;
  active: boolean;
  note: string;
}

const ID_RE = /^[A-Za-z0-9-]+$/;

export async function validateSessionId(repo: Repo, id: string): Promise<string> {
  if (!ID_RE.test(id) || id.length > 80) throw new RrError(`invalid session id: ${JSON.stringify(id.slice(0, 80))}`);
  const r = await git(['check-ref-format', `${REF_PREFIX}/${id}/0000`], { cwd: repo.top, allowFail: true });
  if (r.code !== 0) throw new RrError(`invalid session id: ${id}`);
  return id;
}

export function parseStepNumber(raw: string): number {
  if (!/^\d{1,4}$/.test(raw)) throw new RrError(`invalid step number: ${JSON.stringify(raw.slice(0, 20))}`);
  return Number.parseInt(raw, 10);
}

const pointerPath = (repo: Repo) => join(repo.rr, 'current');

export async function activeId(repo: Repo): Promise<string | null> {
  try {
    const id = (await readFile(pointerPath(repo), 'utf8')).trim();
    return ID_RE.test(id) ? id : null;
  } catch {
    return null;
  }
}

async function removePointer(repo: Repo): Promise<void> {
  await rm(pointerPath(repo), { force: true });
}

const FMT = ['%(refname)', '%(objectname)', '%(tree)', '%(contents)'].join('%1f') + '%1e';

async function readRefs(repo: Repo, pattern: string): Promise<Step[]> {
  const r = await git(['for-each-ref', '--sort=refname', `--format=${FMT}`, pattern], { cwd: repo.top });
  const steps: Step[] = [];
  for (const rec of r.stdout.split('\x1e')) {
    const t = rec.replace(/^\n/, '');
    if (!t) continue;
    const [ref, commit, tree, contents] = t.split('\x1f');
    if (!ref || !commit || !tree) continue;
    const n = Number.parseInt(ref.slice(ref.lastIndexOf('/') + 1), 10);
    if (Number.isNaN(n)) continue;
    steps.push({ n, ref, commit, tree, meta: parseMessage(contents ?? '') });
  }
  return steps;
}

export async function readSteps(repo: Repo, id: string): Promise<Step[]> {
  const steps = await readRefs(repo, `${REF_PREFIX}/${id}/`);
  return steps.sort((a, b) => a.n - b.n);
}

export async function listSessions(repo: Repo): Promise<SessionSummary[]> {
  const all = await readRefs(repo, `${REF_PREFIX}/`);
  const byId = new Map<string, Step[]>();
  for (const s of all) {
    const id = s.ref.slice(REF_PREFIX.length + 1).split('/')[0]!;
    (byId.get(id) ?? byId.set(id, []).get(id)!).push(s);
  }
  const active = await activeId(repo);
  const out: SessionSummary[] = [];
  for (const [id, steps] of byId) {
    steps.sort((a, b) => a.n - b.n);
    const first = steps[0]!;
    const last = steps[steps.length - 1]!;
    out.push({
      id,
      steps: steps.length,
      start: first.meta.time,
      last: last.meta.time,
      active: id === active,
      note: first.meta.note,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Most recent session id (ids start with a timestamp, so lexical order is chronological). */
export async function latestSessionId(repo: Repo): Promise<string | null> {
  const all = await listSessions(repo);
  return all.length ? all[all.length - 1]!.id : null;
}

async function headSha(repo: Repo): Promise<string> {
  const r = await git(['rev-parse', '--verify', '-q', 'HEAD'], { cwd: repo.top, allowFail: true });
  return r.code === 0 ? r.stdout.trim() : '(none)';
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

export interface StartOptions {
  name?: string;
  note?: string;
}

export async function startSession(repo: Repo, opts: StartOptions = {}): Promise<{ id: string }> {
  const act = await activeId(repo);
  if (act) throw new RrError(`session ${act} is already active. Run "${NAME} end" first.`);
  const slug = opts.name ? slugify(opts.name) : '';
  const id = `${stamp()}${slug ? '-' + slug : ''}`;
  await validateSessionId(repo, id);
  const tree = await snapshotTree(repo);
  const msg = formatMessage(0, {
    session: id,
    kind: 'baseline',
    source: 'cli',
    head: await headSha(repo),
    note: opts.note ?? '',
    context: '',
    agentSummary: '',
  });
  const commit = await commitTree(repo, tree, null, msg);
  const ok = await createRef(repo, `${REF_PREFIX}/${id}/0000`, commit, ZERO_OID);
  if (!ok) throw new RrError(`session ${id} already exists (started twice within one second?)`);
  // pointer: write a temp file then hard-link it into place — fails atomically if another start won.
  await mkdir(repo.rr, { recursive: true });
  const tmp = join(repo.rr, `tmp-pointer-${process.pid}-${randomBytes(4).toString('hex')}`);
  await writeFile(tmp, id + '\n');
  try {
    await link(tmp, pointerPath(repo));
  } catch {
    throw new RrError(`another session was started at the same time; run "${NAME} list"`);
  } finally {
    await rm(tmp, { force: true });
  }
  return { id };
}

export interface StepOptions {
  note?: string;
  context?: string;
  agentSummary?: string;
  source?: string;
  ifActive?: boolean;
  /** Test seam: runs after the tree is built, before the ref is written. */
  beforeRef?: () => Promise<void>;
}

export type StepResult =
  | { status: 'created'; id: string; n: number }
  | { status: 'unchanged'; id: string; n: number }
  | { status: 'inactive' };

async function appendSnapshot(
  repo: Repo,
  id: string,
  kind: Kind,
  opts: StepOptions,
  skipIfSameTree: boolean,
): Promise<StepResult> {
  const tree = await snapshotTree(repo);
  const head = await headSha(repo);
  await opts.beforeRef?.();
  for (let attempt = 0; attempt < LIMITS.stepAttempts; attempt++) {
    const steps = await readSteps(repo, id);
    const last = steps[steps.length - 1];
    if (skipIfSameTree && last && last.tree === tree) return { status: 'unchanged', id, n: last.n };
    const n = last ? last.n + 1 : 0;
    if (n > 9999) throw new RrError('too many steps in one session (max 9999)');
    const msg = formatMessage(n, {
      session: id,
      kind,
      source: opts.source ?? 'cli',
      head,
      note: opts.note ?? '',
      context: opts.context ?? '',
      agentSummary: opts.agentSummary ?? '',
    });
    const commit = await commitTree(repo, tree, last?.commit ?? null, msg);
    if (await createRef(repo, `${REF_PREFIX}/${id}/${String(n).padStart(4, '0')}`, commit, ZERO_OID)) {
      return { status: 'created', id, n };
    }
    // lost the race for number n: re-list and try the next one
  }
  throw new RrError('could not allocate a step number (too much concurrent activity)');
}

export async function stepSession(repo: Repo, opts: StepOptions = {}): Promise<StepResult> {
  const id = await activeId(repo);
  if (!id) {
    if (opts.ifActive) return { status: 'inactive' };
    throw new RrError(`no active session. Run "${NAME} start" first.`);
  }
  return appendSnapshot(repo, id, 'step', opts, true);
}

export async function endSession(repo: Repo, opts: { note?: string } = {}): Promise<StepResult> {
  const id = await activeId(repo);
  if (!id) return { status: 'inactive' };
  // always writes an end snapshot, even when nothing changed: the end time must be recorded
  const res = await appendSnapshot(repo, id, 'end', { note: opts.note, source: 'cli' }, false);
  await removePointer(repo);
  return res;
}

export async function removeSession(repo: Repo, id: string): Promise<number> {
  const steps = await readSteps(repo, id);
  for (const s of steps) await git(['update-ref', '-d', s.ref], { cwd: repo.top });
  if ((await activeId(repo)) === id) await removePointer(repo);
  return steps.length;
}

export { localIso };
