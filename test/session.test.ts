import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openRepo } from '../src/repo.js';
import { activeId, endSession, listSessions, readSteps, startSession, stepSession, validateSessionId } from '../src/session.js';
import { CLI, git, makeRepo, runCli } from './helpers.js';
import { execFileSync, spawn } from 'node:child_process';
import { NAME } from '../src/name.js';
import { commitTree, createRef, snapshotTree } from '../src/snapshot.js';
import { formatMessage } from '../src/meta.js';
import { REF_PREFIX, ZERO_OID } from '../src/config.js';

describe('start/step/end/list (unit 3)', () => {
  it('start -> step x2 -> end creates 0000..0003 and clears the pointer', async () => {
    const dir = makeRepo();
    const repo = await openRepo(dir);
    const { id } = await startSession(repo, { name: 'My Task!', note: 'base' });
    expect(id).toMatch(/^\d{8}-\d{6}-my-task$/);
    expect(await activeId(repo)).toBe(id);
    writeFileSync(join(dir, 'a.txt'), 'two\n');
    await stepSession(repo, { note: 'first' });
    writeFileSync(join(dir, 'b.txt'), 'b\n');
    await stepSession(repo, { note: 'second', context: 'please add b' });
    const e = await endSession(repo, { note: 'done' });
    expect(e).toMatchObject({ status: 'created', n: 3 });
    const steps = await readSteps(repo, id);
    expect(steps.map((s) => s.n)).toEqual([0, 1, 2, 3]);
    expect(steps.map((s) => s.meta.kind)).toEqual(['baseline', 'step', 'step', 'end']);
    expect(steps[2]!.meta.context).toBe('please add b');
    expect(steps[1]!.meta.note).toBe('first');
    expect(await activeId(repo)).toBeNull();
    expect((await listSessions(repo))[0]).toMatchObject({ id, steps: 4, active: false });
  });

  it('end writes a snapshot even when nothing changed; a second end is a no-op', async () => {
    const dir = makeRepo();
    const repo = await openRepo(dir);
    await startSession(repo);
    expect((await endSession(repo)).status).toBe('created');
    expect((await endSession(repo)).status).toBe('inactive');
  });

  it('start that loses the pointer race removes its orphaned baseline ref', async () => {
    const dir = makeRepo();
    const repo = await openRepo(dir);
    mkdirSync(repo.rr, { recursive: true });
    writeFileSync(join(repo.rr, 'current'), 'not a valid id!\n'); // not "active", but the link target exists
    await expect(startSession(repo)).rejects.toThrow(/started at the same time/);
    expect(git(dir, 'for-each-ref', `refs/${NAME}/`).trim()).toBe('');
  });

  it('start while active is an error', async () => {
    const repo = await openRepo(makeRepo());
    await startSession(repo);
    await expect(startSession(repo)).rejects.toThrow(/already active/);
  });

  it('step without a session: exit 1; with --if-active: exit 0 silently (CLI)', async () => {
    const dir = makeRepo();
    const a = await runCli(dir, ['step']);
    expect(a.code).toBe(1);
    expect(a.stderr).toMatch(/no active session/);
    const b = await runCli(dir, ['step', '--if-active']);
    expect(b.code).toBe(0);
    expect(b.stdout).toBe('');
  });

  it('unchanged step exits 0 and writes no ref (CLI)', async () => {
    const dir = makeRepo();
    await runCli(dir, ['start']);
    const r = await runCli(dir, ['step']);
    expect(r.code).toBe(0);
    expect(git(dir, 'for-each-ref', `refs/${NAME}/`).trim().split('\n')).toHaveLength(1);
  });

  it('concurrent processes: both succeed, numbering has no gaps or duplicates', async () => {
    const dir = makeRepo();
    await runCli(dir, ['start']);
    writeFileSync(join(dir, 'a.txt'), 'concurrent\n');
    const results = await Promise.all([0, 1, 2, 3].map(() => runCli(dir, ['step', '--if-active'])));
    expect(results.map((r) => r.code)).toEqual([0, 0, 0, 0]);
    const refs = git(dir, 'for-each-ref', '--format=%(refname)', `refs/${NAME}/`).trim().split('\n');
    expect(refs.map((r) => r.slice(-4))).toEqual(['0000', '0001']);
  });

  it('lost race for a step number with DIFFERENT trees: the loser retries with the next number', async () => {
    const dir = makeRepo();
    const repo = await openRepo(dir);
    const { id } = await startSession(repo);
    writeFileSync(join(dir, 'a.txt'), 'A\n');
    let injected = false;
    const loser = stepSession(repo, {
      note: 'loser',
      beforeRef: async () => {
        if (injected) return;
        injected = true;
        // another actor sees a different tree and takes number 0001 first
        // (written directly: stepSession itself is serialized by the repo lock, which is what we bypass here)
        writeFileSync(join(dir, 'a.txt'), 'B\n');
        const base = (await readSteps(repo, id))[0]!;
        const msg = formatMessage(1, { session: id, kind: 'step', source: 'cli', head: '(none)', note: 'winner', context: '', agentSummary: '' });
        const c = await commitTree(repo, await snapshotTree(repo), base.commit, msg);
        await createRef(repo, `${REF_PREFIX}/${id}/0001`, c, ZERO_OID);
        writeFileSync(join(dir, 'a.txt'), 'A\n');
      },
    });
    // the loser's tree (A) was snapshotted before the winner (B) ran
    const r = await loser;
    expect(r).toMatchObject({ status: 'created', n: 2 });
    const steps = await readSteps(repo, id);
    expect(steps.map((s) => [s.n, s.meta.note])).toEqual([[0, ''], [1, 'winner'], [2, 'loser']]);
  });

  it('survives a stale tmp index and a killed step; fsck is clean', async () => {
    const dir = makeRepo();
    const repo = await openRepo(dir);
    await startSession(repo);
    mkdirSync(repo.rr, { recursive: true });
    const stale = join(repo.rr, 'tmp-index-2147483646-dead');
    writeFileSync(stale, 'garbage');
    const old = new Date(Date.now() - 3600_000);
    utimesSync(stale, old, old);
    writeFileSync(join(dir, 'a.txt'), 'x\n');
    const c = spawn('node', [CLI, 'step'], { cwd: dir, stdio: 'ignore' });
    setTimeout(() => c.kill('SIGKILL'), 25);
    await new Promise((r) => c.on('close', r));
    const fsck = git(dir, 'fsck', '--no-dangling');
    expect(fsck).not.toMatch(/error|fatal|broken/i);
    const r = await runCli(dir, ['step', '--if-active']);
    expect(r.code).toBe(0);
    expect(existsSync(stale)).toBe(false);
  });

  it('rejects invalid session ids and step numbers', async () => {
    const dir = makeRepo();
    const repo = await openRepo(dir);
    await expect(validateSessionId(repo, '../x')).rejects.toThrow(/invalid session id/);
    await expect(validateSessionId(repo, 'a b')).rejects.toThrow();
    const r = await runCli(dir, ['rm', '../etc', '--yes']);
    expect(r.code).toBe(1);
    const r2 = await runCli(dir, ['replay', 'bad/id', '--no-open']);
    expect(r2.code).toBe(1);
  });

  it('a commit message cannot forge step records (raw message written without formatMessage)', async () => {
    const dir = makeRepo();
    const repo = await openRepo(dir);
    const { id } = await startSession(repo);
    const tree = git(dir, 'rev-parse', 'HEAD^{tree}').trim();
    const base = git(dir, 'rev-parse', `refs/${NAME}/${id}/0000`).trim();
    const forged = `x\x1e\nrefs/${NAME}/${id}/0007\x1f--output=/nonexistent/x\x1f${tree}\x1fy\n${'0'.repeat(40)} ${tree} refs/${NAME}/${id}/0008\n`;
    const c = execFileSync('git', ['commit-tree', '-p', base, tree], { cwd: dir, input: forged, encoding: 'utf8' }).trim();
    git(dir, 'update-ref', `refs/${NAME}/${id}/0001`, c);
    const steps = await readSteps(repo, id);
    expect(steps.map((s) => [s.n, s.commit])).toEqual([[0, base], [1, c]]);
    expect(steps[1]!.meta.session).toBe('');
    expect((await listSessions(repo))[0]).toMatchObject({ id, steps: 2 });
  });

  it('rm deletes the refs', async () => {
    const dir = makeRepo();
    const repo = await openRepo(dir);
    const { id } = await startSession(repo);
    await endSession(repo);
    const r = await runCli(dir, ['rm', id, '--yes']);
    expect(r.code).toBe(0);
    expect(git(dir, 'for-each-ref', `refs/${NAME}/`).trim()).toBe('');
  });
});

