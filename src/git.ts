import { spawn } from 'node:child_process';
import { RrError } from './errors.js';

export interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface GitOptions {
  cwd: string;
  env?: Record<string, string>;
  input?: string;
  /** Return the result instead of throwing on a non-zero exit. */
  allowFail?: boolean;
}

export function git(args: string[], opts: GitOptions): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-c', 'core.quotePath=false', ...args], {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => err.push(d));
    child.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') reject(new RrError('git was not found on PATH'));
      else reject(e);
    });
    child.on('close', (code) => {
      const res = {
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        code: code ?? 1,
      };
      if (res.code !== 0 && !opts.allowFail) {
        reject(new Error(`git ${args.join(' ')} failed (${res.code}): ${res.stderr.trim()}`));
      } else resolve(res);
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(opts.input ?? '');
  });
}
