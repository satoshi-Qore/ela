// Shared SVG vocabulary of the three ELA Core views. Colours come only from theme CSS variables
// (--s-*, --e-*, --beam-*, --layer-*, ...), so a theme switch restyles without re-rendering; geometry
// comes only from the execution record.

export type Status = 'waiting' | 'running' | 'ok' | 'blocked' | 'failed' | 'skipped' | 'unknown';

export interface CoreStage {
  readonly n: string;
  /** Localized stage name and its first word, as the interface shows them. */
  readonly name: string;
  readonly short: string;
  readonly rpc?: string;
  readonly status: Status;
  /** A real value read by this stage (chain ID, block height), only when the stage succeeded. */
  readonly value?: string;
}

export interface CoreRecord {
  readonly stages: readonly CoreStage[];
  /** The query state the interface shows (ready, querying, success, refused, ...). */
  readonly outcome: string;
  readonly title: string;
}

export type Text = (key: string, vars?: Readonly<Record<string, string | number>>) => string;
export type Render = (host: HTMLElement, record: CoreRecord, t: Text) => void;

export const RAN: ReadonlySet<Status> = new Set(['ok', 'blocked', 'failed', 'running']);
/** Index (01–05) of the stage where execution really stopped, or -1. */
export const stopIndex = (r: CoreRecord): number => r.stages.slice(0, 5).findIndex(s => s.status === 'blocked' || s.status === 'failed');
/** Index (01–05) of the last stage that really ran, or -1. */
export const reachIndex = (r: CoreRecord): number => r.stages.slice(0, 5).reduce((last, s, i) => (RAN.has(s.status) ? i : last), -1);

const NS = 'http://www.w3.org/2000/svg';
type Attrs = Readonly<Record<string, string | number | undefined>>;

export function el(tag: string, attrs: Attrs = {}, parent?: Element): SVGElement {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) node.setAttribute(k, String(v));
  parent?.append(node);
  return node;
}

export function txt(parent: Element, x: number, y: number, content: string, o: { size?: number; color?: string; font?: 'mono' | 'text'; anchor?: string; spacing?: number } = {}): SVGElement {
  const t = el('text', { x, y, 'text-anchor': o.anchor ?? 'start', 'font-size': o.size ?? 12, 'letter-spacing': o.spacing, style: `fill:${o.color ?? 'var(--core-ink-2)'};font-family:${o.font === 'text' ? 'inherit' : 'var(--mono)'}` }, parent);
  t.textContent = content;
  return t;
}

/** Desktop SVG (with labels) and mobile SVG (geometry only; the HTML stage list carries the text). */
export function svg(host: HTMLElement, w: number, h: number, mobile: boolean, label: string): SVGElement {
  const s = el('svg', { viewBox: `0 0 ${w} ${h}`, class: mobile ? 'core-m' : 'core-d', role: 'img', 'aria-label': label });
  if (mobile) s.setAttribute('aria-hidden', 'true');
  host.append(s);
  return s;
}

export const c = (s: Status): string => `var(--s-${s})`;
const DASH: Partial<Record<Status, string>> = { waiting: '1.5 4', running: '6 4', failed: '8 3 1.5 3', skipped: '4 4', unknown: '1 7' };
export const dash = (s: Status): string | undefined => DASH[s];
export function stroke(s: Status, base = 1): string {
  const d = DASH[s];
  return `stroke:${c(s)};stroke-width:${s === 'blocked' ? base * 1.9 : s === 'ok' ? base * 1.15 : base};${d ? `stroke-dasharray:${d};` : ''}`;
}

/** The state symbol: the diamond of the ELA mark with a different inner mark per state. */
export function symbol(parent: Element, x: number, y: number, s: Status, r = 6): SVGElement {
  const g = el('g', { transform: `translate(${x} ${y})`, 'data-status': s }, parent);
  const col = c(s);
  const dia = `M0 ${-r} L${r} 0 L0 ${r} L${-r} 0 Z`;
  const outline = (extra = ''): SVGElement => el('path', { d: dia, style: `fill:var(--core-well);stroke:${col};stroke-width:1.3;${extra}` }, g);
  const line = (d: string, w = 1.5): SVGElement => el('path', { d, style: `fill:none;stroke:${col};stroke-width:${w};stroke-linecap:round;stroke-linejoin:round` }, g);
  const k = r * 0.45;
  if (s === 'ok') {
    el('path', { d: dia, style: `fill:${col};stroke:${col};stroke-width:1.3` }, g);
    el('path', { d: `M${-k} 0 L${-k * 0.2} ${k * 0.8} L${k} ${-k * 0.7}`, style: 'fill:none;stroke:var(--core-well);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round' }, g);
  } else if (s === 'blocked') {
    outline('stroke-width:2');
    line(`M${-r * 0.62} 0 L${r * 0.62} 0`, 2.4);
  } else if (s === 'failed') {
    outline();
    line(`M${-k} ${-k} L${k} ${k} M${k} ${-k} L${-k} ${k}`, 1.4);
  } else if (s === 'skipped') {
    outline('stroke-dasharray:2.2 2');
    line(`M${-k * 0.8} 0 L${k * 0.8} 0`, 1.2);
  } else if (s === 'running') {
    outline();
    el('path', { d: `M0 ${-r} L0 ${r} L${-r} 0 Z`, style: `fill:${col}` }, g);
  } else if (s === 'unknown') {
    outline('stroke-dasharray:1.2 2.2');
    line(`M${-k * 0.55} ${-k * 0.55} Q0 ${-k * 1.25} ${k * 0.55} ${-k * 0.55} Q${k * 0.6} 0 0 ${k * 0.2}`, 1.2);
    el('circle', { cx: 0, cy: k * 0.85, r: 0.8, style: `fill:${col}` }, g);
  } else {
    outline('stroke-dasharray:1.2 2.4');
  }
  return g;
}

export function grid(s: Element, w: number, h: number, id: string, step = 24): void {
  const defs = el('defs', {}, s);
  const p = el('pattern', { id, width: step, height: step, patternUnits: 'userSpaceOnUse' }, defs);
  el('path', { d: `M ${step} 0 L 0 0 0 ${step}`, style: 'fill:none;stroke:var(--core-grid);stroke-width:1' }, p);
  el('rect', { x: 0, y: 0, width: w, height: h, style: `fill:url(#${id})` }, s);
}

export function linear(defs: Element, id: string, stops: readonly (readonly [number, string, number?])[], vertical = false): void {
  const g = el('linearGradient', { id, x1: 0, y1: 0, x2: vertical ? 0 : 1, y2: vertical ? 1 : 0 }, defs);
  for (const [offset, color, opacity = 1] of stops) el('stop', { offset, style: `stop-color:${color};stop-opacity:${opacity}` }, g);
}

export function header(s: Element, title: string): void {
  txt(s, 28, 34, title, { size: 11, color: 'var(--core-ink-3)', spacing: 1.5 });
}
