import { join } from 'node:path';
import { git } from './git.js';
import { RrError } from './errors.js';
import { NAME } from './name.js';

export interface Repo {
  /** Work tree root. */
  top: string;
  /** Absolute git dir (per work tree). */
  gitDir: string;
  /** `<gitDir>/<NAME>` — pointer, tmp indexes, caches. */
  rr: string;
}

export async function openRepo(cwd: string): Promise<Repo> {
  const r = await git(['rev-parse', '--show-toplevel', '--absolute-git-dir'], {
    cwd,
    allowFail: true,
  }).catch((e: unknown) => {
    if (e instanceof RrError) throw e;
    throw new RrError(`not a git repository: ${cwd}`);
  });
  const [top, gitDir] = r.stdout.split('\n');
  if (r.code !== 0 || !top || !gitDir) throw new RrError(`not a git work tree: ${cwd}`);
  return { top, gitDir, rr: join(gitDir, NAME) };
}

/** `git config --get <key>` or undefined. */
export async function gitConfig(repo: Repo, key: string): Promise<string | undefined> {
  const r = await git(['config', '--get', key], { cwd: repo.top, allowFail: true });
  const v = r.stdout.trim();
  return r.code === 0 && v ? v : undefined;
}
