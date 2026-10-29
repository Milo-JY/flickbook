import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openRepo } from '../src/repo.js';
import { readSteps, startSession } from '../src/session.js';
import { git, makeRepo, runCli } from './helpers.js';
import { NAME } from '../src/name.js';

describe('Claude Code hook adapter (unit 8)', () => {
  it('prompt hook stores context; stop hook makes a step carrying it', async () => {
    const dir = makeRepo();
    await runCli(dir, ['start']);
    const secret = 'PROMPT-BODY-should-not-be-printed';
    const p = await runCli(dir, ['hook', 'claude-prompt'], {
      input: JSON.stringify({ session_id: 's', cwd: dir, hook_event_name: 'UserPromptSubmit', prompt: secret }),
    });
    expect(p.code).toBe(0);
    expect(p.stdout + p.stderr).not.toContain(secret);
    const repo = await openRepo(dir);
    expect(readFileSync(join(repo.rr, 'pending-context.txt'), 'utf8')).toBe(secret);

    writeFileSync(join(dir, 'a.txt'), 'edited by agent\n');
    const s = await runCli(dir, ['hook', 'claude-stop'], {
      input: JSON.stringify({ session_id: 's', cwd: dir, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'I edited a.txt.' }),
    });
    expect(s.code).toBe(0);
    expect(s.stdout).toBe('');
    const steps = await readSteps(repo, (await readSteps(repo, (await import('../src/session.js').then((m) => m.activeId(repo)))!))[0]!.meta.session);
    expect(steps).toHaveLength(2);
    expect(steps[1]!.meta).toMatchObject({ source: 'claude-code', context: secret, agentSummary: 'I edited a.txt.' });
    expect(existsSync(join(repo.rr, 'pending-context.txt'))).toBe(false);
  });

  it('stop hook with no changes is a no-op (also with stop_hook_active=true)', async () => {
    const dir = makeRepo();
    await runCli(dir, ['start']);
    const input = JSON.stringify({ cwd: dir, stop_hook_active: true });
    expect((await runCli(dir, ['hook', 'claude-stop'], { input })).code).toBe(0);
    expect(git(dir, 'for-each-ref', `refs/${NAME}/`).trim().split('\n')).toHaveLength(1);
  });

  it('never breaks the agent: no session, non-repo cwd, garbage stdin all exit 0 silently', async () => {
    const dir = makeRepo();
    for (const input of [JSON.stringify({ cwd: dir, prompt: 'x' }), JSON.stringify({ cwd: '/' }), 'not json', '', '[1,2]', JSON.stringify({ cwd: 5, prompt: {} })]) {
      for (const k of ['claude-prompt', 'claude-stop']) {
        const r = await runCli(dir, ['hook', k], { input });
        expect(r.code).toBe(0);
        expect(r.stdout).toBe('');
      }
    }
    expect(git(dir, 'for-each-ref', `refs/${NAME}/`).trim()).toBe('');
  });

  it('prints the settings snippet', async () => {
    const r = await runCli(makeRepo(), ['hook', 'claude']);
    expect(r.code).toBe(0);
    const json = r.stdout.slice(r.stdout.indexOf('{'));
    const parsed = JSON.parse(json) as { hooks: Record<string, unknown> };
    expect(Object.keys(parsed.hooks).sort()).toEqual(['Stop', 'UserPromptSubmit']);
  });
});
void startSession;
