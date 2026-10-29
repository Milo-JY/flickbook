import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import type { AddressInfo } from 'node:net';
import { DEFAULTS } from './config.js';
import { countChangedFiles, diffFiles } from './diff.js';
import { RrError } from './errors.js';
import { explainStep, readExplanation, resolveLang } from './explain/index.js';
import { resolveProviderName } from './explain/providers.js';
import type { Repo } from './repo.js';
import { listSessions, parseStepNumber, readSteps, validateSessionId } from './session.js';
import { NAME } from './name.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
  });
  res.end(data);
}

export interface ServeOptions {
  repo: Repo;
  webRoot: string;
  port?: number;
}

export interface Running {
  server: Server;
  port: number;
  url: string;
  close(): Promise<void>;
}

export async function startServer(opts: ServeOptions): Promise<Running> {
  const { repo, webRoot } = opts;
  let port = 0;
  const allowedHosts = () => new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const allowedOrigins = () => new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);

  async function api(req: IncomingMessage, url: URL): Promise<unknown> {
    const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
    const method = req.method ?? 'GET';
    if (parts[0] === 'config' && parts.length === 1 && method === 'GET') {
      return {
        name: NAME,
        explanationReveal: DEFAULTS.explanationReveal,
        provider: await resolveProviderName(repo),
        lang: await resolveLang(repo),
      };
    }
    if (parts[0] !== 'sessions') throw new HttpError(404, 'not found');
    if (parts.length === 1) {
      if (method !== 'GET') throw new HttpError(405, 'method not allowed');
      return { sessions: (await listSessions(repo)).reverse() };
    }
    const id = await validateSessionId(repo, parts[1]!).catch(() => {
      throw new HttpError(400, 'invalid session id');
    });
    const steps = await readSteps(repo, id);
    if (steps.length === 0) throw new HttpError(404, 'session not found');
    if (parts.length === 2) {
      if (method !== 'GET') throw new HttpError(405, 'method not allowed');
      const out = [];
      for (const s of steps) {
        const prev = steps.find((x) => x.n === s.n - 1);
        out.push({
          n: s.n,
          kind: s.meta.kind,
          time: s.meta.time,
          source: s.meta.source,
          note: s.meta.note,
          context: s.meta.context,
          agentSummary: s.meta.agentSummary,
          filesChanged: prev ? await countChangedFiles(repo, prev.commit, s.commit) : 0,
        });
      }
      return { id, steps: out };
    }
    if (parts[2] !== 'steps' || parts.length < 4) throw new HttpError(404, 'not found');
    let n: number;
    try {
      n = parseStepNumber(parts[3]!);
    } catch {
      throw new HttpError(400, 'invalid step number');
    }
    const step = steps.find((s) => s.n === n);
    if (!step) throw new HttpError(404, 'step not found');
    const what = parts[4];
    if (what === 'diff' && method === 'GET') {
      const base = url.searchParams.get('base') ?? 'prev';
      if (base !== 'prev' && base !== 'baseline') throw new HttpError(400, 'invalid base');
      const from = steps.find((s) => s.n === (base === 'baseline' ? 0 : n - 1));
      if (!from || n === 0) return { base, files: [] };
      return { base, files: await diffFiles(repo, from.commit, step.commit) };
    }
    if (what === 'explanation' && method === 'GET') return readExplanation(repo, id, n);
    if (what === 'explain' && method === 'POST') {
      const r = await explainStep(repo, id, n, { force: url.searchParams.get('force') === '1' });
      return { provider: r.provider, configured: true, text: r.text };
    }
    throw new HttpError(404, 'not found');
  }

  async function serveStatic(url: URL, res: ServerResponse): Promise<void> {
    let rel: string;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      throw new HttpError(400, 'bad path');
    }
    if (rel.includes('\0')) throw new HttpError(400, 'bad path');
    if (rel === '/') rel = '/index.html';
    const full = normalize(join(webRoot, rel));
    if (full !== webRoot && !full.startsWith(webRoot + sep)) throw new HttpError(403, 'forbidden');
    let data: Buffer;
    try {
      data = await readFile(full);
    } catch {
      throw new HttpError(404, 'not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(full)] ?? 'application/octet-stream',
      ...SECURITY_HEADERS,
    });
    res.end(data);
  }

  const server = createServer((req, res) => {
    void (async () => {
      try {
        // DNS-rebinding guard for every request
        if (!allowedHosts().has(req.headers.host ?? '')) throw new HttpError(403, 'bad host');
        const method = req.method ?? 'GET';
        if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') throw new HttpError(405, 'method not allowed');
        if (method === 'POST') {
          // browsers always send Origin on cross-origin POST; require it to be us
          if (!allowedOrigins().has(req.headers.origin ?? '')) throw new HttpError(403, 'bad origin');
        }
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
        if (url.pathname.startsWith('/api/')) sendJson(res, 200, await api(req, url));
        else if (method === 'POST') throw new HttpError(404, 'not found');
        else await serveStatic(url, res);
      } catch (e) {
        if (e instanceof HttpError) sendJson(res, e.status, { error: e.message });
        else if (e instanceof RrError) sendJson(res, 422, { error: e.message });
        else {
          process.stderr.write(`${NAME}: ${(e as Error).message}\n`);
          sendJson(res, 500, { error: 'internal error' });
        }
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, '127.0.0.1', () => resolve());
  });
  port = (server.address() as AddressInfo).port;
  return {
    server,
    port,
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
