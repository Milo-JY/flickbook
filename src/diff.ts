import { git } from './git.js';
import type { Repo } from './repo.js';

export type DiffBase = 'prev' | 'baseline';

export interface FileChange {
  status: string; // A M D R C T ...
  path: string;
  oldPath?: string;
}

export interface FileDiff extends FileChange {
  diff: string;
}

const COMMON = ['diff-tree', '-r', '-M', '--no-color', '--no-ext-diff', '--no-textconv'];

export async function nameStatus(repo: Repo, a: string, b: string): Promise<FileChange[]> {
  const r = await git([...COMMON, '--name-status', '-z', a, b], { cwd: repo.top });
  const parts = r.stdout.split('\0');
  const out: FileChange[] = [];
  for (let i = 0; i < parts.length; ) {
    const st = parts[i++];
    if (!st) break;
    const code = st[0]!;
    if (code === 'R' || code === 'C') {
      const oldPath = parts[i++] ?? '';
      const path = parts[i++] ?? '';
      out.push({ status: code, path, oldPath });
    } else {
      out.push({ status: code, path: parts[i++] ?? '' });
    }
  }
  return out;
}

/** Split a multi-file unified diff into per-file chunks. */
export function splitPatch(patch: string): string[] {
  if (!patch) return [];
  const chunks: string[] = [];
  let cur: string[] = [];
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ') && cur.length) {
      chunks.push(cur.join('\n'));
      cur = [];
    }
    cur.push(line);
  }
  if (cur.length) chunks.push(cur.join('\n'));
  return chunks.map((c) => (c.endsWith('\n') ? c : c + '\n'));
}

function pathFromHeader(chunk: string): string {
  const m = /^diff --git a\/(.*) b\/(.*)$/m.exec(chunk);
  return m?.[2] ?? '(unknown)';
}

export async function diffFiles(repo: Repo, a: string, b: string): Promise<FileDiff[]> {
  const [changes, patch] = await Promise.all([
    nameStatus(repo, a, b),
    git([...COMMON, '-p', a, b], { cwd: repo.top }).then((r) => r.stdout),
  ]);
  const chunks = splitPatch(patch);
  if (chunks.length === changes.length) {
    return changes.map((c, i) => ({ ...c, diff: chunks[i]! }));
  }
  // should not happen (same diff queue); degrade to header-derived names
  return chunks.map((c) => ({ status: 'M', path: pathFromHeader(c), diff: c }));
}

export const countChangedFiles = async (repo: Repo, a: string, b: string): Promise<number> =>
  (await nameStatus(repo, a, b)).length;
