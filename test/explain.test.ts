import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { explainStep, readExplanation } from '../src/explain/index.js';
import { openRepo } from '../src/repo.js';
import { startSession, stepSession } from '../src/session.js';
import { git, makeRepo, makeStub, runCli } from './helpers.js';
import { NAME } from '../src/name.js';

let oldPath: string | undefined;
beforeEach(() => { oldPath = process.env['PATH']; });
afterEach(() => { process.env['PATH'] = oldPath; });

async function session(dir: string, context = 'make a say two') {
  const repo = await openRepo(dir);
  const { id } = await startSession(repo);
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n');
  await stepSession(repo, { note: 'edit-a', context });
  return { repo, id };
}

describe('explain providers (unit 7)', () => {
  it('claude stub receives diff + context + safe flags; 2nd call is cached (1 spawn)', async () => {
    const dir = makeRepo();
    const stub = makeStub('claude');
    process.env['PATH'] = `${stub.binDir}:${oldPath}`;
    git(dir, 'config', `${NAME}.provider`, 'claude');
    const { repo, id } = await session(dir);
    const a = await explainStep(repo, id, 1);
    const b = await explainStep(repo, id, 1);
    expect(a.cached).toBe(false);
    expect(b.cached).toBe(true);
    expect(a.text).toContain('stub explanation');
    expect(readFileSync(stub.count, 'utf8').trim().split('\n')).toHaveLength(1);
    const argv = readFileSync(stub.log, 'utf8').split('\n');
    expect(argv).toEqual(expect.arrayContaining(['-p', '--no-session-persistence', '--tools', '--output-format', 'text']));
    expect(argv[argv.indexOf('--tools') + 1]).toBe('');
    const prompt = readFileSync(stub.stdin, 'utf8');
    expect(prompt).toContain('+two');
    expect(prompt).toContain('make a say two');
    expect(prompt).toContain('edit-a');
    expect(prompt).toContain('English');
  });

  it('--force re-spawns; lang ko changes the prompt and the cache key', async () => {
    const dir = makeRepo();
    const stub = makeStub('claude');
    process.env['PATH'] = `${stub.binDir}:${oldPath}`;
    git(dir, 'config', `${NAME}.provider`, 'claude');
    const { repo, id } = await session(dir);
    await explainStep(repo, id, 1);
    await explainStep(repo, id, 1, { force: true });
    git(dir, 'config', `${NAME}.lang`, 'ko');
    await explainStep(repo, id, 1);
    expect(readFileSync(stub.count, 'utf8').trim().split('\n')).toHaveLength(3);
    expect(readFileSync(stub.stdin, 'utf8')).toContain('Korean');
  });

  it('provider unset: nothing is spawned and the error explains how to enable', async () => {
    const dir = makeRepo();
    const stub = makeStub('claude');
    process.env['PATH'] = `${stub.binDir}:${oldPath}`;
    const { repo, id } = await session(dir);
    await expect(explainStep(repo, id, 1)).rejects.toThrow(/No explanation provider/);
    expect(existsSync(stub.count)).toBe(false);
    expect(await readExplanation(repo, id, 1)).toMatchObject({ configured: false, text: null });
    const r = await runCli(dir, ['explain'], { env: { PATH: `${stub.binDir}:${oldPath}` } });
    expect(r.code).toBe(1);
    expect(existsSync(stub.count)).toBe(false);
  });

  it('codex stub: read-only sandbox, ephemeral, empty cwd, answer read from -o file', async () => {
    const dir = makeRepo();
    const stub = makeStub('codex');
    process.env['PATH'] = `${stub.binDir}:${oldPath}`;
    git(dir, 'config', `${NAME}.provider`, 'codex');
    const { repo, id } = await session(dir);
    const r = await explainStep(repo, id, 1);
    expect(r.text).toContain('stub codex explanation');
    const argv = readFileSync(stub.log, 'utf8').split('\n');
    expect(argv.slice(0, 2)).toEqual(['exec', '-s']);
    expect(argv).toEqual(expect.arrayContaining(['read-only', '--ephemeral', '--skip-git-repo-check', '-C', '-o', '-']));
    expect(argv[argv.indexOf('-C') + 1]).not.toBe(dir);
  });

  it('missing CLI on PATH gives a clear error and failures are not retried or cached', async () => {
    const dir = makeRepo();
    git(dir, 'config', `${NAME}.provider`, 'claude');
    const { repo, id } = await session(dir);
    process.env['PATH'] = '/usr/bin:/bin'; // has git, has no claude
    await expect(explainStep(repo, id, 1)).rejects.toThrow(/"claude" was not found on PATH/);
    expect(await readExplanation(repo, id, 1)).toMatchObject({ configured: true, text: null });
  });

  it('unknown provider value is rejected', async () => {
    const dir = makeRepo();
    git(dir, 'config', `${NAME}.provider`, 'rm -rf');
    const { repo, id } = await session(dir);
    await expect(explainStep(repo, id, 1)).rejects.toThrow(/unknown provider/);
  });

  it('timeout kills the provider (no retry)', async () => {
    const dir = makeRepo();
    const stub = makeStub('claude');
    writeFileSync(join(stub.binDir, 'claude'), `#!/bin/sh\necho x >> '${stub.count}'\nsleep 5\n`);
    process.env['PATH'] = `${stub.binDir}:${oldPath}`;
    process.env['REVIEWROLL_EXPLAIN_TIMEOUT_MS'] = '300';
    git(dir, 'config', `${NAME}.provider`, 'claude');
    const { repo, id } = await session(dir);
    try {
      await expect(explainStep(repo, id, 1)).rejects.toThrow(/timed out/);
    } finally {
      delete process.env['REVIEWROLL_EXPLAIN_TIMEOUT_MS'];
    }
    expect(readFileSync(stub.count, 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('fixture provider (demo only) makes no external call and uses canned text by note', async () => {
    const dir = makeRepo();
    const f = join(dir, '..', `fx-${Date.now()}.json`);
    writeFileSync(f, JSON.stringify({ 'edit-a': '- canned' }));
    git(dir, 'config', `${NAME}.provider`, 'fixture');
    git(dir, 'config', `${NAME}.fixtureFile`, f);
    const { repo, id } = await session(dir);
    expect((await explainStep(repo, id, 1)).text.trim()).toBe('- canned');
  });
});
