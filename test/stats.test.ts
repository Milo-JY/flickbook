import { writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { git as gitRun } from '../src/git.js';
import { openRepo } from '../src/repo.js';
import { endSession, readSteps, startSession, stepSession } from '../src/session.js';
import { computeStats, indentMetrics, parseNumstat } from '../src/stats.js';
import { git, makeRepo } from './helpers.js';

describe('indentMetrics', () => {
  it('counts tab as 4 columns, ignores blank lines, reports sum and max', () => {
    expect(indentMetrics('a\n  b\n\tc\n\n   \n\t\t\td\n')).toEqual({ sum: 0 + 2 + 4 + 12, max: 12 });
    expect(indentMetrics('')).toEqual({ sum: 0, max: 0 });
    expect(indentMetrics('  x\r\n\r\n    \r\n')).toEqual({ sum: 2, max: 2 });
  });
});

describe('parseNumstat (real git output)', () => {
  it('pins the -z layout for normal, binary, added, deleted and renamed files', async () => {
    const dir = makeRepo();
    const w = (f: string, c: string | Buffer) => writeFileSync(join(dir, f), c);
    w('old.txt', 'l1\nl2\nl3\nl4\n');
    w('m.txt', 'x\n');
    w('gone.txt', 'a\n');
    w('b.bin', Buffer.from([0, 1, 2]));
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'one');
    git(dir, 'mv', 'old.txt', 'new name.txt');
    w('m.txt', 'x\ny\n');
    git(dir, 'rm', '-q', 'gone.txt');
    w('b.bin', Buffer.from([0, 1, 2, 3]));
    w('add.txt', 'n\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'two');
    const raw = (await gitRun(['diff-tree', '-r', '-M', '--numstat', '-z', '--end-of-options', 'HEAD~1', 'HEAD'], { cwd: dir })).stdout;
    // a rename record has an empty path field and the two names as separate NUL-terminated fields
    expect(raw).toBe('1\t0\tadd.txt\0-\t-\tb.bin\0' + '0\t1\tgone.txt\x001\t0\tm.txt\x000\t0\t\0old.txt\0new name.txt\0');
    expect(parseNumstat(raw)).toEqual([
      { path: 'add.txt', added: 1, removed: 0, binary: false },
      { path: 'b.bin', added: 0, removed: 0, binary: true },
      { path: 'gone.txt', added: 0, removed: 1, binary: false },
      { path: 'm.txt', added: 1, removed: 0, binary: false },
      { path: 'new name.txt', oldPath: 'old.txt', added: 0, removed: 0, binary: false },
    ]);
    expect(parseNumstat('')).toEqual([]);
  });
});

describe('computeStats', () => {
  it('measures a session, lists what it cannot measure, and is deterministic', async () => {
    const dir = makeRepo();
    const repo = await openRepo(dir);
    const w = (f: string, c: string | Buffer) => writeFileSync(join(dir, f), c);
    w('code.js', 'if (a) {\nb();\n}\n');
    git(dir, 'add', 'code.js');
    git(dir, 'commit', '-qm', 'code');
    const sid = (await startSession(repo)).id;
    w('code.js', 'if (a) {\n\tif (b) {\n\t\tc();\n\t}\n}\n'); // step 1: nested, +3 -1 lines
    w('package-lock.json', '{\n  "a": 1\n}\n');
    w('img.bin', Buffer.from([0, 1, 2]));
    w('big.txt', 'x'.repeat(1024 * 1024 + 1));
    await stepSession(repo, { note: 'nest' });
    renameSync(join(dir, 'code.js'), join(dir, 'moved.js')); // step 2: pure rename
    await stepSession(repo, { note: 'rename' });
    rmSync(join(dir, 'moved.js')); // step 3: delete the file
    await stepSession(repo, { note: 'delete' });
    await endSession(repo);
    const steps = await readSteps(repo, sid);
    const a = await computeStats(repo, steps);
    const b = await computeStats(repo, steps);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));

    expect(a.unmeasured).toEqual([
      { path: 'big.txt', reason: 'too-large' },
      { path: 'img.bin', reason: 'binary' },
      { path: 'package-lock.json', reason: 'lockfile' },
    ]);
    expect(a.steps.map((s) => s.n)).toEqual([0, 1, 2, 3, 4]); // 4 = the end snapshot, no further change
    const m = a.steps.map((s) => s.metrics);
    expect(m[0]).toEqual({ added: 0, removed: 0, filesTouched: 0, indentSum: 0, indentMax: 0 });
    // step 1: baseline has no indentation; now \t(4) + \t\t(8) + \t(4) = 16 columns, max 8
    expect(m[1]).toMatchObject({ added: 3, removed: 1, filesTouched: 1, indentSum: 16, indentMax: 8 });
    // step 2: a pure rename keeps indentation (old path 0 + new path 16), moves no lines
    expect(m[2]).toMatchObject({ indentSum: 16, indentMax: 8 });
    // step 3: deletion reads as a drop to 0
    expect(m[3]).toMatchObject({ indentSum: 0, indentMax: 0, filesTouched: 1, added: 0, removed: 3 });
    expect(a.steps[2]!.files).toEqual([{ path: 'moved.js', oldPath: 'code.js', added: 0, removed: 0, binary: false }]);
    expect(a.steps[1]!.files.map((f) => f.path)).toEqual(['big.txt', 'code.js', 'img.bin', 'package-lock.json']);
  });

  it('a baseline-only session has no changes and no git churn', async () => {
    const dir = makeRepo();
    const repo = await openRepo(dir);
    const sid = (await startSession(repo)).id;
    const r = await computeStats(repo, await readSteps(repo, sid));
    expect(r).toEqual({ steps: [{ n: 0, files: [], metrics: { added: 0, removed: 0, filesTouched: 0, indentSum: 0, indentMax: 0 } }], unmeasured: [] });
  });

  it('leaves files past the read budget unmeasured', async () => {
    const dir = makeRepo();
    const repo = await openRepo(dir);
    const sid = (await startSession(repo)).id;
    writeFileSync(join(dir, 'x.txt'), '  hello1\n');
    writeFileSync(join(dir, 'y.txt'), '  hello2\n');
    await stepSession(repo, { note: 'two files' });
    const r = await computeStats(repo, await readSteps(repo, sid), 10);
    expect(r.unmeasured).toEqual([{ path: 'y.txt', reason: 'budget' }]);
    expect(r.steps[1]!.metrics.indentSum).toBe(2); // only x.txt is counted
  });
});
