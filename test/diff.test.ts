import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diffFiles, nameStatus, splitPatch } from '../src/diff.js';
import { openRepo } from '../src/repo.js';
import { readSteps, startSession, stepSession } from '../src/session.js';
import { makeRepo, git } from './helpers.js';

describe('diff module (unit 4)', () => {
  it('prev and baseline diffs for step 2 match the expected file sets', async () => {
    const dir = makeRepo();
    const repo = await openRepo(dir);
    const { id } = await startSession(repo);
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n'); // step 1: modify a
    await stepSession(repo);
    writeFileSync(join(dir, 'b.txt'), 'bee\n'); // step 2: add b
    git(dir, 'mv', 'a.txt', 'a2.txt'); // and rename a -> a2
    await stepSession(repo);
    const s = await readSteps(repo, id);
    const prev = await diffFiles(repo, s[1]!.commit, s[2]!.commit);
    const base = await diffFiles(repo, s[0]!.commit, s[2]!.commit);
    expect(prev.map((f) => `${f.status}:${f.path}`).sort()).toEqual(['A:b.txt', 'R:a2.txt']);
    expect(prev.find((f) => f.status === 'R')?.oldPath).toBe('a.txt');
    expect(base.map((f) => `${f.status}:${f.path}`).sort()).toEqual(['A:b.txt', 'R:a2.txt']);
    // baseline diff is cumulative: it contains the step-1 edit ("two") inside the renamed file
    expect(base.find((f) => f.path === 'a2.txt')!.diff).toContain('+two');
    expect(prev.find((f) => f.path === 'a2.txt')!.diff).not.toContain('+two');
    expect(prev.every((f) => f.diff.startsWith('diff --git'))).toBe(true);
  });

  it('deletions and paths with spaces', async () => {
    const dir = makeRepo();
    const repo = await openRepo(dir);
    const { id } = await startSession(repo);
    unlinkSync(join(dir, 'a.txt'));
    writeFileSync(join(dir, 'my file.txt'), 'x\n');
    await stepSession(repo);
    const s = await readSteps(repo, id);
    const ns = await nameStatus(repo, s[0]!.commit, s[1]!.commit);
    expect(ns.map((f) => `${f.status}:${f.path}`).sort()).toEqual(['A:my file.txt', 'D:a.txt']);
    expect(splitPatch('')).toEqual([]);
  });
});
