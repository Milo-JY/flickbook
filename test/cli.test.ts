import { describe, expect, it } from 'vitest';
import { makeRepo, runCli } from './helpers.js';

describe('CLI surface (unit 1)', () => {
  it('--help lists the commands', async () => {
    const r = await runCli(makeRepo(), ['--help']);
    expect(r.code).toBe(0);
    for (const c of ['start', 'step', 'end', 'list', 'replay', 'explain', 'hook', 'rm']) expect(r.stdout).toContain(c);
  });

  it('outside a git repo: exit 1 with a plain message, no stack trace', async () => {
    const r = await runCli('/', ['list']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/not a git/);
    expect(r.stderr).not.toMatch(/\n\s+at /);
  });
});
