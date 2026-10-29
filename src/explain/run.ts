import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { RrError } from '../errors.js';
import { LIMITS } from '../config.js';
import { NAME } from '../name.js';

export async function findOnPath(cmd: string): Promise<string | null> {
  for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
    if (!dir) continue;
    const p = join(dir, cmd);
    try {
      await access(p, constants.X_OK);
      return p;
    } catch {
      /* next */
    }
  }
  return null;
}

export function timeoutMs(): number {
  const v = Number(process.env[`${NAME.toUpperCase()}_EXPLAIN_TIMEOUT_MS`]);
  return Number.isFinite(v) && v > 0 ? v : LIMITS.explainTimeoutMs;
}

/** Run a provider CLI once (no retry), prompt on stdin. Rejects on timeout, bad exit, empty output. */
export async function runCli(
  cmd: string,
  args: string[],
  opts: { input: string; cwd: string },
): Promise<string> {
  const bin = await findOnPath(cmd);
  if (!bin) throw new RrError(`"${cmd}" was not found on PATH. Install it, or change "git config ${NAME}.provider".`);
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: opts.cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let outBytes = 0;
    const err: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs());
    child.stdout.on('data', (d: Buffer) => {
      outBytes += d.length;
      if (outBytes <= LIMITS.explainOutputBytes) out.push(d);
    });
    child.stderr.on('data', (d: Buffer) => err.push(d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new RrError(`could not run ${cmd}: ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new RrError(`${cmd} timed out after ${timeoutMs() / 1000}s`));
      if (code !== 0) {
        const msg = Buffer.concat(err).toString('utf8').trim().slice(0, 300);
        return reject(new RrError(`${cmd} exited with ${code}${msg ? ': ' + msg : ''}`));
      }
      resolve(Buffer.concat(out).toString('utf8'));
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(opts.input);
  });
}
