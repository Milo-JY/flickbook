import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { html } from 'diff2html';
import { NAME } from '../src/name.js';
import { openRepo } from '../src/repo.js';
import { startServer, type Running } from '../src/server.js';
import { endSession, startSession, stepSession } from '../src/session.js';
import { git, makeRepo, runCli } from './helpers.js';

let dir: string;
let run: Running;
let sid: string;

function call(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  token: string | null = run.token,
  port = run.port,
): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
  return new Promise((res, rej) => {
    const all = token === null ? headers : { 'X-Flickbook-Token': token, ...headers };
    const req = request({ host: '127.0.0.1', port, method, path, headers: all }, (r) => {
      let b = '';
      r.on('data', (d: Buffer) => (b += d));
      r.on('end', () => res({ status: r.statusCode ?? 0, body: b, headers: r.headers }));
    });
    req.on('error', rej);
    req.end();
  });
}

beforeAll(async () => {
  dir = makeRepo();
  const repo = await openRepo(dir);
  sid = (await startSession(repo)).id;
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n');
  await stepSession(repo, { note: 'edit a', context: 'please edit a' });
  await endSession(repo);
  run = await startServer({ repo, webRoot: resolve('dist/web') });
});
afterAll(async () => run.close());

describe('local server (unit 5)', () => {
  it('exposes the UI language via /api/config (default en, ko when configured)', async () => {
    const cfg = async () => JSON.parse((await call('GET', '/api/config')).body) as { lang: string };
    expect((await cfg()).lang).toBe('en');
    git(dir, 'config', `${NAME}.lang`, 'ko');
    expect((await cfg()).lang).toBe('ko');
    git(dir, 'config', '--unset', `${NAME}.lang`);
    expect((await cfg()).lang).toBe('en');
  });

  it('serves sessions JSON on 127.0.0.1', async () => {
    const r = await call('GET', '/api/sessions');
    expect(r.status).toBe(200);
    const j = JSON.parse(r.body) as { sessions: { id: string; steps: number }[] };
    expect(j.sessions[0]).toMatchObject({ id: sid, steps: 3 });
  });

  it('is bound to loopback only (lsof)', () => {
    const out = execFileSync('lsof', ['-nP', '-iTCP', `-sTCP:LISTEN`, '-a', '-p', String(process.pid)], { encoding: 'utf8' });
    const line = out.split('\n').find((l) => l.includes(`:${run.port}`));
    expect(line).toMatch(/127\.0\.0\.1:/);
    expect(line).not.toMatch(/\*:|0\.0\.0\.0|\[::\]/);
  });

  it('rejects POST from a foreign or missing Origin with 403', async () => {
    const evil = await call('POST', `/api/sessions/${sid}/steps/1/explain`, { Origin: 'http://evil.example' });
    expect(evil.status).toBe(403);
    const none = await call('POST', `/api/sessions/${sid}/steps/1/explain`);
    expect(none.status).toBe(403);
  });

  it('requires the per-run token on every /api/ request (GET and POST); static files stay public', async () => {
    expect(run.token).toMatch(/^[0-9a-f]{64}$/);
    for (const path of ['/api/config', '/api/sessions', `/api/sessions/${sid}/steps/1/diff`]) {
      expect((await call('GET', path, {}, null)).status).toBe(403);
      expect((await call('GET', path, {}, '0'.repeat(64))).status).toBe(403);
      expect((await call('GET', path, {}, run.token.slice(0, 63))).status).toBe(403);
      expect((await call('GET', path)).status).toBe(200);
    }
    const post = `/api/sessions/${sid}/steps/1/explain`;
    expect((await call('POST', post, { Origin: run.url }, null)).status).toBe(403);
    expect((await call('POST', post, { Origin: run.url }, 'f'.repeat(64))).status).toBe(403);
    expect((await call('GET', '/', {}, null)).status).toBe(200);
  });

  it('rejects a foreign Host header (DNS rebinding)', async () => {
    const r = await call('GET', '/api/sessions', { Host: 'evil.example' });
    expect(r.status).toBe(403);
  });

  it('own Origin POST reaches the handler (provider unset -> 422 help, nothing spawned)', async () => {
    const r = await call('POST', `/api/sessions/${sid}/steps/1/explain`, { Origin: run.url });
    expect(r.status).toBe(422);
    expect(r.body).toMatch(/No explanation provider/);
  });

  it('diff endpoints: prev and baseline, validation, step 0', async () => {
    const d = JSON.parse((await call('GET', `/api/sessions/${sid}/steps/1/diff?base=prev`)).body) as { files: { path: string }[] };
    expect(d.files.map((f) => f.path)).toEqual(['a.txt']);
    const bl = JSON.parse((await call('GET', `/api/sessions/${sid}/steps/2/diff?base=baseline`)).body) as { files: { path: string }[] };
    expect(bl.files.map((f) => f.path)).toEqual(['a.txt']); // step 2 == end snapshot; baseline diff is cumulative
    expect((await call('GET', `/api/sessions/${sid}/steps/1/diff?base=nope`)).status).toBe(400);
    expect((await call('GET', `/api/sessions/${sid}/steps/abc/diff`)).status).toBe(400);
    expect((await call('GET', `/api/sessions/bad%20id/steps/1/diff`)).status).toBe(400);
    expect((await call('GET', `/api/sessions/${sid}/steps/9/diff`)).status).toBe(404);
    const z = JSON.parse((await call('GET', `/api/sessions/${sid}/steps/0/diff`)).body) as { files: unknown[] };
    expect(z.files).toEqual([]);
  });

  it('serves the web bundle with security headers; path traversal is refused', async () => {
    const r = await call('GET', '/');
    expect(r.status).toBe(200);
    expect(r.body).toContain('<div id="app">');
    expect(String(r.headers['content-security-policy'])).toContain("default-src 'self'");
    const t = await call('GET', '/..%2f..%2fpackage.json');
    expect([403, 404]).toContain(t.status);
  });

  it('web bundle loads nothing from remote origins (no CDN/fonts)', () => {
    const idx = readFileSync('dist/web/index.html', 'utf8');
    expect(idx).not.toMatch(/(src|href)="https?:/);
    for (const f of readdirSync('dist/web/assets').filter((n) => n.endsWith('.css'))) {
      expect(readFileSync(join('dist/web/assets', f), 'utf8')).not.toMatch(/url\(\s*['"]?https?:|@import\s+(url\()?['"]?https?:/);
    }
  });

  it('replay --no-open prints the URL with the token in the fragment (CLI)', async () => {
    const { spawn } = await import('node:child_process');
    const { CLI } = await import('./helpers.js');
    const c = spawn('node', [CLI, 'replay', '--no-open', sid], { cwd: dir });
    const line = await new Promise<string>((res) => {
      c.stdout.on('data', (d: Buffer) => {
        const m = /http:\/\/127\.0\.0\.1:\d+\S*/.exec(String(d));
        if (m) res(m[0]);
      });
    });
    const m = /^http:\/\/127\.0\.0\.1:(\d+)\/#t=([0-9a-f]{64})\/(.+)$/.exec(line);
    expect(m).toBeTruthy();
    expect(m![3]).toBe(sid);
    const p = Number(m![1]);
    expect((await call('GET', '/api/sessions', {}, m![2]!, p)).status).toBe(200);
    expect((await call('GET', '/api/sessions', {}, run.token, p)).status).toBe(403);
    const lsof = execFileSync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-a', '-p', String(c.pid)], { encoding: 'utf8' });
    expect(lsof).toMatch(/127\.0\.0\.1:/);
    expect(lsof).not.toMatch(/\*:\d|0\.0\.0\.0/);
    c.kill('SIGINT');
    await new Promise((r) => c.on('close', r));
  });
});

describe('XSS fixture for diff2html (unit 6)', () => {
  it('escapes markup inside code, file names and hunk headers', () => {
    const evil = '<script>alert(1)</script><img src=x onerror=alert(2)>';
    const diff = `diff --git a/${'<b>x</b>'}.js b/${'<b>x</b>'}.js\n--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@ ${evil}\n-${evil}\n+${evil}\n`;
    const out = html(diff, { drawFileList: false });
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('<img src=x');
    expect(out).toContain('&lt;script&gt;');
  });
});
void git; void tmpdir; void mkdtempSync; void runCli;
