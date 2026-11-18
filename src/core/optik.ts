// A — Optik (optical bench). One signal runs along a rail through six optical stations and passes a
// station only if that stage really ran: a blocked stage closes a shutter on the beam, a failed stage
// scatters it, and the detector shows a result only when the signal really arrived.
//
// 7C-33: drawn as an optical measurement setup. A table slab carries a rail; each station is an
// optic in its own mount (aperture, filter, lens, beam-splitter cube, lens, aperture) on a post, in a
// post holder clamped to the rail. Ring mounts are seen nearly edge-on, so their depth shows. The
// source is an emitter head, the detector a sensor body with a window. A station whose stage never
// ran is a dim outline in its state's dash. Only the beam segment entering a running station moves
// (not under reduced motion). The drawing shows execution, not a light measurement.
import { c, E, el, G, grid, header, kit, OUT, P, R, rim, RAN, reachIndex, stopIndex, stroke, svg, symbol, txt } from './draw.ts';
import type { CoreRecord, CoreStage, Render } from './draw.ts';

const KIND = [0, 1, 2, 3, 2, 0]; // aperture, filter, lens, beam-splitter cube, lens, aperture

function beam(s: Element, x1: number, y1: number, x2: number, y2: number, running = false): void {
  if (x2 - x1 + y2 - y1 <= 0) return;
  el('line', { x1, y1, x2, y2, style: 'stroke:var(--beam-2);stroke-width:6;opacity:0.1' }, s);
  el('line', { x1, y1, x2, y2, class: running ? 'core-moving' : undefined, style: `stroke:var(--beam-1);stroke-width:1.4;${running ? 'stroke-dasharray:6 4;' : ''}` }, s);
}
function path(r: CoreRecord): { stop: number; running: number; through: boolean; end: number } {
  const stop = stopIndex(r), reach = reachIndex(r), running = r.stages.findIndex(st => st.status === 'running');
  const through = stop < 0 && running < 0 && reach === 4 && r.stages[5].status === 'ok';
  return { stop, running, through, end: stop >= 0 ? stop : running >= 0 ? running : through ? 6 : reach };
}
/** The lit signal from the source to `end`, with only the last segment moving when a stage runs. */
function signal(s: Element, from: number, at: readonly number[], end: number, p: ReturnType<typeof path>, fixed: number, vertical: boolean): void {
  const go = (a: number, b: number, run?: boolean): void => vertical ? beam(s, fixed, a, fixed, b, run) : beam(s, a, fixed, b, fixed, run);
  if (p.running < 0) return go(from, end);
  const split = p.running ? at[p.running - 1] : from;
  go(from, split);
  go(split, end, true);
}
/** One station in its own frame: the optic at the origin on the beam, its post running down +y to the rail at L. */
function station(s: Element, id: string, x: number, y: number, rot: string, st: CoreStage, i: number, L: number): void {
  const u = (n: string): string => `url(#${id}${n})`, quiet = !RAN.has(st.status), k = KIND[i], top = k === 3 ? 18 : 56;
  const g = G(s, { transform: `translate(${x} ${y})${rot}`, filter: quiet ? undefined : u('ss'), opacity: quiet ? 0.45 : undefined });
  R(g, -3, top, 6, L - 44 - top, `fill:${u('mh')}`);
  R(g, -7, L - 46, 14, 38, `fill:${u('mh')};${OUT}`, 2);
  R(g, -9, L - 49, 18, 5, `fill:${u('mv')};${OUT}`, 1.5);
  R(g, -22, L - 9, 44, 10, `fill:${u('mv')};${OUT}`, 2);
  P(g, `M-20 ${L - 8.2} h40`, 'stroke:var(--mat-spec);stroke-width:0.7;opacity:0.8');
  for (const dx of [-15, 15]) E(g, dx, L - 4, 1.6, 1.6, 'fill:var(--mat-lo)');
  if (k === 3) {
    R(g, -12, -18, 32, 36, 'fill:var(--mat-lo)', 3);
    R(g, -16, -18, 32, 36, `fill:${u('mv')};${OUT}`, 3);
    P(g, 'M-13 -17.2 h26', 'stroke:var(--mat-spec);stroke-width:0.8;opacity:0.85');
    R(g, -11, -13, 22, 26, 'fill:var(--mat-line);opacity:0.75', 1.5);
    R(g, -10, -12, 20, 24, 'fill:var(--core-well)');
    R(g, -10, -12, 20, 24, `fill:${u('gl')};stroke:var(--glass-edge);stroke-width:0.6;stroke-opacity:0.6`);
    P(g, 'M-10 12 L10 -12', 'stroke:var(--glass-edge);stroke-width:0.8;opacity:0.7');
    R(g, -19, -21, 38, 42, `fill:none;${stroke(st.status, 1)}`, 5);
  } else {
    E(g, 5, 0, 12, 58, 'fill:var(--mat-lo)');
    // Ring mount: a turned rim (chamfer catching the key light), a dark seat, then the optic.
    E(g, 0, 0, 12, 58, `fill:${u('mh')};${OUT}`);
    rim(g, 0, 0, 11.2, 57.2, 'var(--mat-spec)', 1, 54, 16, 0.85);
    E(g, 0, 0, 8.6, 48.5, 'fill:var(--mat-line);opacity:0.8');
    E(g, 0, 0, 7.5, 47, k ? 'fill:var(--core-well)' : `fill:${u('md')}`);
    if (k) {
      // Glass: coating tint, one narrow specular streak, and its edge thickness as a second rim.
      E(g, 0, 0, 7.5, 47, `fill:${k === 1 ? 'var(--glass-2);fill-opacity:0.42' : u('gl')}`);
      E(g, 1.4, 0, 6.6, 46, 'fill:none;stroke:var(--glass-1);stroke-width:0.8;opacity:0.45');
      E(g, 0, 0, 7.5, 47, 'fill:none;stroke:var(--glass-edge);stroke-width:0.6;opacity:0.6');
    } else E(g, 0, 0, 2.6, 10, `fill:${u('gl')};stroke:var(--mat-line);stroke-width:0.8`);
    if (k === 2) P(g, 'M-3.2 -36 Q-5.6 -6 -3.2 24', 'fill:none;stroke:var(--glass-edge);stroke-width:0.9;opacity:0.85');
    for (const dy of [-52, 52]) E(g, 0, dy, 1.4, 1.4, 'fill:var(--mat-lo)');
    E(g, 0, 0, 15, 61, `fill:none;${stroke(st.status, 1)}`);
  }
  if (st.status === 'blocked' && i < 5) {
    // Shutter: a machined blade swung across the optic on its pivot screw; the red edge is the state.
    R(g, -9, -20, 18, 40, `fill:${u('md')};stroke:${c('blocked')};stroke-width:2.2`, 2);
    P(g, 'M-7 -17.5 h14', 'stroke:var(--mat-spec);stroke-width:0.8;opacity:0.8');
    E(g, 0, -20, 2.6, 2.6, `fill:${u('mv')};${OUT}`);
  }
}
/** Measurement point on the axis: a reticle where the signal passed, scatter where it failed. */
function mark(s: Element, x: number, y: number, st: CoreStage): void {
  if (st.status === 'failed') {
    for (let k = 0; k < 5; k++) {
      const a = -0.9 + k * 0.45;
      el('line', { x1: x + 6 * Math.cos(a), y1: y + 6 * Math.sin(a), x2: x + 20 * Math.cos(a), y2: y + 20 * Math.sin(a), style: `stroke:${c('failed')};stroke-width:0.9;stroke-dasharray:3 2` }, s);
    }
  } else if (st.status === 'ok' || st.status === 'running') {
    el('circle', { cx: x, cy: y, r: 4.5, style: `fill:none;stroke:var(--beam-1);stroke-width:0.8;opacity:0.8;${st.status === 'running' ? 'stroke-dasharray:2 2' : ''}` }, s);
    el('circle', { cx: x, cy: y, r: 1.8, style: 'fill:var(--beam-1)' }, s);
  }
}

