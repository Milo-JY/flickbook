import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openRepo } from '../src/repo.js';
import { snapshotTree } from '../src/snapshot.js';
import { startSession, stepSession } from '../src/session.js';
import { git, makeRepo } from './helpers.js';
import { NAME } from '../src/name.js';

const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

describe('snapshot (unit 2)', () => {
  it('does not touch HEAD, index or work tree; includes untracked, excludes ignored', async () => {
    const dir = makeRepo();
    writeFileSync(join(dir, '.gitignore'), 'ign.txt\n');
    git(dir, 'add', '.gitignore');
    git(dir, 'commit', '-qm', 'ignore');
    writeFileSync(join(dir, 'a.txt'), 'changed\n');
    writeFileSync(join(dir, 'new.txt'), 'new\n');
    writeFileSync(join(dir, 'ign.txt'), 'ignored\n');
    const repo = await openRepo(dir);
    const before = {
      head: git(dir, 'rev-parse', 'HEAD'),
      idx: sha(join(repo.gitDir, 'index')),
      status: git(dir, 'status', '--porcelain'),
    };
    const tree = await snapshotTree(repo);
    const after = {
      head: git(dir, 'rev-parse', 'HEAD'),
      idx: sha(join(repo.gitDir, 'index')),
      status: git(dir, 'status', '--porcelain'),
    };
    expect(after).toEqual(before);
    const files = git(dir, 'ls-tree', '-r', '--name-only', tree).trim().split('\n');
    expect(files).toEqual(['.gitignore', 'a.txt', 'new.txt']);
    expect(git(dir, 'show', `${tree}:a.txt`)).toBe('changed\n');
    expect(readdirSync(repo.rr).filter((n) => n.startsWith('tmp-index'))).toEqual([]);
  });

  it('works in a repo with no commits and no index', async () => {
    const dir = makeRepo();
    const empty = join(dir, 'sub');
    mkdirSync(empty);
    const { mkdtempSync, realpathSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { execFileSync } = await import('node:child_process');
    const fresh = realpathSync(mkdtempSync(join(tmpdir(), 'rr-empty-')));
    execFileSync('git', ['init', '-q'], { cwd: fresh });
    writeFileSync(join(fresh, 'x.txt'), 'x\n');
    const repo = await openRepo(fresh);
    const tree = await snapshotTree(repo);
    expect(git(fresh, 'ls-tree', '-r', '--name-only', tree).trim()).toBe('x.txt');
  });

  it('same tree twice yields one ref', async () => {
    const dir = makeRepo();
    const repo = await openRepo(dir);
    const { id } = await startSession(repo);
    writeFileSync(join(dir, 'a.txt'), 'two\n');
    const r1 = await stepSession(repo);
    const r2 = await stepSession(repo);
    expect(r1.status).toBe('created');
    expect(r2.status).toBe('unchanged');
    expect(git(dir, 'for-each-ref', `refs/${NAME}/${id}/`).trim().split('\n')).toHaveLength(2);
  });
});
