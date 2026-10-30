import { html as diffToHtml } from 'diff2html';
import 'diff2html/bundles/css/diff2html.min.css';
import './style.css';
import { translate, pickLang, type MessageKey } from './i18n';
import { gapIsCalm, leadingPath, parseExplanation, splitConcept, type Part, type PartKey } from './explain-parse';

interface SessionSummary { id: string; steps: number; start: string; last: string; active: boolean; note: string }
interface StepInfo {
  n: number; kind: string; time: string; source: string; note: string;
  context: string; agentSummary: string; filesChanged: number;
}
interface FileDiff { status: string; path: string; oldPath?: string; diff: string }
interface Explanation { provider: string; configured: boolean; text: string | null }
interface Config { name: string; explanationReveal: 'immediate' | 'click'; provider: string; lang: string }

const state = {
  config: { name: '', explanationReveal: 'immediate', provider: 'none', lang: 'en' } as Config,
  sessions: [] as SessionSummary[],
  sessionId: '',
  steps: [] as StepInfo[],
  sel: 0,
  base: 'prev' as 'prev' | 'baseline',
  layout: 'line-by-line' as 'line-by-line' | 'side-by-side',
  files: [] as FileDiff[],
  file: -1, // -1 = all files
  revealed: false,
  explainError: '',
  busy: false,
};

const t = (key: MessageKey, vars?: Record<string, string | number>): string => translate(state.config.lang, key, vars);

const app = document.getElementById('app')!;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, props: { cls?: string; text?: string; id?: string } = {}, ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (props.cls) e.className = props.cls;
  if (props.id) e.id = props.id;
  if (props.text !== undefined) e.textContent = props.text;
  for (const k of kids) e.append(k);
  return e;
}

// "flickbook replay" opens /#t=<token>[/<session>[/<step>]]. The token is in the fragment, so it never reaches
// the server's request line or a Referer. Take it once, keep it for this tab only, and leave just the route in the URL.
const TOKEN_KEY = 'flickbook.token';
function takeToken(): string {
  const m = /^#t=([0-9a-f]{64})(\/.*)?$/.exec(location.hash);
  if (m) {
    try { sessionStorage.setItem(TOKEN_KEY, m[1]!); } catch { /* storage blocked: kept in memory only */ }
    history.replaceState(null, '', m[2] ? `#${m[2]}` : location.pathname + location.search);
    return m[1]!;
  }
  try { return sessionStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
}
const token = takeToken();

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { 'X-Flickbook-Token': token } });
  const body = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return body;
}

const pad = (n: number) => String(n).padStart(4, '0');
const shortTime = (t: string) => (t.length >= 19 ? t.slice(11, 19) : t);
const firstLine = (s: string) => s.split('\n').find((l) => l.trim()) ?? '';

async function loadStep(): Promise<void> {
  state.file = -1;
  state.revealed = false;
  state.explainError = '';
  const n = state.sel;
  const diff = await getJson<{ files: FileDiff[] }>(
    `/api/sessions/${state.sessionId}/steps/${n}/diff?base=${state.base}`,
  );
  state.files = diff.files;
  render();
  if (n > 0) {
    const ex = await getJson<Explanation>(`/api/sessions/${state.sessionId}/steps/${n}/explanation`);
    if (state.sel === n) { cache.set(n, ex); render(); }
  }
}
const cache = new Map<number, Explanation>();

async function selectStep(n: number): Promise<void> {
  if (n < 0 || n >= state.steps.length) return;
  state.sel = n;
  history.replaceState(null, '', `#/${state.sessionId}/${n}`);
  await loadStep().catch(showFatal);
}

function showFatal(e: unknown): void {
  app.replaceChildren(el('div', { cls: 'empty', text: t('error.prefix', { message: (e as Error).message }) }));
}

async function explainNow(): Promise<void> {
  state.busy = true; state.explainError = ''; render();
  const n = state.sel;
  try {
    const ex = await getJson<Explanation>(`/api/sessions/${state.sessionId}/steps/${n}/explain`, { method: 'POST' });
    cache.set(n, ex);
  } catch (e) {
    state.explainError = (e as Error).message;
  }
  state.busy = false; render();
}

function kindLabel(kind: string): string {
  return kind === 'baseline' || kind === 'step' || kind === 'end' ? t(`kind.${kind}`) : kind;
}

function renderSteps(): HTMLElement {
  const box = el('aside', { id: 'steps' });
  for (const s of state.steps) {
    const row = el('div', { cls: 'step' + (s.n === state.sel ? ' sel' : '') });
    row.append(el('div', { cls: 'top' }, el('span', { cls: 'num', text: pad(s.n) }), el('span', { cls: 'kind', text: kindLabel(s.kind) })));
    row.append(el('div', { cls: 'meta', text: `${shortTime(s.time)} · ${t('step.files', { n: s.filesChanged })} · ${s.source}` }));
    if (s.note) row.append(el('div', { cls: 'note', text: s.note }));
    if (s.context) row.append(el('div', { cls: 'prompt', text: firstLine(s.context) }));
    row.addEventListener('click', () => void selectStep(s.n));
    box.append(row);
  }
  return box;
}

