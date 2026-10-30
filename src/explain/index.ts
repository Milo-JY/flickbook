import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULTS, TEMPLATE_VERSION } from '../config.js';
import { diffFiles } from '../diff.js';
import { RrError } from '../errors.js';
import { stripControl } from '../meta.js';
import { gitConfig, type Repo } from '../repo.js';
import { readSteps } from '../session.js';
import { buildPrompt, limitDiff } from './prompt.js';
import { makeProvider, resolveProviderName, type ProviderName } from './providers.js';
import { NAME } from '../name.js';

/** The step changed no files, so there is nothing to explain (and no reason to call a provider). */
export class NoChangeError extends RrError {}

export interface ExplainOptions {
  provider?: string;
  force?: boolean;
}

export async function resolveLang(repo: Repo): Promise<string> {
  const l = ((await gitConfig(repo, `${NAME}.lang`)) ?? DEFAULTS.explanationLang).trim().toLowerCase();
  return l === 'ko' || l.startsWith('ko-') ? 'ko' : 'en';
}

interface Prepared {
  provider: ProviderName;
  lang: string;
  key: string;
  prompt: string;
  files: string[];
  diff: string;
  note: string;
  context: string;
  truncated: boolean;
  omitted: string[];
}

/** What part of the diff the explanation saw: cut short (truncated) and files left out entirely (omitted). */
export interface Coverage {
  truncated: boolean;
  omitted: string[];
}

const FULL: Coverage = { truncated: false, omitted: [] };

/** Fixed, non-model text for an explanation that did not see the whole diff (CLI; the web UI has its own en/ko text). */
export function coverageNotice(c: Coverage): string | null {
  if (c.omitted.length) return `Note: ${c.omitted.length} file(s) were not included in this explanation (diff over the size limit). Read them in the diff yourself.`;
  if (c.truncated) return 'Note: this explanation saw only part of the diff (diff over the size limit). Read the rest yourself.';
  return null;
}

async function prepare(repo: Repo, sessionId: string, n: number, providerOverride?: string): Promise<Prepared> {
  const steps = await readSteps(repo, sessionId);
  const step = steps.find((s) => s.n === n);
  if (!step) throw new RrError(`no step ${n} in session ${sessionId}`);
  const prev = steps.find((s) => s.n === n - 1);
  if (!prev) throw new RrError('step 0 is the baseline; there is no change to explain');
  const provider = await resolveProviderName(repo, providerOverride);
  const lang = await resolveLang(repo);
  const files = await diffFiles(repo, prev.commit, step.commit);
  if (files.length === 0) throw new NoChangeError('this step changed no files; nothing to explain');
  const lim = limitDiff(files);
  const names = files.map((f) => `${f.status} ${f.path}`);
  const context = step.meta.context;
  const prompt = buildPrompt({
    diff: lim.diff,
    files: names,
    note: step.meta.note,
    context,
    lang,
    truncated: lim.truncated,
    omitted: lim.omitted,
  });
  const model = (await gitConfig(repo, `${NAME}.model`)) ?? '';
  const inputs = createHash('sha256').update([context, step.meta.note].join('\0')).digest('hex');
  const key = createHash('sha256')
    .update([provider, model, TEMPLATE_VERSION, lang, inputs, lim.diff].join('\0'))
    .digest('hex');
  return {
    provider,
    lang,
    key,
    prompt,
    files: names,
    diff: lim.diff,
    note: step.meta.note,
    context,
    truncated: lim.truncated,
    omitted: lim.omitted,
  };
}

const cachePath = (repo: Repo, key: string) => join(repo.rr, 'explain', `${key}.txt`);

export type ExplanationState = Coverage &
  ({ provider: ProviderName; configured: false; text: null } | { provider: ProviderName; configured: true; text: string | null });

/** Cached explanation if any. Never spawns anything. */
export async function readExplanation(
  repo: Repo,
  sessionId: string,
  n: number,
  providerOverride?: string,
): Promise<ExplanationState> {
  const provider = await resolveProviderName(repo, providerOverride);
  if (provider === 'none') return { provider, configured: false, text: null, ...FULL };
  if (n === 0) return { provider, configured: true, text: null, ...FULL };
  try {
    const p = await prepare(repo, sessionId, n, providerOverride);
    const text = await readFile(cachePath(repo, p.key), 'utf8');
    return { provider, configured: true, text, truncated: p.truncated, omitted: p.omitted };
  } catch (e) {
    if (e instanceof NoChangeError || (e as NodeJS.ErrnoException).code === 'ENOENT') {
      return { provider, configured: true, text: null, ...FULL };
    }
    throw e;
  }
}

const inflight = new Map<string, Promise<{ text: string; cached: boolean }>>();

/** Explanation for a step: cache hit, or exactly one provider call. No retries. */
export async function explainStep(
  repo: Repo,
  sessionId: string,
  n: number,
  opts: ExplainOptions = {},
): Promise<{ text: string; cached: boolean; provider: ProviderName } & Coverage> {
  const p = await prepare(repo, sessionId, n, opts.provider);
  const provider = await makeProvider(repo, p.provider); // throws help text for 'none' before any spawn
  const file = cachePath(repo, p.key);
  const coverage: Coverage = { truncated: p.truncated, omitted: p.omitted };
  if (!opts.force) {
    try {
      return { text: await readFile(file, 'utf8'), cached: true, provider: p.provider, ...coverage };
    } catch {
      /* miss */
    }
  }
  const flightKey = repo.gitDir + ':' + p.key;
  let flight = inflight.get(flightKey);
  if (!flight) {
    flight = (async () => {
      const raw = await provider.explain({
        diff: p.diff,
        files: p.files,
        note: p.note,
        context: p.context,
        lang: p.lang,
        prompt: p.prompt,
      });
      const text = stripControl(raw).trim();
      if (!text) throw new RrError('the provider returned an empty explanation');
      await mkdir(join(repo.rr, 'explain'), { recursive: true });
      const tmp = `${file}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`;
      try {
        await writeFile(tmp, text + '\n');
        await rename(tmp, file);
      } finally {
        await rm(tmp, { force: true });
      }
      return { text: text + '\n', cached: false };
    })().finally(() => inflight.delete(flightKey));
    inflight.set(flightKey, flight);
  }
  return { ...(await flight), provider: p.provider, ...coverage };
}