export const render: Render = (host, r, t) => {
  // Desktop: horizontal bench.
  {
    const id = 'od', u = (n: string): string => `url(#${id}${n})`, s = svg(host, 800, 540, false, t('view.optik') + ' · ' + r.title);
    grid(s, 800, 540, 'og'); kit(s, id); header(s, t('core.o.title'));
    const by = 236, rail = 384, xs = [176, 274, 372, 470, 568, 666], p = path(r);
    R(s, 0, 40, 800, 440, `fill:${u('sp')}`);
    // Table slab and rail: each with a lit top face, a darker side face, and a crisp contact line.
    R(G(s, { filter: u('sh') }), 24, 396, 752, 20, `fill:${u('mv')};${OUT}`, 3);
    el('line', { x1: 27, y1: 397, x2: 773, y2: 397, style: 'stroke:var(--mat-spec);stroke-width:0.8;opacity:0.8' }, s);
    R(s, 36, rail, 728, 12, `fill:${u('mv')};${OUT}`, 2);
    R(s, 37, rail + 0.5, 726, 3, 'fill:var(--mat-hi);opacity:0.55', 1);
    el('line', { x1: 40, y1: rail + 6.5, x2: 760, y2: rail + 6.5, style: 'stroke:var(--mat-line);stroke-opacity:var(--mat-line-o);stroke-width:1.4' }, s);
    el('line', { x1: 40, y1: rail + 7.8, x2: 760, y2: rail + 7.8, style: 'stroke:var(--mat-spec);stroke-width:0.6;opacity:0.4' }, s);
    for (let x = 36, i = 0; x <= 764; x += 10, i++) {
      const major = i % 10 === 0;
      el('line', { x1: x, y1: 424, x2: x, y2: major ? 436 : 429, style: `stroke:var(${major ? '--core-ink-4' : '--core-line-2'});stroke-width:0.8` }, s);
      if (major) txt(s, x, 450, String(i * 10), { size: 11, color: 'var(--core-ink-4)', anchor: 'middle' });
    }
    el('line', { x1: 60, y1: by, x2: 750, y2: by, style: 'stroke:var(--core-ink-4);stroke-width:0.6;opacity:0.55' }, s);
    // Source: an emitter head on its own post.
    const src = G(s, { filter: u('ss') });
    R(src, 71, 252, 6, 90, `fill:${u('mh')}`);
    R(src, 67, 338, 14, 46, `fill:${u('mh')};${OUT}`, 2);
    R(src, 40, by - 18, 64, 36, `fill:${u('mv')};${OUT}`, 5);
    R(src, 100, by - 21, 9, 42, `fill:${u('mv')};${OUT}`, 2);
    el('path', { d: `M44 ${by - 16.6} h56 M102 ${by - 19.6} h5`, style: 'stroke:var(--mat-spec);stroke-width:0.8;opacity:0.85' }, src);
    el('path', { d: `M52 ${by - 17} v34 M59 ${by - 17} v34 M66 ${by - 17} v34`, style: 'stroke:var(--mat-lo);stroke-width:1;opacity:0.6' }, src);
    E(s, 110, by, 2.5, 6, 'fill:var(--core-well);stroke:var(--beam-2);stroke-width:1');
    txt(s, 72, 204, t('core.o.cmd'), { size: 11, color: 'var(--core-ink-3)', anchor: 'middle', spacing: 1 });
    xs.forEach((x, i) => {
      const st = r.stages[i], quiet = !RAN.has(st.status);
      station(s, id, x, by, '', st, i, rail - by);
      el('path', { d: `M${x - 26} ${by} h5 M${x + 21} ${by} h5`, style: 'stroke:var(--core-ink-4);stroke-width:0.8' }, s);
      txt(s, x, 160, st.n, { size: 12, color: c(st.status), anchor: 'middle' });
      txt(s, x, 482, st.short, { size: 15, color: quiet ? 'var(--core-ink-3)' : 'var(--core-ink)', font: 'text', anchor: 'middle' });
      const label = t('core.s.' + st.status), tw = label.length * 7.2;
      symbol(s, x - tw / 2 - 4, 501, st.status, 5);
      txt(s, x - tw / 2 + 6, 505, label, { size: 12, color: c(st.status) });
    });
    const endX = p.end === 6 ? 712 : p.end >= 0 ? xs[p.end] - 2 : 112;
    if (endX > 112) signal(s, 113, xs, endX, p, by, false);
    xs.forEach((x, i) => { if (i <= p.end && RAN.has(r.stages[i].status)) mark(s, x, by, r.stages[i]); });
    if (p.stop >= 0) {
      const x = xs[p.stop], st = r.stages[p.stop];
      // The callout opens toward the free side, so it is never cut at the right edge.
      const k = x > 420 ? -1 : 1;
      el('polyline', { points: `${x},146 ${x},72 ${x + 12 * k},72`, style: `fill:none;stroke:${c(st.status)};stroke-width:0.8` }, s);
      txt(s, x + 18 * k, 76, t(st.status === 'blocked' ? 'core.o.stopped' : 'core.o.scattered', { stage: st.name }), { size: 12, color: c(st.status), anchor: k < 0 ? 'end' : 'start' });
    }
    // Detector: a sensor body with a window on its own post.
    const res = r.stages[5], det = G(s, { filter: u('ss') });
    R(det, 737, 296, 6, 50, `fill:${u('mh')}`);
    R(det, 733, 338, 14, 46, `fill:${u('mh')};${OUT}`, 2);
    R(det, 712, by - 30, 52, 60, `fill:${u('mv')};${OUT}`, 6);
    el('line', { x1: 717, y1: by - 28.8, x2: 759, y2: by - 28.8, style: 'stroke:var(--mat-spec);stroke-width:0.8;opacity:0.85' }, s);
    R(s, 722, by - 17, 34, 34, 'fill:var(--mat-line);opacity:0.75', 4);
    R(s, 724, by - 15, 30, 30, 'fill:var(--core-well)', 3);
    R(s, 724, by - 15, 30, 30, `fill:${u('gl')};opacity:0.6;stroke:var(--glass-edge);stroke-width:0.6;stroke-opacity:0.5`, 3);
    E(s, 712, by, 3, 9, 'fill:var(--core-well);stroke:var(--mat-hi);stroke-width:0.8');
    if (p.through) symbol(s, 739, by, res.status, 9);
    txt(s, 738, 196, t('core.o.det'), { size: 11, color: 'var(--core-ink-3)', anchor: 'middle', spacing: 1 });
    txt(s, 738, 286, t(p.through ? 'core.o.arrived' : 'core.o.none'), { size: 11, color: p.through ? c(res.status) : 'var(--core-ink-4)', anchor: 'middle' });
  }
  // Mobile: the same bench stood upright (source at the top, rail on the right), geometry only.
  {
    const id = 'om', u = (n: string): string => `url(#${id}${n})`, s = svg(host, 300, 600, true, '');
    grid(s, 300, 600, 'ogm', 20); kit(s, id);
    const bx = 128, rail = 256, ys = [120, 196, 272, 348, 424, 500], p = path(r);
    R(s, 0, 0, 300, 600, `fill:${u('sp')}`);
    R(G(s, { filter: u('sh') }), rail, 16, 12, 576, `fill:${u('mh')};stroke:var(--mat-lo);stroke-width:0.6`, 2);
    for (let y = 20, i = 0; y <= 584; y += 10, i++) el('line', { x1: 274, y1: y, x2: i % 10 ? 280 : 286, y2: y, style: `stroke:var(${i % 10 ? '--core-line-2' : '--core-ink-4'});stroke-width:0.8` }, s);
    el('line', { x1: bx, y1: 40, x2: bx, y2: 560, style: 'stroke:var(--core-ink-4);stroke-width:0.6;opacity:0.55' }, s);
    const src = G(s, { filter: u('ss') });
    R(src, bx + 18, 33, rail - bx - 18, 6, `fill:${u('mv')}`);
    R(src, bx - 18, 14, 36, 50, `fill:${u('mh')};stroke:var(--mat-lo);stroke-width:0.6`, 5);
    R(src, bx - 21, 60, 42, 9, `fill:${u('mh')};stroke:var(--mat-lo);stroke-width:0.6`, 2);
    E(s, bx, 70, 6, 2.5, 'fill:var(--core-well);stroke:var(--beam-2);stroke-width:1');
    ys.forEach((y, i) => {
      station(s, id, bx, y, ' rotate(-90)', r.stages[i], i, rail - bx);
      symbol(s, 36, y, r.stages[i].status, 7);
    });
    const endY = p.end === 6 ? 548 : p.end >= 0 ? ys[p.end] - 2 : 72;
    if (endY > 72) signal(s, 73, ys, endY, p, bx, true);
    ys.forEach((y, i) => { if (i <= p.end && RAN.has(r.stages[i].status)) mark(s, bx, y, r.stages[i]); });
    const det = G(s, { filter: u('ss') });
    R(det, bx + 30, 563, rail - bx - 30, 6, `fill:${u('mv')}`);
    R(det, bx - 30, 548, 60, 44, `fill:${u('mv')};stroke:var(--mat-lo);stroke-width:0.6`, 6);
    R(s, bx - 14, 556, 28, 28, 'fill:var(--core-well);stroke:var(--mat-lo);stroke-width:1', 3);
    if (p.through) symbol(s, bx, 570, r.stages[5].status, 7);
  }
};