function renderCenter(): HTMLElement {
  const c = el('section', { id: 'center' });
  const tabs = el('div', { id: 'tabs' });
  const mk = (label: string, idx: number) => {
    const b = el('button', { cls: state.file === idx ? 'on' : '', text: label });
    b.addEventListener('click', () => { state.file = idx; render(); });
    tabs.append(b);
  };
  mk(t('tabs.all', { n: state.files.length }), -1);
  state.files.forEach((f, i) => mk(`${f.status} ${f.path}`, i));
  const diff = el('div', { id: 'diff' });
  const shown = state.file === -1 ? state.files : state.files.filter((_, i) => i === state.file);
  if (shown.length === 0) {
    diff.append(el('div', { cls: 'empty', text: state.sel === 0 ? t('diff.baselineEmpty', { name: state.config.name }) : t('diff.noChanges') }));
  } else {
    // diff2html escapes file content; the string it returns is the only thing assigned as HTML
    diff.innerHTML = diffToHtml(shown.map((f) => f.diff).join('\n'), {
      drawFileList: false, matching: 'lines', outputFormat: state.layout,
    });
  }
  c.append(tabs, diff);
  return c;
}

// The labeled parts (en or ko). Model text is shown with textContent only, never as HTML; text that does not
// follow the format is shown as-is.
const PART_ICON: Record<PartKey | 'calm', string> = {
  requested: 'M4 5h16v10H9l-5 4z', // speech bubble
  done: 'M5 12.5l4.5 4.5L19 7.5', // check mark
  gap: 'M12 4l9 16H3zM12 10v4M12 17v.5', // warning triangle
  calm: 'M4 12h16', // level line: nothing missing
  check: 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z', // eye
  concepts: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z', // light bulb
};
const DEFAULT_OPEN: Record<PartKey, boolean> = { requested: false, done: false, gap: true, check: true, concepts: true };

function icon(d: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}

const openKey = (k: PartKey) => `${state.config.name}.explain.open.${k}`;
function partOpen(k: PartKey): boolean {
  try {
    const v = localStorage.getItem(openKey(k));
    if (v === '1' || v === '0') return v === '1';
  } catch { /* storage blocked: use the default */ }
  return DEFAULT_OPEN[k];
}
function rememberOpen(k: PartKey, open: boolean): void {
  try { localStorage.setItem(openKey(k), open ? '1' : '0'); } catch { /* storage blocked: not remembered */ }
}

function jumpToFile(path: string): void {
  const i = state.files.findIndex((f) => f.path === path);
  if (i < 0) return;
  state.file = i;
  render();
  document.getElementById('diff')?.scrollTo({ top: 0 });
}

function lineContent(p: Part, text: string, paths: string[]): (Node | string)[] {
  if (p.key === 'concepts') {
    const { name, meaning } = splitConcept(text);
    return meaning ? [el('span', { cls: 'chip', text: name }), el('div', { cls: 'meaning', text: meaning })] : [el('span', { cls: 'chip', text: name })];
  }
  const path = p.key === 'check' ? leadingPath(text, paths) : null;
  if (!path) return [text];
  const a = el('button', { cls: 'filelink', text: path });
  a.type = 'button';
  a.title = t('part.jump', { path });
  a.addEventListener('click', () => jumpToFile(path));
  return [a, text.slice((text.startsWith('`') ? 1 : 0) + path.length)];
}

function renderExplanationText(text: string): HTMLElement[] {
  const parsed = parseExplanation(text);
  if (!parsed) return [el('pre', { text })];
  const paths = state.files.map((f) => f.path);
  const out: HTMLElement[] = [];
  if (parsed.pre) out.push(el('pre', { text: parsed.pre }));
  for (const p of parsed.parts) {
    const calm = p.key === 'gap' && gapIsCalm(p);
    const card = el('details', { cls: `part part-${p.key}${calm ? ' calm' : ''}` });
    card.open = partOpen(p.key);
    card.addEventListener('toggle', () => rememberOpen(p.key, card.open));
    card.append(el('summary', {}, icon(PART_ICON[calm ? 'calm' : p.key]), el('span', { text: t(`part.${p.key}`) })));
    const body = el('div', { cls: 'body' });
    let list: HTMLUListElement | null = null;
    for (const line of p.lines) {
      if (line.bullet) {
        if (!list) { list = el('ul', { cls: p.key === 'concepts' ? 'concepts' : '' }); body.append(list); }
        list.append(el('li', {}, ...lineContent(p, line.text, paths)));
      } else {
        list = null;
        body.append(el('p', {}, ...lineContent(p, line.text, paths)));
      }
    }
    card.append(body);
    out.push(card);
  }
  return out;
}

