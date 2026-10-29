import { copyFile, readdir, rm, stat, mkdir, access, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { git } from './git.js';
import type { Repo } from './repo.js';
import { LIMITS } from './config.js';
import { NAME } from './name.js';

const IDENT = {
  GIT_AUTHOR_NAME: NAME,
  GIT_AUTHOR_EMAIL: `${NAME}@localhost`,
  GIT_COMMITTER_NAME: NAME,
  GIT_COMMITTER_EMAIL: `${NAME}@localhost`,
};

/** A split user index must not make the temporary index write sharedindex.* files into the user's .git. */
const NO_SPLIT = ['-c', 'core.splitIndex=false'];

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Remove tmp indexes left behind by killed processes (never a live one's). */
export async function cleanStaleTmp(repo: Repo): Promise<void> {
  let names: string[];
  try {
    names = await readdir(repo.rr);
  } catch {
    return;
  }
  for (const n of names) {
    if (!n.startsWith('tmp-')) continue;
    const p = join(repo.rr, n);
    try {
      const st = await stat(p);
      if (Date.now() - st.mtimeMs > LIMITS.staleTmpIndexMs) await rm(p, { force: true, recursive: true });
    } catch {
      /* raced with another cleaner */
    }
  }
}

/**
 * Tree object of the current work tree (tracked changes + untracked, ignore rules respected),
 * built in a temporary index. HEAD, the user's index and the work tree are never written.
 */
export async function snapshotTree(repo: Repo): Promise<string> {
  await mkdir(repo.rr, { recursive: true });
  await cleanStaleTmp(repo);
  const tmp = join(repo.rr, `tmp-index-${process.pid}-${randomBytes(4).toString('hex')}`);
  const env = { GIT_INDEX_FILE: tmp };
  try {
    const userIndex = join(repo.gitDir, 'index');
    if (await exists(userIndex)) {
      await copyFile(userIndex, tmp);
      // keep the index mtime: git's racy-entry check compares it with file mtimes, and a fresh mtime
      // would make a same-size edit made in the same second look clean (and be left out)
      const st = await stat(userIndex);
      await utimes(tmp, st.atime, st.mtime);
    }
    else await git([...NO_SPLIT, 'read-tree', '--empty'], { cwd: repo.top, env });
    await git([...NO_SPLIT, 'add', '-A'], { cwd: repo.top, env });
    const r = await git([...NO_SPLIT, 'write-tree'], { cwd: repo.top, env });
    return r.stdout.trim();
  } finally {
    await rm(tmp, { force: true });
  }
}

/** Commit object for `tree` (root commit when no parent). Does not touch HEAD or any branch. */
export async function commitTree(
  repo: Repo,
  tree: string,
  parent: string | null,
  message: string,
): Promise<string> {
  const args = ['commit-tree'];
  if (parent) args.push('-p', parent);
  args.push('--end-of-options', tree);
  const r = await git(args, { cwd: repo.top, env: IDENT, input: message });
  return r.stdout.trim();
}

/** Create `ref` only if it does not exist yet. Returns false on a lost race. */
export async function createRef(repo: Repo, ref: string, commit: string, zero: string): Promise<boolean> {
  const r = await git(['update-ref', '--end-of-options', ref, commit, zero], { cwd: repo.top, allowFail: true });
  return r.code === 0;
}
