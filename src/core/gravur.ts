// B — Gravür (assurance engraving). Six concentric guilloche bands, inside out, one per stage. A band
// is engraved only when its stage ran: fully on success, cut with a barrier when blocked, broken with
// a cross when failed. Bands of stages that never ran stay as guides (dotted: waiting, dashed: skipped).
//
// 7C-33 visual pass: the same six radii, the same unequal bands, the same centre and tags. Each band
// keeps its own thickness profile from the earlier drawing (its width swells and narrows m = 4 + i
// times around the ring, so no two bands are alike), now cut as one solid machined band lit from the
// upper left, with an edge highlight, a shadowed inner edge, and its own engraving (knurl, guilloche,
// lathe lines) instead of ten jittering strands. The rings sit on one machined face with a bezel; the
// centre is a domed boss with a faceted gem for a real success, the state mark otherwise.
import { c, dash, el, grid, header, RAN, stopIndex, stroke, svg, symbol, txt } from './draw.ts';
import type { CoreRecord, Render, Status, Text } from './draw.ts';

const PALETTE: Readonly<Record<string, readonly [string, string]>> = {
  ok: ['var(--s-ok)', 'var(--e-ok-2)'],
  result: ['var(--s-result)', 'var(--e-res-2)'],
  blocked: ['var(--s-blocked)', 'var(--e-blk-2)'],
  failed: ['var(--s-failed)', 'var(--e-blk-2)'],
  running: ['var(--s-running)', 'var(--e-ok-2)'],
};
const TAU = Math.PI * 2;

/** A gradient from the upper left (shared light for the whole seal), made once per kind and svg. */
function lit(s: Element, id: string, stops: readonly (readonly [number, string, number])[], radial = false): string {
  if (!s.querySelector('#' + id)) {
    const g = el(radial ? 'radialGradient' : 'linearGradient', radial ? { id, fx: 0.36, fy: 0.3 } : { id, x1: 0, y1: 0, x2: 1, y2: 1 }, s.querySelector('defs') ?? el('defs', {}, s));
    for (const [offset, color, opacity] of stops) el('stop', { offset, style: `stop-color:${color};stop-opacity:${opacity}` }, g);
  }
  return `url(#${id})`;
}

