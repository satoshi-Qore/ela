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

/** Radial gradient over the shape's own box (soft cast shadows, domed faces). */
export function radial(defs: Element, id: string, stops: readonly (readonly [number, string, number?])[], fx = 0.5, fy = 0.5): void {
  const g = el('radialGradient', { id, fx, fy }, defs);
  for (const [offset, color, opacity = 1] of stops) el('stop', { offset, style: `stop-color:${color};stop-opacity:${opacity}` }, g);
}

// 7C-33 material kit, shared by the three views. One key light from the upper left; --mat-* per theme.
// After kit(s, id), each gradient fits a shape, not every part gets the same one:
//   'mh' an upright cylinder: sharp specular line left of centre, terminator, reflected light far right;
//   'mv' a lying body: polished top chamfer, then the face darkening downward, a lit lower lip;
//   'md' a flat machined face (brushed, lit diagonally);
//   'gl' sapphire glass: clear body with a coating tint and one narrow specular streak;
//   'sp' the key light behind an instrument; filters 'sh' (cast shadow) and 'ss' (contact shadow).
type Stops = readonly (readonly [number, string, number?])[];
const H = 'var(--mat-hi)', M = 'var(--mat-mid)', LO = 'var(--mat-lo)', SP = 'var(--mat-spec)', GE = 'var(--glass-edge)';
export function kit(s: Element, id: string): Element {
  const d = el('defs', {}, s);
  const lin = (n: string, stops: Stops, x2: number, y2: number): void => {
    const g = el('linearGradient', { id: id + n, x1: 0, y1: 0, x2, y2 }, d);
    for (const [offset, color, opacity = 1] of stops) el('stop', { offset, style: `stop-color:${color};stop-opacity:${opacity}` }, g);
  };
  lin('mh', [[0, LO], [0.06, M], [0.17, H], [0.215, SP], [0.26, H], [0.44, M], [0.7, LO], [0.86, LO], [0.94, M, 0.9], [1, LO]], 1, 0);
  lin('mv', [[0, SP], [0.1, H], [0.38, M], [0.8, LO], [0.92, M], [1, LO]], 0, 1);
  lin('md', [[0, H], [0.35, M], [0.42, H, 0.9], [0.5, M], [1, LO]], 1, 1);
  lin('gl', [[0, 'var(--glass-1)', 0.16], [0.2, GE, 0.06], [0.25, GE, 0.8], [0.3, GE, 0.06], [0.65, 'var(--glass-1)', 0.2], [1, 'var(--glass-2)', 0.34]], 1, 1);
  radial(d, id + 'sp', [[0, 'var(--mat-spot)', 0.22], [1, 'var(--mat-spot)', 0]], 0.4, 0.35);
  for (const [n, dy, b] of [['sh', 6, 4], ['ss', 1.6, 1]] as const) {
    const f = el('filter', { id: id + n, x: '-15%', y: '-15%', width: '135%', height: '140%' }, d);
    el('feDropShadow', { dx: dy / 2, dy, stdDeviation: b, style: 'flood-color:var(--mat-shadow);flood-opacity:var(--mat-shadow-o)' }, f);
  }
  return d;
}
/** The crisp contact outline of a machined part (strong in Precision Light, quiet in the dark themes). */
export const OUT = 'stroke:var(--mat-line);stroke-opacity:var(--mat-line-o);stroke-width:0.8';
/** Light or shadow on one arc of an ellipse only (a chamfer facing the key light, or a recess wall
 *  turned from it): `from` and `len` are in percent of the outline, which starts at 3 o'clock and
 *  runs clockwise (25 = 6 o'clock, 50 = 9, 75 = 12). */
export function rim(p: Element, cx: number, cy: number, rx: number, ry: number, color: string, w: number, from: number, len: number, o = 1): SVGElement {
  return el('ellipse', { cx, cy, rx, ry, pathLength: 100, style: `fill:none;stroke:${color};stroke-width:${w};opacity:${o};stroke-dasharray:${len} ${100 - len};stroke-dashoffset:${-from}` }, p);
}
/** Shape shorthands for the views. */
export const R = (p: Element, x: number, y: number, w: number, h: number, style: string, rx?: number): SVGElement => el('rect', { x, y, width: w, height: h, rx, style }, p);
export const E = (p: Element, cx: number, cy: number, rx: number, ry: number, style: string): SVGElement => el('ellipse', { cx, cy, rx, ry, style }, p);
export const P = (p: Element, d: string, style: string): SVGElement => el('path', { d, style }, p);
export const G = (p: Element, attrs: Readonly<Record<string, string | number | undefined>> = {}): SVGElement => el('g', attrs, p);

export function header(s: Element, title: string): void {
  txt(s, 28, 34, title, { size: 11, color: 'var(--core-ink-3)', spacing: 1.5 });
}