function renderExplain(): HTMLElement {
  const box = el('aside', { id: 'explain' });
  const s = state.steps[state.sel];
  if (!s) return box;
  if (s.context || s.agentSummary) {
    const why = el('div', { cls: 'why' });
    if (s.context) why.append(el('div', {}, el('b', { text: t('why.prompt') }), firstLine(s.context)));
    if (s.agentSummary) why.append(el('div', {}, el('b', { text: t('why.agent') }), firstLine(s.agentSummary)));
    box.append(why);
  }
  box.append(el('h2', { text: t('explain.heading') }));
  if (state.sel === 0) { box.append(el('div', { cls: 'hint', text: t('explain.baselineHint') })); return box; }
  const ex = cache.get(state.sel);
  if (s.filesChanged === 0) {
    box.append(el('div', { cls: 'hint', text: t('explain.noChanges') }));
  } else if (state.config.provider === 'none') {
    box.append(el('div', { cls: 'hint', text: t('explain.noProvider', { name: state.config.name }) }));
  } else if (ex?.text) {
    if (state.config.explanationReveal === 'click' && !state.revealed) {
      const b = el('button', { cls: 'btn', text: t('explain.reveal') });
      b.addEventListener('click', () => { state.revealed = true; render(); });
      box.append(b);
    } else {
      box.append(...renderExplanationText(ex.text));
    }
  } else if (ex === undefined) {
    box.append(el('div', { cls: 'hint', text: t('explain.loading') }));
  } else {
    const b = el('button', { cls: 'btn', text: state.busy ? t('explain.busy') : state.explainError ? t('explain.retry') : t('explain.button') });
    b.disabled = state.busy;
    b.addEventListener('click', () => void explainNow());
    box.append(b, el('div', { cls: 'hint', text: t('explain.sends', { provider: state.config.provider }) }));
    if (state.explainError) box.append(el('div', { cls: 'err', text: state.explainError }));
  }
  return box;
}

function seg(opts: [string, string][], current: string, on: (v: string) => void): HTMLElement {
  const s = el('div', { cls: 'seg' });
  for (const [v, label] of opts) {
    const b = el('button', { cls: v === current ? 'on' : '', text: label });
    b.addEventListener('click', () => on(v));
    s.append(b);
  }
  return s;
}

let renderedSel = -1;
function render(): void {
  const header = el('header', {}, el('h1', { text: state.config.name }), el('span', { cls: 'sess', text: state.sessionId }), el('span', { cls: 'spacer' }),
    seg([['prev', t('diff.prev')], ['baseline', t('diff.baseline')]], state.base, (v) => { state.base = v as 'prev' | 'baseline'; void loadStep().catch(showFatal); }),
    seg([['line-by-line', t('layout.unified')], ['side-by-side', t('layout.split')]], state.layout, (v) => { state.layout = v as typeof state.layout; render(); }),
  );
  const main = el('main', {}, renderSteps(), renderCenter(), renderExplain());
  const prevScroll = document.querySelector('#steps')?.scrollTop ?? 0;
  // keep the explanation's scroll position while staying on the same step (e.g. after a file link click)
  const prevExplain = renderedSel === state.sel ? document.querySelector('#explain')?.scrollTop ?? 0 : 0;
  app.replaceChildren(header, main);
  renderedSel = state.sel;
  document.querySelector('#steps')!.scrollTop = prevScroll;
  document.querySelector('#explain')!.scrollTop = prevExplain;
  document.querySelector('#steps .sel')?.scrollIntoView({ block: 'nearest' });
}

function showEmpty(): void {
  app.replaceChildren(el('div', { cls: 'empty' },
    el('h2', { text: t('empty.title') }),
    el('p', { text: t('empty.body') }),
    el('pre', { text: `${state.config.name} start\n# ...edit...\n${state.config.name} step -m "what changed"\n${state.config.name} end` }),
  ));
}

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'j') void selectStep(state.sel + 1);
  else if (e.key === 'k') void selectStep(state.sel - 1);
});

async function init(): Promise<void> {
  state.config = await getJson<Config>('/api/config');
  document.documentElement.lang = pickLang(state.config.lang);
  document.title = state.config.name;
  state.sessions = (await getJson<{ sessions: SessionSummary[] }>('/api/sessions')).sessions;
  const [, hid, hstep] = location.hash.split('/');
  const pick = state.sessions.find((s) => s.id === hid) ?? state.sessions[0];
  if (!pick) return showEmpty();
  state.sessionId = pick.id;
  state.steps = (await getJson<{ steps: StepInfo[] }>(`/api/sessions/${pick.id}`)).steps;
  const want = Number(hstep);
  state.sel = Number.isInteger(want) && want >= 0 && want < state.steps.length ? want : Math.min(1, state.steps.length - 1);
  await loadStep();
}

init().catch(showFatal);
