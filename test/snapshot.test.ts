import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, utimesSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openRepo } from '../src/repo.js';
import { cleanStaleTmp, snapshotTree } from '../src/snapshot.js';
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

  it('a same-size edit with an unchanged mtime is still seen (racy index copied with its mtime)', async () => {
    const dir = makeRepo();
    git(dir, 'config', 'core.trustctime', 'false');
    const past = new Date('2026-01-01T00:00:00Z');
    writeFileSync(join(dir, 'a.txt'), 'one\n');
    utimesSync(join(dir, 'a.txt'), past, past);
    git(dir, 'add', 'a.txt');
    const repo = await openRepo(dir);
    writeFileSync(join(dir, 'a.txt'), 'two\n'); // same size
    utimesSync(join(dir, 'a.txt'), past, past); // same mtime as the index entry
    utimesSync(join(repo.gitDir, 'index'), past, past); // index is "racy": entry mtime == index mtime
    const tree = await snapshotTree(repo);
    expect(git(dir, 'cat-file', '-p', `${tree}:a.txt`)).toBe('two\n');
  });

  it('a split user index: snapshots write no sharedindex.* into .git and still see edits', async () => {
    const dir = makeRepo();
    git(dir, 'config', 'core.splitIndex', 'true');
    git(dir, 'update-index', '--split-index');
    const repo = await openRepo(dir);
    const shared = () => readdirSync(repo.gitDir).filter((n) => n.startsWith('sharedindex.')).sort();
    const before = shared();
    expect(before.length).toBeGreaterThan(0);
    writeFileSync(join(dir, 'a.txt'), 'edited\n');
    writeFileSync(join(dir, 'new.txt'), 'new\n');
    const tree = await snapshotTree(repo);
    expect(git(dir, 'cat-file', '-p', `${tree}:a.txt`)).toBe('edited\n');
    expect(git(dir, 'cat-file', '-p', `${tree}:new.txt`)).toBe('new\n');
    expect(shared()).toEqual(before);
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

describe('stale tmp cleanup vs a live snapshot', () => {
  it('does not delete the live temp index of a concurrent snapshot, even when the user index is old', async () => {
    const dir = makeRepo();
    for (let i = 0; i < 1500; i++) writeFileSync(join(dir, `f${i}.txt`), `${i}\n`);
    const old = new Date(Date.now() - 3600_000);
    utimesSync(join(dir, '.git', 'index'), old, old);
    const repo = await openRepo(dir);
    const live = snapshotTree(repo);
    let seen = false;
    let survived = true;
    for (let i = 0; i < 20000 && !seen; i++) {
      let names: string[] = [];
      try { names = readdirSync(repo.rr).filter((n) => /^tmp-index-[^.]*$/.test(n)); } catch { /* not yet */ }
      for (const n of names) {
        const p = join(repo.rr, n);
        try {
          if (Date.now() - statSync(p).mtimeMs < 1800_000) continue; // utimes not applied yet
        } catch { continue; }
        seen = true;
        await cleanStaleTmp(repo);
        survived = existsSync(p);
      }
      if (!seen) await new Promise((r) => setImmediate(r));
    }
    await live;
    expect(seen).toBe(true);
    expect(survived).toBe(true);
  });
});
