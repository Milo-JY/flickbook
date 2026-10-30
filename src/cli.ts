#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { Command } from 'commander';
import { LIMITS } from './config.js';
import { RrError } from './errors.js';
import { coverageNotice, explainStep, NoChangeError } from './explain/index.js';
import { PROVIDER_HELP, resolveProviderName } from './explain/providers.js';
import { CLAUDE_HOOK_SNIPPET, runHook } from './hook.js';
import { truncateBytes } from './meta.js';
import { openRepo, type Repo } from './repo.js';
import { startServer } from './server.js';
import {
  endSession,
  latestSessionId,
  listSessions,
  parseStepNumber,
  readSteps,
  removeSession,
  startSession,
  stepSession,
  validateSessionId,
} from './session.js';
import { NAME, VERSION } from './name.js';

const out = (s: string): void => {
  process.stdout.write(s + '\n');
};

const repoHere = (): Promise<Repo> => openRepo(process.cwd());

async function resolveSession(repo: Repo, id?: string): Promise<string> {
  if (id) {
    await validateSessionId(repo, id);
    return id;
  }
  const latest = await latestSessionId(repo);
  if (!latest) throw new RrError(`no sessions in this repository. Run "${NAME} start" first.`);
  return latest;
}

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const c = spawn(cmd, args, { stdio: 'ignore', detached: true });
  c.on('error', () => out(`Could not open a browser automatically. Open ${url} yourself.`));
  c.unref();
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of process.stdin) {
    size += (c as Buffer).length;
    if (size > 5 * 1024 * 1024) break;
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const pad = (n: number) => String(n).padStart(4, '0');

const program = new Command();
program
  .name(NAME)
  .description('Replay what an AI agent (or you) changed, step by step. Nothing leaves your machine unless you turn on explanations.')
  .version(VERSION);

program
  .command('start')
  .description('mark the baseline snapshot and begin a session')
  .option('--name <slug>', 'short name appended to the session id')
  .option('-m, --note <text>', 'note for the baseline')
  .action(async (o: { name?: string; note?: string }) => {
    const { id } = await startSession(await repoHere(), { name: o.name, note: o.note });
    out(`Started session ${id} (baseline = step 0).`);
  });

program
  .command('step')
  .description('snapshot the working tree as the next step')
  .option('-m, --note <text>', 'note for this step')
  .option('--context-file <file>', 'file with the prompt/context that led to this step')
  .option('--source <source>', 'cli | claude-code', 'cli')
  .option('--if-active', 'do nothing (exit 0) when no session is active')
  .action(async (o: { note?: string; contextFile?: string; source: string; ifActive?: boolean }) => {
    if (o.source !== 'cli' && o.source !== 'claude-code') throw new RrError('--source must be cli or claude-code');
    let context = '';
    if (o.contextFile) context = truncateBytes(await readFile(o.contextFile, 'utf8'), LIMITS.contextBytes);
    const r = await stepSession(await repoHere(), {
      note: o.note,
      context,
      source: o.source,
      ifActive: o.ifActive,
    });
    if (r.status === 'created') out(`Step ${pad(r.n)} saved.`);
    else if (r.status === 'unchanged') out(`No changes since step ${pad(r.n)}; nothing saved.`);
    else if (!o.ifActive) out('No active session.');
  });

program
  .command('end')
  .description('write the final snapshot and close the session')
  .option('-m, --note <text>', 'note for the end snapshot')
  .action(async (o: { note?: string }) => {
    const r = await endSession(await repoHere(), { note: o.note });
    if (r.status === 'inactive') out('No active session; nothing to do.');
    else out(`Session ${r.id} ended at step ${pad(r.n)}.`);
  });

program
  .command('list')
  .description('list sessions in this repository')
  .action(async () => {
    const all = await listSessions(await repoHere());
    if (!all.length) return out(`No sessions yet. Run "${NAME} start".`);
    for (const s of all) {
      out(`${s.active ? '*' : ' '} ${s.id}  ${String(s.steps).padStart(3)} snapshots  ${s.start}${s.note ? '  ' + s.note : ''}`);
    }
  });

program
  .command('replay')
  .alias('serve')
  .argument('[id]', 'session id (default: most recent)')
  .description('open the local web UI (127.0.0.1 only)')
  .option('--port <n>', 'fixed port (default: any free port)')
  .option('--no-open', 'do not open a browser')
  .action(async (id: string | undefined, o: { port?: string; open: boolean }) => {
    const repo = await repoHere();
    if (id) await validateSessionId(repo, id);
    const port = o.port === undefined ? undefined : Number(o.port);
    if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) throw new RrError('invalid --port');
    const webRoot = resolve(join(dirname(fileURLToPath(import.meta.url)), 'web'));
    const run = await startServer({ repo, webRoot, port });
    // the token rides in the fragment (never sent to the server or in a Referer); the UI moves it out of the URL
    const url = `${run.url}/#t=${run.token}${id ? `/${id}` : ''}`;
    out(`${NAME} is serving ${url}`);
    out('Press Ctrl+C to stop.');
    if (o.open) openBrowser(url);
    await new Promise<void>((res) => {
      process.once('SIGINT', () => res());
      process.once('SIGTERM', () => res());
    });
    await run.close();
  });

