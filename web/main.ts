import { html as diffToHtml } from 'diff2html';
import 'diff2html/bundles/css/diff2html.min.css';
import './style.css';
import { translate, pickLang, type MessageKey } from './i18n';
import { gapIsCalm, revealGateShown, leadingPath, parseExplanation, splitConcept, type Part, type PartKey } from './explain-parse';

interface SessionSummary { id: string; steps: number; start: string; last: string; active: boolean; note: string }
interface StepInfo {
  n: number; kind: string; time: string; source: string; note: string;
  context: string; agentSummary: string; filesChanged: number;
}
interface FileDiff { status: string; path: string; oldPath?: string; diff: string }
interface Explanation { provider: string; configured: boolean; text: string | null; truncated?: boolean; omitted?: string[] }
interface StatsFile { path: string; oldPath?: string; added: number; removed: number; binary: boolean }
interface StatsMetrics { added: number; removed: number; filesTouched: number; largestHunk: number; indentSum: number; indentMax: number }
interface Stats {
  steps: { n: number; files: StatsFile[]; metrics: StatsMetrics }[];
  unmeasured: { path: string; reason: string }[];
}
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
  stats: null as Stats | null,
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

/** `file`: show only this path's diff once loaded (all files if the step has no such path). */
async function loadStep(file?: string): Promise<void> {
  state.file = -1;
  state.revealed = false;
  state.explainError = '';
  const n = state.sel;
  const diff = await getJson<{ files: FileDiff[] }>(
    `/api/sessions/${state.sessionId}/steps/${n}/diff?base=${state.base}`,
  );
  state.files = diff.files;
  if (file !== undefined) state.file = state.files.findIndex((f) => f.path === file);
  render();
  if (n > 0) {
    const ex = await getJson<Explanation>(`/api/sessions/${state.sessionId}/steps/${n}/explanation`);
    if (state.sel === n) { cache.set(n, ex); render(); }
  }
}
const cache = new Map<number, Explanation>();