function band(s: Element, id: string, cx: number, cy: number, r0: number, i: number, kind: string, o: { end?: number; scale?: number; dashes?: string } = {}): void {
  const { end = 1, scale = 1, dashes } = o, amp = 7 * scale, m = 4 + i, [c1, c2] = PALETTE[kind];
  // The band's own width profile (inherited from the earlier strands' envelope).
  const hw = (a: number): number => amp * (0.8 + 0.25 * Math.cos(m * a));
  const pt = (a: number, r: number): string => (cx + r * Math.sin(a)).toFixed(1) + ' ' + (cy - r * Math.cos(a)).toFixed(1);
  const n = Math.max(2, Math.round(360 * end)), A = (j: number): number => (j / n) * end * TAU;
  const edge = (f: number, back = false): string => { let d = ''; for (let j = 0; j <= n; j++) { const a = A(back ? n - j : j); d += (j ? 'L' : 'M') + pt(a, r0 + f * hw(a)); } return d; };
  const full = end >= 1;
  const shape = full ? edge(1) + 'Z' + edge(-1, true) + 'Z' : edge(1) + edge(-1, true).replace('M', 'L') + 'Z';
  const dsh = dashes ? 'stroke-dasharray:' + dashes : '';
  el('path', { d: shape, 'fill-rule': 'evenodd', style: `fill:${lit(s, id + kind, [[0, c1, 0.5], [0.5, c2, 0.24], [1, c2, 0.08]])};stroke:none` }, s);
  // Engraving: a different cut per ring.
  let d = '';
  const strands = (count: number, k: number): void => { for (let q = 0; q < count; q++) for (let j = 0; j <= n * 2; j++) { const a = (j / (n * 2)) * end * TAU; d += (j ? 'L' : 'M') + pt(a, r0 + 0.72 * hw(a) * Math.sin(k * a + (q * TAU) / count)); } };
  const lathe = (fs: readonly number[]): void => { for (const f of fs) d += edge(f); };
  const knurl = (slant: number): void => { for (let j = 0; j < 120 * end; j++) { const a = (j / 120) * TAU; d += 'M' + pt(a, r0 - 0.9 * hw(a)) + 'L' + pt(a + slant, r0 + 0.9 * hw(a)); } };
  [() => knurl(0), () => strands(2, 40), () => lathe([-0.5, 0, 0.5]), () => strands(3, 52), () => knurl(0.028), () => { strands(2, 64); lathe([0]); }][i]();
  el('path', { d, style: `fill:none;stroke:${c1};stroke-width:${0.5 * Math.max(scale, 0.8)};opacity:0.62;${dsh}` }, s);
  // Machined edges: crisp outer edge, shadowed inner edge, and a highlight where the light falls.
  el('path', { d: edge(1), style: `fill:none;stroke:${c1};stroke-width:0.8;opacity:0.9;${dsh}` }, s);
  el('path', { d: edge(-1), style: `fill:none;stroke:var(--shade-edge);stroke-width:0.9;opacity:0.5;${dsh}` }, s);
  if (full) el('circle', { cx, cy, r: r0 + amp * 0.8, pathLength: 100, style: 'fill:none;stroke:var(--shade-hi);stroke-width:0.9;opacity:0.45;stroke-dasharray:18 82;stroke-dashoffset:-52' }, s);
}
function grooves(s: Element, cx: number, cy: number, r0: number, scale: number): void {
  for (const r of [r0 - 10.5 * scale, r0 + 10.5 * scale]) el('circle', { cx, cy, r, style: 'fill:none;stroke:var(--core-line);stroke-width:0.7' }, s);
}
function guide(s: Element, cx: number, cy: number, r0: number, st: Status): void {
  el('circle', { cx, cy, r: r0, style: `fill:none;${stroke(st, 0.8)}` }, s);
}
function cut(s: Element, cx: number, cy: number, r0: number, end: number, st: Status, scale: number): void {
  const a = end * TAU, p = (r: number): [number, number] => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const [x1, y1] = p(r0 - 15 * scale), [x2, y2] = p(r0 + 15 * scale);
  if (st === 'blocked') el('line', { x1, y1, x2, y2, style: `stroke:${c(st)};stroke-width:${3.2 * scale};stroke-linecap:square` }, s);
  const [mx, my] = p(r0 + 24 * scale);
  symbol(s, mx, my, st, 7 * scale);
  el('circle', { cx, cy, r: r0, style: `fill:none;${stroke('skipped', 0.7)};opacity:0.7` }, s);
}
function tag(s: Element, x: number, y: number, n: string, st: Status, text: boolean): void {
  const d = dash(st);
  el('rect', { x: x - 13, y: y - 9, width: 26, height: 18, rx: 3, style: `fill:var(--core-well);stroke:${c(st)};stroke-width:${st === 'blocked' ? 1.6 : 0.8};${d ? 'stroke-dasharray:' + d : ''}` }, s);
  if (text) txt(s, x, y + 4, n, { size: 11, color: c(st), anchor: 'middle' });
  else el('circle', { cx: x, cy: y, r: 2, style: `fill:${c(st)}` }, s);
}
/** The centre mark: a faceted gem, lit from the upper left, only for a real success; the state mark otherwise. */
function emblem(s: Element, x: number, y: number, st: Status, r: number): void {
  if (st !== 'ok') { symbol(s, x, y, st, r); return; }
  const col = 'var(--s-result)', v = [[0, -r], [r, 0], [0, r], [-r, 0]];
  [0.72, 0.3, 0.5, 0.95].forEach((o, k) => { const [p, q] = [v[k], v[(k + 1) % 4]]; el('path', { d: `M${x} ${y} L${x + p[0]} ${y + p[1]} L${x + q[0]} ${y + q[1]} Z`, style: `fill:${col};opacity:${o}` }, s); });
  el('path', { d: `M${x} ${y - r} L${x + r} ${y} L${x} ${y + r} L${x - r} ${y} Z`, style: `fill:none;stroke:${col};stroke-width:1` }, s);
  el('path', { d: `M${x - r * 0.5} ${y - r * 0.5} L${x} ${y}`, style: 'stroke:var(--core-well);stroke-width:0.6;opacity:0.5' }, s);
}

