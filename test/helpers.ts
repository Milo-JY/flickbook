import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** A throwaway git repo with one commit. Never use a real repository in tests. */
export function makeRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'rr-test-')));
  const g = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'test');
  writeFileSync(join(dir, 'a.txt'), 'one\n');
  g('add', 'a.txt');
  g('commit', '-qm', 'init');
  return dir;
}

export const git = (cwd: string, ...a: string[]): string =>
  execFileSync('git', a, { cwd, encoding: 'utf8' });

export interface CliResult { code: number; stdout: string; stderr: string }

export function runCli(cwd: string, args: string[], opts: { input?: string; env?: NodeJS.ProcessEnv } = {}): Promise<CliResult> {
  return new Promise((resolve) => {
    const c = spawn('node', [CLI, ...args], { cwd, env: { ...process.env, ...opts.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    c.stdout.on('data', (d: Buffer) => (stdout += d));
    c.stderr.on('data', (d: Buffer) => (stderr += d));
    c.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
    c.stdin.end(opts.input ?? '');
  });
}

/** Fake provider CLI: logs argv + stdin + env, counts spawns, prints a canned explanation. */
export function makeStub(name: 'claude'): { binDir: string; log: string; count: string; stdin: string; cwd: string; env: string } {
  const binDir = realpathSync(mkdtempSync(join(tmpdir(), 'rr-stub-')));
  const log = join(binDir, 'argv.log');
  const count = join(binDir, 'count.log');
  const stdin = join(binDir, 'stdin.txt');
  const cwd = join(binDir, 'cwd.txt');
  const env = join(binDir, 'env.txt');
  const where = `{ pwd; ls -A; } > '${cwd}'\nenv > '${env}'\n`;
  const script = `#!/bin/sh\n${where}echo x >> '${count}'\nprintf '%s\\n' "$@" > '${log}'\ncat > '${stdin}'\necho "- stub explanation"\n`;
  mkdirSync(binDir, { recursive: true });
  const p = join(binDir, name);
  writeFileSync(p, script);
  chmodSync(p, 0o755);
  return { binDir, log, count, stdin, cwd, env };
}