async function selectStep(n: number, file?: string): Promise<void> {
  if (n < 0 || n >= state.steps.length) return;
  state.sel = n;
  history.replaceState(null, '', `#/${state.sessionId}/${n}`);
  await loadStep(file).catch(showFatal);
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
    if (state.sel === n) state.revealed = true; // the user just asked for the text; do not hide it behind a second click
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

function renderExplanationText(text: string, partial: boolean): HTMLElement[] {
  const parsed = parseExplanation(text);
  if (!parsed) return [el('pre', { text })];
  const paths = state.files.map((f) => f.path);
  const out: HTMLElement[] = [];
  if (parsed.pre) out.push(el('pre', { text: parsed.pre }));
  for (const p of parsed.parts) {
    const calm = p.key === 'gap' && gapIsCalm(p, partial);
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
    // the agent's own account is hidden only while the Reveal button is shown, so it can always be brought back
    const hideAgent = revealGateShown({
      mode: state.config.explanationReveal, revealed: state.revealed, provider: state.config.provider,
      step: state.sel, filesChanged: s.filesChanged, hasText: !!cache.get(state.sel)?.text,
    });
    if (s.agentSummary && !hideAgent) why.append(el('div', {}, el('b', { text: t('why.agent') }), firstLine(s.agentSummary)));
    if (why.firstChild) box.append(why);
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
      // fixed text, never written by the model: the explanation did not see the whole diff
      const omitted = ex.omitted?.length ?? 0;
      if (omitted) box.append(el('div', { cls: 'notice', text: t('explain.omitted', { n: omitted }) }));
      else if (ex.truncated) box.append(el('div', { cls: 'notice', text: t('explain.partial') }));
      box.append(...renderExplanationText(ex.text, omitted > 0 || !!ex.truncated));
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

// Piano-roll timeline: rows = files changed anywhere in the session (biggest first), columns = steps 1..N.
// Built once per session from /stats; render() only moves the `sel` class. All text goes in via textContent.
const timelineBox = el('section', { id: 'timeline' });
let colEls = new Map<number, Element[]>();
const tips = new Map<HTMLElement, string>();
const tipEl = el('div', { id: 'tip' });
document.body.append(tipEl);

const signed = (a: number, r: number) => `+${a} −${r}`;

const SVG_NS = 'http://www.w3.org/2000/svg';
const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

/** One small line per metric, drawn on the timeline's own columns; y = difference from step 0. Not a quality score. */
function trendRows(grid: HTMLElement, cols: Stats['steps'], base: StatsMetrics, mark: (n: number, e: Element) => void): void {
  grid.append(el('div', { cls: 'tl-sub', text: t('trend.title') }));
  const metrics: [MessageKey, (m: StatsMetrics) => number][] = [
    ['trend.lines', (m) => m.added - m.removed],
    ['trend.indentSum', (m) => m.indentSum],
    ['trend.indentMax', (m) => m.indentMax],
  ];
  for (const [key, pick] of metrics) {
    const vals = cols.map((c) => pick(c.metrics) - pick(base));
    const lo = Math.min(0, ...vals);
    const hi = Math.max(0, ...vals);
    const y = (v: number) => (hi === lo ? 50 : 90 - ((v - lo) / (hi - lo)) * 80);
    grid.append(el('div', { cls: 'tl-label', text: t(key) }));
    const svg = svgEl('svg', { viewBox: `0 0 ${cols.length} 100`, preserveAspectRatio: 'none', class: 'tl-trend', role: 'img' });
    svg.append(svgEl('line', { x1: '0', x2: String(cols.length), y1: String(y(0)), y2: String(y(0)), class: 'zero', 'vector-effect': 'non-scaling-stroke' }));
    svg.append(svgEl('polyline', { points: vals.map((v, i) => `${i + 0.5},${y(v)}`).join(' '), class: 'line', 'vector-effect': 'non-scaling-stroke' }));
    cols.forEach((c, i) => {
      const hit = svgEl('rect', { x: String(i), y: '0', width: '1', height: '100', class: 'hit' });
      const v = vals[i]!;
      const title = svgEl('title');
      title.textContent = t('trend.tip', { n: c.n, label: t(key), value: `${v > 0 ? '+' : ''}${v}` });
      hit.append(title);
      hit.addEventListener('click', () => void selectStep(c.n));
      mark(c.n, hit);
      svg.append(hit);
    });
    svg.style.gridColumn = '2 / -1';
    grid.append(svg);
  }
}

function buildTimeline(): void {
  timelineBox.replaceChildren();
  colEls = new Map();
  tips.clear();
  const stats = state.stats;
  if (!stats) return;
  const cols = stats.steps.filter((s) => s.n > 0);
  if (cols.length === 0) {
    timelineBox.append(el('div', { cls: 'hint', text: t('timeline.baselineOnly') }));
    return;
  }
  const totals = new Map<string, number>();
  const at = new Map<number, Map<string, StatsFile>>();
  let maxCell = 1;
  for (const s of cols) {
    const m = new Map<string, StatsFile>();
    at.set(s.n, m);
    for (const f of s.files) {
      m.set(f.path, f);
      totals.set(f.path, (totals.get(f.path) ?? 0) + f.added + f.removed);
      maxCell = Math.max(maxCell, f.added + f.removed);
    }
  }
  const rows = [...totals.keys()].sort((a, b) => totals.get(b)! - totals.get(a)! || (a < b ? -1 : a > b ? 1 : 0));
  const grid = el('div', { cls: 'tl-grid' });
  grid.style.gridTemplateColumns = `minmax(90px, 220px) repeat(${cols.length}, minmax(12px, 1fr))`;
  const mark = (n: number, e: Element) => { (colEls.get(n) ?? colEls.set(n, []).get(n)!).push(e); };

  grid.append(el('div', { cls: 'tl-corner', text: t('timeline.title') }));
  for (const s of cols) {
    const h = el('div', { cls: 'tl-head', text: String(s.n) });
    h.addEventListener('click', () => void selectStep(s.n));
    mark(s.n, h);
    grid.append(h);
  }
  const base = stats.steps.find((s) => s.n === 0);
  if (base) trendRows(grid, cols, base.metrics, mark);
  for (const path of rows) {
    const label = el('div', { cls: 'tl-label', text: path });
    tips.set(label, path);
    grid.append(label);
    for (const s of cols) {
      const f = at.get(s.n)!.get(path);
      const cell = el('div', { cls: 'cell' });
      if (f?.binary) {
        cell.classList.add('bin');
        cell.textContent = t('timeline.binary');
        tips.set(cell, t('timeline.binary'));
      } else if (f) {
        const total = f.added + f.removed;
        cell.classList.add(total ? 'on' : 'same'); // 'same': touched without a line change (e.g. a pure rename)
        const add = el('span', { cls: 'a' });
        const del = el('span', { cls: 'd' });
        add.style.flexGrow = String(f.added);
        del.style.flexGrow = String(f.removed);
        cell.style.opacity = String(0.3 + 0.7 * (total ? Math.log1p(total) / Math.log1p(maxCell) : 0));
        cell.append(add, del);
        tips.set(cell, signed(f.added, f.removed));
      }
      cell.addEventListener('click', () => { state.base = 'prev'; void selectStep(s.n, path); });
      mark(s.n, cell);
      grid.append(cell);
    }
  }
  grid.addEventListener('mousemove', (e) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>('.cell, .tl-label');
    const text = c ? tips.get(c) : undefined;
    if (text === undefined) { tipEl.style.display = 'none'; return; }
    tipEl.textContent = text;
    tipEl.style.display = 'block';
    tipEl.style.left = `${Math.min(e.clientX + 12, window.innerWidth - 160)}px`;
    tipEl.style.top = `${e.clientY + 14}px`;
  });
  grid.addEventListener('mouseleave', () => { tipEl.style.display = 'none'; });
  timelineBox.append(grid);
}

function updateTimelineSel(): void {
  for (const [n, els] of colEls) for (const e of els) e.classList.toggle('sel', n === state.sel);
  timelineBox.querySelector('.tl-head.sel')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

async function loadStats(): Promise<void> {
  try {
    state.stats = await getJson<Stats>(`/api/sessions/${state.sessionId}/stats`);
    buildTimeline();
    render();
  } catch (e) {
    timelineBox.replaceChildren(el('div', { cls: 'hint', text: t('error.prefix', { message: (e as Error).message }) }));
  }
}

let renderedSel = -1;
function render(): void {
  const header = el('header', {}, el('h1', { text: state.config.name }), el('span', { cls: 'sess', text: state.sessionId }), el('span', { cls: 'spacer' }),
    seg([['prev', t('diff.prev')], ['baseline', t('diff.baseline')]], state.base, (v) => { state.base = v as 'prev' | 'baseline'; void loadStep().catch(showFatal); }),
    seg([['line-by-line', t('layout.unified')], ['side-by-side', t('layout.split')]], state.layout, (v) => { state.layout = v as typeof state.layout; render(); }),
  );
  const main = el('main', {}, renderSteps(), renderCenter(), renderExplain());
  const prevScroll = document.querySelector('#steps')?.scrollTop ?? 0;
  const tlTop = timelineBox.scrollTop;
  const tlLeft = timelineBox.scrollLeft;
  // keep the explanation's scroll position while staying on the same step (e.g. after a file link click)
  const prevExplain = renderedSel === state.sel ? document.querySelector('#explain')?.scrollTop ?? 0 : 0;
  app.replaceChildren(header, timelineBox, main);
  timelineBox.scrollTop = tlTop; // re-attaching resets scroll
  timelineBox.scrollLeft = tlLeft;
  updateTimelineSel();
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
  void loadStats();
  await loadStep();
}

init().catch(showFatal);
