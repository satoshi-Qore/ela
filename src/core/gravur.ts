// B — Gravür (assurance engraving). Six concentric guilloche bands, inside out, one per stage. A band
// is engraved only when its stage ran: fully on success, cut with a barrier when blocked, broken with
// a cross when failed. Bands of stages that never ran stay as guides (dotted: waiting, dashed: skipped).
import { c, dash, el, grid, header, RAN, stopIndex, stroke, svg, symbol, txt } from './draw.ts';
import type { CoreRecord, Render, Status, Text } from './draw.ts';

const PALETTE: Readonly<Record<string, readonly [string, string]>> = {
  ok: ['var(--s-ok)', 'var(--e-ok-2)'],
  result: ['var(--s-result)', 'var(--e-res-2)'],
  blocked: ['var(--s-blocked)', 'var(--e-blk-2)'],
  failed: ['var(--s-failed)', 'var(--e-blk-2)'],
  running: ['var(--s-running)', 'var(--e-ok-2)'],
};

function band(s: Element, cx: number, cy: number, r0: number, i: number, colors: readonly [string, string], o: { end?: number; scale?: number; dashes?: string } = {}): void {
  const { end = 1, scale = 1, dashes } = o, amp = 7 * scale, k = 46 + i * 12, m = 4 + i, strands = 10;
  for (let n = 0; n < strands; n++) {
    const steps = Math.round(2400 * end), ph = (n * Math.PI * 2) / strands;
    let d = '';
    for (let j = 0; j <= steps; j++) {
      const a = (j / 2400) * Math.PI * 2;
      const r = r0 + amp * Math.sin(k * a + ph) * (0.62 + 0.38 * Math.cos(m * a + ph / 2)) + 1.2 * scale * Math.sin(3 * k * a - ph);
      d += (j ? 'L' : 'M') + (cx + r * Math.sin(a)).toFixed(1) + ' ' + (cy - r * Math.cos(a)).toFixed(1);
    }
    el('path', { d, style: `fill:none;stroke:${colors[n % 2]};stroke-width:0.34;opacity:${n % 2 ? 0.6 : 0.95};${dashes ? 'stroke-dasharray:' + dashes : ''}` }, s);
  }
  for (const r of [r0 - amp - 3.5 * scale, r0 + amp + 3.5 * scale]) {
    const circ = 2 * Math.PI * r;
    el('circle', { cx, cy, r, transform: `rotate(-90 ${cx} ${cy})`, style: `fill:none;stroke:${colors[0]};stroke-width:0.4;opacity:0.45;${end < 1 ? `stroke-dasharray:${(circ * end).toFixed(1)} ${circ.toFixed(1)}` : ''}` }, s);
  }
}
function guide(s: Element, cx: number, cy: number, r0: number, st: Status, scale: number): void {
  const amp = 7 * scale;
  for (const r of [r0 - amp - 3.5 * scale, r0 + amp + 3.5 * scale]) el('circle', { cx, cy, r, style: 'fill:none;stroke:var(--core-line);stroke-width:0.7' }, s);
  el('circle', { cx, cy, r: r0, style: `fill:none;${stroke(st, 0.8)}` }, s);
}
function cut(s: Element, cx: number, cy: number, r0: number, end: number, st: Status, scale: number): void {
  const a = end * Math.PI * 2, p = (r: number): [number, number] => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
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

function seal(s: Element, r: CoreRecord, cx: number, cy: number, radii: readonly number[], scale: number, text: boolean, outer?: number): number {
  if (outer) for (let i = 0; i < 180; i++) {
    const a = (i / 180) * Math.PI * 2, long = i % 15 === 0, r2 = outer + (long ? 9 : 4);
    el('line', { x1: cx + outer * Math.sin(a), y1: cy - outer * Math.cos(a), x2: cx + r2 * Math.sin(a), y2: cy - r2 * Math.cos(a), style: `stroke:var(${long ? '--core-ink-4' : '--core-line-2'});stroke-width:0.8` }, s);
  }
  r.stages.forEach((st, i) => {
    const r0 = radii[i];
    if (st.status === 'ok') band(s, cx, cy, r0, i, PALETTE[i === 5 ? 'result' : 'ok'], { scale });
    else if (st.status === 'running') band(s, cx, cy, r0, i, PALETTE.running, { scale, end: 0.35, dashes: '3 2' });
    else if ((st.status === 'blocked' || st.status === 'failed') && i < 5) {
      band(s, cx, cy, r0, i, PALETTE[st.status], { scale, end: 0.58, dashes: st.status === 'failed' ? '6 2 1 2' : undefined });
      cut(s, cx, cy, r0, 0.58, st.status, scale);
    } else if (i === 5 && (st.status === 'blocked' || st.status === 'failed')) {
      guide(s, cx, cy, r0, 'skipped', scale);
      el('circle', { cx, cy, r: r0, style: `fill:none;${stroke(st.status, 1.1 * scale)}` }, s);
    } else guide(s, cx, cy, r0, st.status, scale);
  });
  const disc = radii[0] - 18 * scale;
  el('circle', { cx, cy, r: disc, style: 'fill:var(--core-well);stroke:var(--core-line-2);stroke-width:0.8' }, s);
  el('circle', { cx, cy, r: disc - 4, style: 'fill:none;stroke:var(--core-line);stroke-width:0.6' }, s);
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
  seal(s, r, cx, cy, [74, 104, 134, 164, 194, 224], 1, true, 236);
  txt(s, cx, cy - 2, r.title, { size: 18, color: result === 'waiting' ? 'var(--core-ink-3)' : c(result), font: 'text', anchor: 'middle' });
  txt(s, cx, cy + 18, sub(r, t), { size: 11, color: 'var(--core-ink-3)', anchor: 'middle' });
  txt(s, 556, 100, t('core.g.cols'), { size: 11, color: 'var(--core-ink-3)', spacing: 1 });
  r.stages.forEach((st, i) => {
    const y = 140 + i * 60;
    el('line', { x1: 542, y1: y - 26, x2: 776, y2: y - 26, style: 'stroke:var(--core-line);stroke-width:1' }, s);
    tag(s, 570, y, st.n, st.status, true);
    txt(s, 598, y + 1, st.name, { size: 15, color: RAN.has(st.status) ? 'var(--core-ink)' : 'var(--core-ink-3)', font: 'text' });
    symbol(s, 604, y + 18, st.status, 5);
    txt(s, 616, y + 22, t('core.s.' + st.status) + (st.rpc ? ' · ' + st.rpc : ''), { size: 12, color: c(st.status) });
  });

  const m = svg(host, 300, 300, true, '');
  grid(m, 300, 300, 'ggm', 20);
  seal(m, r, 150, 150, [46, 64, 82, 100, 118, 136], 0.58, false);
  symbol(m, 150, 150, result, 12);
};