describe('end vs step/end races', () => {
  it('a step that was in flight when end ran does not land after the end snapshot', async () => {
    const dir = makeRepo();
    const repo = await openRepo(dir);
    const { id } = await startSession(repo);
    writeFileSync(join(dir, 'a.txt'), 'late\n');
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let reached!: () => void;
    const at = new Promise<void>((r) => (reached = r));
    const step = stepSession(repo, { beforeRef: async () => { reached(); await gate; } });
    await at;
    writeFileSync(join(dir, 'a.txt'), 'later\n'); // end sees a different tree than the in-flight step
    const end = endSession(repo); // must queue behind the in-flight step
    release();
    await Promise.all([step.catch(() => undefined), end]);
    const kinds = (await readSteps(repo, id)).map((s) => s.meta.kind);
    expect(kinds.filter((k) => k === 'end')).toHaveLength(1);
    expect(kinds[kinds.length - 1]).toBe('end');
  });

  it('concurrent end processes produce exactly one end snapshot', async () => {
    for (let round = 0; round < 3; round++) {
      const dir = makeRepo();
      const repo = await openRepo(dir);
      const { id } = await startSession(repo);
      await Promise.all([runCli(dir, ['end']), runCli(dir, ['end']), runCli(dir, ['end'])]);
      const kinds = (await readSteps(repo, id)).map((s) => s.meta.kind);
      expect(kinds.filter((k) => k === 'end')).toHaveLength(1);
    }
  });
});