function seal(s: Element, id: string, r: CoreRecord, cx: number, cy: number, radii: readonly number[], scale: number, text: boolean, outer?: number): number {
  const face = radii[5] + 13 * scale;
  // One machined face under all six rings, with a bezel lit from the upper left.
  el('circle', { cx, cy, r: face, style: `fill:${lit(s, id + 'face', [[0, 'var(--core-surface)', 0.55], [1, 'var(--core-well)', 0.1]], true)};stroke:var(--metal-1);stroke-width:1.2;opacity:0.9` }, s);
  el('circle', { cx, cy, r: face - 3.5, style: 'fill:none;stroke:var(--core-line-2);stroke-width:0.6' }, s);
  el('circle', { cx, cy, r: face - 0.6, pathLength: 100, style: 'fill:none;stroke:var(--shade-hi);stroke-width:1;opacity:0.5;stroke-dasharray:20 80;stroke-dashoffset:-51' }, s);
  if (outer) for (let i = 0; i < 180; i++) {
    const a = (i / 180) * TAU, long = i % 15 === 0, r2 = outer + (long ? 7 : 3.5);
    el('line', { x1: cx + outer * Math.sin(a), y1: cy - outer * Math.cos(a), x2: cx + r2 * Math.sin(a), y2: cy - r2 * Math.cos(a), style: `stroke:var(${long ? '--core-ink-4' : '--core-line-2'});stroke-width:0.8` }, s);
  }
  r.stages.forEach((st, i) => {
    const r0 = radii[i];
    // Engraved bands sit in a cut groove; a stage that never ran keeps only its guide line.
    if (RAN.has(st.status) && (i < 5 || st.status === 'ok')) grooves(s, cx, cy, r0, scale);
    if (st.status === 'ok') band(s, id, cx, cy, r0, i, i === 5 ? 'result' : 'ok', { scale });
    else if (st.status === 'running') band(s, id, cx, cy, r0, i, 'running', { scale, end: 0.35, dashes: '3 2' });
    else if ((st.status === 'blocked' || st.status === 'failed') && i < 5) {
      band(s, id, cx, cy, r0, i, st.status, { scale, end: 0.58, dashes: st.status === 'failed' ? '6 2 1 2' : undefined });
      cut(s, cx, cy, r0, 0.58, st.status, scale);
    } else if (i === 5 && (st.status === 'blocked' || st.status === 'failed')) {
      guide(s, cx, cy, r0, 'skipped');
      el('circle', { cx, cy, r: r0, style: `fill:none;${stroke(st.status, 1.1 * scale)}` }, s);
    } else guide(s, cx, cy, r0, st.status);
  });
  const disc = radii[0] - 18 * scale;
  el('circle', { cx, cy, r: disc, style: `fill:${lit(s, id + 'boss', [[0, 'var(--core-surface)', 1], [0.75, 'var(--core-well)', 1], [1, 'var(--core-well)', 1]], true)};stroke:var(--metal-1);stroke-width:1` }, s);
  el('circle', { cx, cy, r: disc - 4, style: 'fill:none;stroke:var(--core-line);stroke-width:0.6' }, s);
  el('circle', { cx, cy, r: disc - 0.8, pathLength: 100, style: 'fill:none;stroke:var(--shade-hi);stroke-width:0.8;opacity:0.45;stroke-dasharray:18 82;stroke-dashoffset:-52' }, s);
  const a = -Math.PI / 4;
  radii.forEach((rr, i) => tag(s, cx + rr * Math.cos(a), cy + rr * Math.sin(a), r.stages[i].n, r.stages[i].status, text));
  return disc;
}
function sub(r: CoreRecord, t: Text): string {
  const stop = stopIndex(r);
  return stop >= 0 ? t('core.g.stopped', { n: r.stages[stop].n }) : t('core.g.count', { n: r.stages.filter(st => RAN.has(st.status)).length });
}

export const render: Render = (host, r, t) => {
  const s = svg(host, 800, 540, false, t('view.gravur') + ' · ' + r.title);
  grid(s, 800, 540, 'gg'); header(s, t('core.g.title'));
  const cx = 276, cy = 286, result = r.stages[5].status;
  seal(s, 'gd', r, cx, cy, [74, 104, 134, 164, 194, 224], 1, true, 240);
  emblem(s, cx, cy - 24, result, 10);
  txt(s, cx, cy + 9, r.title, { size: 18, color: result === 'waiting' ? 'var(--core-ink-3)' : c(result), font: 'text', anchor: 'middle' });
  txt(s, cx, cy + 27, sub(r, t), { size: 11, color: 'var(--core-ink-3)', anchor: 'middle' });
  txt(s, 542, 100, t('core.g.cols'), { size: 11, color: 'var(--core-ink-3)', spacing: 1 });
  r.stages.forEach((st, i) => {
    const y = 140 + i * 60;
    el('line', { x1: 528, y1: y - 26, x2: 776, y2: y - 26, style: 'stroke:var(--core-line);stroke-width:1' }, s);
    tag(s, 556, y, st.n, st.status, true);
    txt(s, 584, y + 1, st.name, { size: 15, color: RAN.has(st.status) ? 'var(--core-ink)' : 'var(--core-ink-3)', font: 'text' });
    symbol(s, 590, y + 18, st.status, 5);
    txt(s, 602, y + 22, t('core.s.' + st.status) + (st.rpc ? ' · ' + st.rpc : ''), { size: 12, color: c(st.status) });
  });

  const m = svg(host, 300, 300, true, '');
  grid(m, 300, 300, 'ggm', 20);
  seal(m, 'gm', r, 150, 150, [46, 64, 82, 100, 118, 136], 0.58, false);
  emblem(m, 150, 150, result, 12);
};
