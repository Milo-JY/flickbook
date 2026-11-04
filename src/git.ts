import { spawn } from 'node:child_process';
import { RrError } from './errors.js';

export interface GitResult {
  stdout: string;
  /** Raw stdout, for byte-length-delimited output such as `cat-file --batch`. */
  stdoutBuf: Buffer;
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
      const buf = Buffer.concat(out);
      const res = {
        stdout: buf.toString('utf8'),
        stdoutBuf: buf,
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

export interface BatchEntry {
  /** First token of the header line (the object id); for a missing object, whatever git echoed. */
  id: string;
  /** `missing` when git has no such object. */
  type: string;
  size: number;
  body: Buffer;
}

/**
 * Parse `git cat-file --batch` output: a header line, then exactly <size> bytes, then LF. One entry per
 * request, in request order. A missing object has a one-line `<name> missing` header and no body.
 */
export function parseBatch(buf: Buffer): BatchEntry[] {
  const out: BatchEntry[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const nl = buf.indexOf(0x0a, pos);
    if (nl < 0) break;
    const line = buf.subarray(pos, nl).toString('utf8');
    pos = nl + 1;
    if (line.endsWith(' missing')) {
      out.push({ id: line.slice(0, -8), type: 'missing', size: 0, body: Buffer.alloc(0) });
      continue;
    }
    const [id, type, size] = line.split(' ');
    const len = Number.parseInt(size ?? '', 10);
    if (!id || !type || !Number.isInteger(len)) {
      out.push({ id: line, type: 'missing', size: 0, body: Buffer.alloc(0) });
      continue;
    }
    out.push({ id, type, size: len, body: buf.subarray(pos, pos + len) });
    pos += len + 1; // trailing LF after the object
  }
  return out;
}
