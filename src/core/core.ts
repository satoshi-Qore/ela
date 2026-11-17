// ELA Core: the theme and Core-view selectors and the three Core views. Loaded as its own chunk by
// web.ts, so the main bundle stays within its budget; each view is a further chunk of its own.
//
// It adds no execution engine. The record it draws is read from what web.ts already rendered from
// the agent session's real result: the execution flow (#flow, one state per stage), the query state,
// and the values the query read. It never calls the session, sends no request, and runs nothing:
// - a theme switch only sets <html data-theme> (pure CSS) and re-renders nothing;
// - a view switch re-renders the Core from the same record;
// - the Core re-renders only when web.ts changes the flow, the query state, the readout, or the language.
import type { CoreRecord, CoreStage, Render, Status, Text } from './draw.ts';

type View = 'karot' | 'optik' | 'gravur';
type Theme = 'light' | 'dark' | 'blue';
const VIEWS: Readonly<Record<View, () => Promise<{ render: Render }>>> = {
  karot: () => import('./karot.ts'),
  optik: () => import('./optik.ts'),
  gravur: () => import('./gravur.ts'),
};

// Flow states written by web.ts → the seven Core states.
const STATUS: Readonly<Record<string, Status>> = {
  idle: 'waiting', wait: 'running',
  done: 'ok', pass: 'ok', recognized: 'ok', ok: 'ok', success: 'ok',
  stopped: 'blocked', blocked: 'blocked', refused: 'blocked', clarify: 'blocked', unsupported: 'blocked',
  failed: 'failed', error: 'failed', partial: 'failed',
  skipped: 'skipped', unknown: 'unknown',
};

const $ = (selector: string): HTMLElement | null => document.querySelector<HTMLElement>(selector);
const root = document.documentElement;
const catalog = JSON.parse($('#ela-i18n')?.textContent ?? '{}') as Record<string, Record<string, string>>;
const t: Text = (key, vars = {}) => (catalog[root.lang]?.[key] ?? catalog.en?.[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
const store = {
  get: (k: string): string | null => { try { return localStorage.getItem('ela-' + k); } catch { return null; } },
  set: (k: string, v: string): void => { try { localStorage.setItem('ela-' + k, v); } catch { /* storage unavailable */ } },
};

/** The execution record, read from the interface web.ts rendered from the session's result. */
export function readRecord(): CoreRecord {
  const value = (id: string): string | undefined => { const v = $(id)?.textContent?.trim(); return v && v !== '—' ? v : undefined; };
  const state = $('#query-state');
  const outcome = state?.dataset.state ?? 'ready';
  // Once a command has finished, a stage the flow still marks "not run" was skipped by it.
  const finished = outcome !== 'ready' && outcome !== 'querying';
  const items = [...document.querySelectorAll<HTMLElement>('#flow > li')];
  const stages: CoreStage[] = items.map((li, i) => {
    const name = li.querySelector('.flow-name')?.textContent?.trim() ?? '';
    const mapped = STATUS[li.dataset.state ?? ''] ?? 'unknown';
    const status: Status = finished && mapped === 'waiting' ? 'skipped' : mapped;
    const rpc = li.querySelector('.flow-code')?.textContent?.trim();
    const read = status === 'ok' ? (i === 3 ? value('#evm-chain-id') : i === 4 ? value('#block-number') : undefined) : undefined;
    return { n: String(i + 1).padStart(2, '0'), name, short: name.split(/\s/)[0], rpc, status, value: read };
  });
  return { stages, outcome, title: state?.textContent?.trim() ?? '' };
}

/** One sentence in HTML that says what the Core draws, so the SVG labels are never the only source. */
export function caption(r: CoreRecord): string {
  const s = r.stages;
  const label = (st: CoreStage): string => t('core.s.' + st.status);
  if (s.every(st => st.status === 'waiting')) return t('core.c.idle');
  const running = s.find(st => st.status === 'running');
  if (running) return t('core.c.running', { n: running.n, name: running.name });
  if (s.every(st => st.status === 'ok')) return t('core.c.ok');
  // Same rule as draw.ts stopIndex; repeated so this chunk keeps importing types only from draw.ts.
  const stop = s.slice(0, 5).findIndex(st => st.status === 'blocked' || st.status === 'failed');
  if (stop >= 0) {
    const skipped = s.slice(0, 5).filter(st => st.status === 'skipped').map(st => st.n).join(', ');
    return [t('core.c.stopped', { n: s[stop].n, name: s[stop].name, state: label(s[stop]) }), skipped && t('core.c.skipped', { list: skipped }), t('core.c.result', { state: label(s[5]) })].filter(Boolean).join(' ');
  }
  return s.map(st => `${st.n} ${st.name}: ${label(st)}`).join(' · ') + '.';
}

let view: View = (['karot', 'optik', 'gravur'] as const).find(v => v === store.get('view')) ?? 'karot';
let renders = 0;
let token = 0;
const host = $('#core-viz')!;

async function render(): Promise<void> {
  const mine = ++token;
  host.dataset.pending = 'true';
  const { render: draw } = await VIEWS[view]();
  if (mine !== token) return;
  const record = readRecord();
  host.replaceChildren();
  draw(host, record, t);
  const text = $('#core-caption');
  if (text) text.textContent = caption(record);
  host.dataset.view = view;
  host.dataset.statuses = record.stages.map(s => s.status).join(' ');
  host.dataset.outcome = record.outcome;
  host.dataset.renders = String(++renders);
  if (!queued) delete host.dataset.pending;
}
let queued = false;
// `data-pending` marks that a redraw is due, so a reader (or a test) knows the Core is not yet current.
const schedule = (): void => { host.dataset.pending = 'true'; if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; void render(); }); } };

/** Radio group with roving tabindex and arrow keys. */
function radios(group: HTMLElement, key: string, current: () => string, choose: (value: string) => void): void {
  const buttons = [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  const sync = (): void => buttons.forEach(b => { const on = b.dataset[key] === current(); b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
  buttons.forEach((b, i) => {
    b.addEventListener('click', () => { choose(b.dataset[key]!); sync(); });
    b.addEventListener('keydown', e => {
      const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const next = buttons[(i + step + buttons.length) % buttons.length];
      choose(next.dataset[key]!);
      sync();
      next.focus();
    });
  });
  sync();
}

const theme = (): Theme => (root.dataset.theme as Theme | undefined) ?? 'blue';
radios($('#theme-switch')!, 'theme', theme, value => { root.dataset.theme = value; store.set('theme', value); });
radios($('#view-switch')!, 'view', () => view, value => { if (value !== view) { view = value as View; store.set('view', view); void render(); } });

const watch = new MutationObserver(schedule);
for (const id of ['#flow', '#query-state', '#block-number', '#evm-chain-id']) {
  const node = $(id);
  if (node) watch.observe(node, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-state'] });
}
watch.observe(root, { attributes: true, attributeFilter: ['lang'] });
void render();
