import { existsSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diffFiles } from '../src/diff.js';
import { openRepo } from '../src/repo.js';
import { startServer } from '../src/server.js';
import { activeId, listSessions, readSteps } from '../src/session.js';
import { git, makeRepo, runCli } from './helpers.js';
import { NAME } from '../src/name.js';

function get(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((res, rej) => {
    const req = request({ host: '127.0.0.1', port, method: 'GET', path }, (r) => {
      let b = '';
      r.on('data', (d: Buffer) => (b += d));
      r.on('end', () => res({ status: r.statusCode ?? 0, body: b }));
    });
    req.on('error', rej);
    req.end();
  });
}

describe('forged step records in commit messages (blocker 1 regression)', () => {
  it('a prompt carrying \\x1e/\\x1f + --output=<path> creates no fake step and writes no file', async () => {
    const dir = makeRepo();
    const victim = join(realpathSync(mkdtempSync(join(tmpdir(), 'rr-victim-'))), 'pwned.txt');
    await runCli(dir, ['start']);
    const repo = await openRepo(dir);
    const id = (await activeId(repo))!;
    const tree = git(dir, 'rev-parse', 'HEAD^{tree}').trim();
    const fake = (n: string, commit: string) => `\x1e\nrefs/${NAME}/${id}/${n}\x1f${commit}\x1f${tree}\x1fforged\n`;
    const payload = 'innocent prompt' + fake('0002', `--output=${victim}`) + fake('0003', `--output=${victim}`);

    await runCli(dir, ['hook', 'claude-prompt'], { input: JSON.stringify({ cwd: dir, prompt: payload }) });
    writeFileSync(join(dir, 'a.txt'), 'edited\n');
    await runCli(dir, ['hook', 'claude-stop'], { input: JSON.stringify({ cwd: dir, last_assistant_message: payload }) });

    const steps = await readSteps(repo, id);
    expect(steps.map((s) => s.n)).toEqual([0, 1]);
    for (const s of steps) expect(s.commit).toMatch(/^[0-9a-f]{40}$/);
    expect((await listSessions(repo)).map((s) => s.steps)).toEqual([2]);
    expect(steps[1]!.meta.context).toContain('innocent prompt');
    expect(steps[1]!.meta.context).not.toMatch(/[\x1e\x1f]/);

    const list = await runCli(dir, ['list']);
    expect(list.stdout).toMatch(/ 2 snapshots/);

    const run = await startServer({ repo, webRoot: resolve('dist/web') });
    try {
      for (const p of [`/api/sessions/${id}`, `/api/sessions/${id}/steps/2/diff`, `/api/sessions/${id}/steps/3/diff?base=baseline`]) {
        await get(run.port, p);
      }
      const detail = JSON.parse((await get(run.port, `/api/sessions/${id}`)).body) as { steps: unknown[] };
      expect(detail.steps).toHaveLength(2);
    } finally {
      await run.close();
    }
    expect(existsSync(victim)).toBe(false);
  });

  it('diff API treats an option-looking revision as a revision, not an option', async () => {
    const dir = makeRepo();
    const repo = await openRepo(dir);
    const victim = join(realpathSync(mkdtempSync(join(tmpdir(), 'rr-victim-'))), 'pwned.txt');
    const head = git(dir, 'rev-parse', 'HEAD').trim();
    await expect(diffFiles(repo, head, `--output=${victim}`)).rejects.toThrow();
    expect(existsSync(victim)).toBe(false);
  });
});