program
  .command('explain')
  .argument('[id]', 'session id (default: most recent)')
  .description('generate (and cache) an explanation with your configured provider')
  .option('--step <n>', 'step number (default: latest step)')
  .option('--all', 'every step (calls the provider once per uncached step)')
  .option('--provider <name>', `claude (overrides git config ${NAME}.provider)`)
  .option('--force', 'ignore the cache')
  .action(async (id: string | undefined, o: { step?: string; all?: boolean; provider?: string; force?: boolean }) => {
    const repo = await repoHere();
    const name = await resolveProviderName(repo, o.provider);
    if (name === 'none') throw new RrError(PROVIDER_HELP);
    const sid = await resolveSession(repo, id);
    const steps = await readSteps(repo, sid);
    const last = steps[steps.length - 1];
    if (!last) throw new RrError('session has no snapshots');
    const targets = o.all
      ? steps.filter((s) => s.n > 0).map((s) => s.n)
      : [o.step === undefined ? last.n : parseStepNumber(o.step)];
    if (!targets.length) return out('Nothing to explain yet (only the baseline exists).');
    for (const n of targets) {
      try {
        const r = await explainStep(repo, sid, n, { provider: o.provider, force: o.force });
        out(`--- step ${pad(n)}${r.cached ? ' (cached)' : ''} ---`);
        const notice = coverageNotice(r);
        if (notice) out(notice);
        out(r.text.trimEnd());
      } catch (e) {
        if (!(e instanceof NoChangeError && o.all)) throw e;
        out(`--- step ${pad(n)} --- (no file changes, skipped)`);
      }
    }
  });

program
  .command('hook')
  .argument('<which>', 'claude | claude-prompt | claude-stop')
  .description('Claude Code hook adapter ("claude" prints the settings snippet)')
  .action(async (which: string) => {
    if (which === 'claude') {
      out(`Add this to ~/.claude/settings.json (or .claude/settings.json). ${NAME} must be on PATH.`);
      out('Hooks do nothing in repositories without an active session.\n');
      return out(CLAUDE_HOOK_SNIPPET);
    }
    if (which !== 'claude-prompt' && which !== 'claude-stop') throw new RrError(`unknown hook "${which.slice(0, 30)}"`);
    // never break the agent: swallow everything, exit 0
    try {
      await runHook(which, await readStdin());
    } catch (e) {
      process.stderr.write(`${NAME} hook: ${(e as Error).message}\n`);
    }
  });

program
  .command('rm')
  .argument('<id>', 'session id')
  .description("delete a session's snapshots (the hidden refs)")
  .option('-y, --yes', 'do not ask')
  .option('--purge-explanations', 'also delete ALL cached explanations in this repository')
  .action(async (id: string, o: { yes?: boolean; purgeExplanations?: boolean }) => {
    const repo = await repoHere();
    await validateSessionId(repo, id);
    const steps = await readSteps(repo, id);
    if (!steps.length) throw new RrError(`no such session: ${id}`);
    if (!o.yes) {
      if (!process.stdin.isTTY) throw new RrError('refusing to delete without confirmation; pass --yes');
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const a = await rl.question(`Delete session ${id} (${steps.length} snapshots)? [y/N] `);
      rl.close();
      if (!/^y(es)?$/i.test(a.trim())) return out('Cancelled.');
    }
    const n = await removeSession(repo, id);
    if (o.purgeExplanations) await rm(join(repo.rr, 'explain'), { recursive: true, force: true });
    out(`Removed ${n} snapshots of ${id}. (Objects are reclaimed by git gc.)`);
  });

program.parseAsync(process.argv).catch((e: unknown) => {
  if (e instanceof RrError) process.stderr.write(`${NAME}: ${e.message}\n`);
  else process.stderr.write(`${NAME}: unexpected error: ${(e as Error).message}\n`);
  process.exitCode = 1;
});
