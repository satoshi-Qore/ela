// A — Optik (optical bench). One signal runs along a rail through six optical plates and passes a
// plate only if that stage really ran: a blocked stage closes a shutter on the beam, a failed stage
// scatters it, and the detector shows a result only when the signal really arrived.
//
// 7C-33 visual pass: the same bench, axis, stations, and direction, drawn as a laboratory instrument.
// The optical axis is always visible as a hairline with end stops; each station is a clamped mount
// on a carriage with metal-capped glass, alignment ticks on the axis, and an index mark on the rail
// in its state colour. The signal is drawn segment by segment; only the segment entering a running
// station moves (and not under reduced motion). The drawing shows execution, not a light measurement.
import { c, el, grid, header, linear, radial, RAN, reachIndex, stopIndex, stroke, svg, symbol, txt } from './draw.ts';
import type { CoreRecord, CoreStage, Render } from './draw.ts';

function defs(s: Element, id: string): void {
  const d = el('defs', {}, s);
  linear(d, id + 'glass', [[0, 'var(--glass-1)', 0.34], [1, 'var(--glass-2)', 0.08]]);
  linear(d, id + 'rail', [[0, 'var(--metal-rail-hi)'], [1, 'var(--metal-rail-lo)']], true);
  linear(d, id + 'railv', [[0, 'var(--metal-rail-lo)'], [0.45, 'var(--metal-rail-hi)'], [1, 'var(--metal-rail-lo)']]);
  linear(d, id + 'beam', [[0, 'var(--beam-1)'], [1, 'var(--beam-2)']]);
  linear(d, id + 'beamv', [[0, 'var(--beam-1)'], [1, 'var(--beam-2)']], true);
  radial(d, id + 'win', [[0, 'var(--glass-1)', 0.3], [1, 'var(--glass-2)', 0.04]], 0.35, 0.3);
}
function beam(s: Element, id: string, x1: number, y1: number, x2: number, y2: number, vertical: boolean, running = false): void {
  if (x2 - x1 + y2 - y1 <= 0) return;
  el('line', { x1, y1, x2, y2, style: 'stroke:var(--beam-2);stroke-width:7;opacity:0.07' }, s);
  el('line', { x1, y1, x2, y2, style: 'stroke:var(--beam-1);stroke-width:2.6;opacity:0.16' }, s);
  el('line', { x1, y1, x2, y2, class: running ? 'core-moving' : undefined, style: `stroke:url(#${id}${vertical ? 'beamv' : 'beam'});stroke-width:1.4;${running ? 'stroke-dasharray:6 4;' : ''}` }, s);
}
function path(r: CoreRecord): { stop: number; running: number; through: boolean; end: number } {
  const stop = stopIndex(r), reach = reachIndex(r), running = r.stages.findIndex(st => st.status === 'running');
  const through = stop < 0 && running < 0 && reach === 4 && r.stages[5].status === 'ok';
  return { stop, running, through, end: stop >= 0 ? stop : running >= 0 ? running : through ? 6 : reach };
}
/** The lit signal from the source to `end`, with only the last segment moving when a stage runs. */
function signal(s: Element, id: string, from: number, at: readonly number[], end: number, p: ReturnType<typeof path>, fixed: number, vertical: boolean): void {
  const go = (a: number, b: number, run?: boolean): void => vertical ? beam(s, id, fixed, a, fixed, b, true, run) : beam(s, id, a, fixed, b, fixed, false, run);
  if (p.running < 0) return go(from, end);
  const split = p.running ? at[p.running - 1] : from;
  go(from, split);
  go(split, end, true);
}
function plate(s: Element, id: string, points: string, st: CoreStage): void {
  const lit = st.status === 'ok' || st.status === 'running';
  el('polygon', { points, style: `fill:${lit ? `url(#${id}glass)` : st.status === 'blocked' ? 'var(--blocked-fill)' : 'none'};${stroke(st.status, 1)}` }, s);
}
/** A metal cap at each end of a plate (the glass is held, not floating). */
function caps(s: Element, a: readonly number[], quiet: boolean): void {
  for (let k = 0; k < 8; k += 4) el('line', { x1: a[k], y1: a[k + 1], x2: a[k + 2], y2: a[k + 3], style: `stroke:var(--metal-1);stroke-width:2.6;stroke-linecap:round;opacity:${quiet ? 0.45 : 0.9}` }, s);
}
/** Measurement point on the axis: a reticle where the signal passed, a shutter echo, or scatter. */
function mark(s: Element, x: number, y: number, st: CoreStage): void {
  if (st.status === 'blocked') {
    el('circle', { cx: x, cy: y, r: 20, style: `fill:none;stroke:${c('blocked')};stroke-width:0.6;opacity:0.3` }, s);
    el('circle', { cx: x, cy: y, r: 11, style: `fill:none;stroke:${c('blocked')};stroke-width:0.9;opacity:0.6` }, s);
  } else if (st.status === 'failed') {
    for (let k = 0; k < 5; k++) {
      const a = -0.9 + k * 0.45;
      el('line', { x1: x + 6 * Math.cos(a), y1: y + 6 * Math.sin(a), x2: x + 18 * Math.cos(a), y2: y + 18 * Math.sin(a), style: `stroke:${c('failed')};stroke-width:0.9;stroke-dasharray:3 2` }, s);
    }
  } else if (st.status === 'ok' || st.status === 'running') {
    const ring = 'fill:none;stroke:var(--beam-1);stroke-width:0.8';
    el('circle', { cx: x, cy: y, r: 6, style: `${ring};opacity:0.75;${st.status === 'running' ? 'stroke-dasharray:2 2' : ''}` }, s);
    for (let k = 0; k < 4; k++) { const [dx, dy] = [[1, 0], [0, 1], [-1, 0], [0, -1]][k]; el('line', { x1: x + 8.5 * dx, y1: y + 8.5 * dy, x2: x + 11.5 * dx, y2: y + 11.5 * dy, style: `${ring};opacity:0.6` }, s); }
    el('circle', { cx: x, cy: y, r: 2, style: 'fill:var(--beam-1)' }, s);
  }
}
/** A housing (source or detector): machined block, top bevel light, inner frame. */
function housing(s: Element, id: string, x: number, y: number, w: number, h: number): void {
  el('rect', { x, y, width: w, height: h, rx: 6, style: `fill:url(#${id}rail);stroke:var(--core-line-2)` }, s);
  el('line', { x1: x + 6, y1: y + 1.2, x2: x + w - 6, y2: y + 1.2, style: 'stroke:var(--shade-hi);stroke-width:0.8;opacity:0.35' }, s);
}
function aperture(s: Element, x: number, y: number): void {
  el('circle', { cx: x, cy: y, r: 8, style: 'fill:var(--core-well);stroke:var(--metal-1);stroke-width:0.8' }, s);
  el('circle', { cx: x, cy: y, r: 4.5, style: 'fill:var(--core-well);stroke:var(--beam-2);stroke-width:1' }, s);
}

export const render: Render = (host, r, t) => {
  // Desktop: horizontal bench.
  {
    const id = 'od', s = svg(host, 800, 540, false, t('view.optik') + ' · ' + r.title);
    grid(s, 800, 540, 'og'); defs(s, id); header(s, t('core.o.title'));
    const by = 236, rail = 400, xs = [176, 274, 372, 470, 568, 666], p = path(r);
    el('rect', { x: 36, y: rail, width: 728, height: 16, rx: 3, style: `fill:url(#${id}rail);stroke:var(--core-line-2);stroke-width:0.8` }, s);
    el('line', { x1: 40, y1: rail + 1.2, x2: 760, y2: rail + 1.2, style: 'stroke:var(--shade-hi);stroke-width:0.8;opacity:0.3' }, s);
    el('line', { x1: 40, y1: rail + 8, x2: 760, y2: rail + 8, style: 'stroke:var(--core-line);stroke-width:1.2' }, s);
    for (let x = 36, i = 0; x <= 764; x += 10, i++) {
      const major = i % 10 === 0;
      el('line', { x1: x, y1: 424, x2: x, y2: major ? 436 : 429, style: `stroke:var(${major ? '--core-ink-4' : '--core-line-2'});stroke-width:0.8` }, s);
      if (major) txt(s, x, 450, String(i * 10), { size: 11, color: 'var(--core-ink-4)', anchor: 'middle' });
    }
    // The optical axis, always visible, from the source through every station to the detector.
    el('line', { x1: 60, y1: by, x2: 750, y2: by, style: 'stroke:var(--core-ink-4);stroke-width:0.6;opacity:0.55' }, s);
    el('rect', { x: 72, y: 268, width: 8, height: rail - 268, style: `fill:url(#${id}railv);stroke:var(--core-line-2);stroke-width:0.6` }, s);
    housing(s, id, 42, 204, 64, 64);
    el('rect', { x: 50, y: 212, width: 48, height: 48, rx: 4, style: 'fill:none;stroke:var(--core-line)' }, s);
    aperture(s, 106, by);
    txt(s, 74, 192, t('core.o.cmd'), { size: 11, color: 'var(--core-ink-3)', anchor: 'middle', spacing: 1 });
    const endX = p.end === 6 ? 716 : p.end >= 0 ? xs[p.end] - 2 : 108;
    if (endX > 108) signal(s, id, 114, xs, endX, p, by, false);
    xs.forEach((x, i) => {
      const st = r.stages[i], quiet = !RAN.has(st.status);
      el('rect', { x: x - 3, y: 362, width: 6, height: rail - 362, style: `fill:${quiet ? 'none' : `url(#${id}railv)`};stroke:var(--core-line-2);stroke-width:0.6;${quiet ? 'stroke-dasharray:2 3' : ''}` }, s);
      el('rect', { x: x - 6, y: 356, width: 12, height: 6, rx: 1, style: `fill:var(--core-surface);stroke:var(--core-line-2);stroke-width:0.6` }, s);
      el('rect', { x: x - 20, y: rail - 9, width: 40, height: 15, rx: 2, style: `fill:url(#${id}rail);stroke:var(--core-line-2);stroke-width:0.8;opacity:${quiet ? 0.55 : 1}` }, s);
      for (const dx of [-13, 13]) el('circle', { cx: x + dx, cy: rail - 1.5, r: 1.3, style: 'fill:var(--core-line-2)' }, s);
      el('polygon', { points: `${x},${rail + 17} ${x - 3.5},${rail + 22} ${x + 3.5},${rail + 22}`, style: `fill:${quiet ? 'var(--core-ink-4)' : c(st.status)}` }, s);
      plate(s, id, `${x - 7},128 ${x + 7},116 ${x + 7},348 ${x - 7},360`, st);
      caps(s, [x - 7, 128, x + 7, 116, x - 7, 360, x + 7, 348], quiet);
      if (st.status === 'ok' || st.status === 'running') el('line', { x1: x - 4, y1: 132, x2: x - 4, y2: 352, style: 'stroke:var(--glass-edge);stroke-width:0.6;opacity:0.7' }, s);
      el('path', { d: `M${x - 16} ${by} h4 M${x + 12} ${by} h4`, style: 'stroke:var(--core-ink-4);stroke-width:0.8' }, s);
      if (st.status === 'blocked' && i < 5) {
        el('rect', { x: x - 9, y: by - 16, width: 18, height: 32, rx: 2, style: `fill:var(--blocked-fill);stroke:${c('blocked')};stroke-width:2` }, s);
        el('circle', { cx: x, cy: by - 16, r: 2.4, style: `fill:var(--core-well);stroke:${c('blocked')};stroke-width:1` }, s);
      }
      txt(s, x, 104, st.n, { size: 12, color: c(st.status), anchor: 'middle' });
      txt(s, x, 482, st.short, { size: 15, color: quiet ? 'var(--core-ink-3)' : 'var(--core-ink)', font: 'text', anchor: 'middle' });
      const label = t('core.s.' + st.status), tw = label.length * 7.2;
      symbol(s, x - tw / 2 - 4, 501, st.status, 5);
      txt(s, x - tw / 2 + 6, 505, label, { size: 12, color: c(st.status) });
    });
    xs.forEach((x, i) => { if (i <= p.end && RAN.has(r.stages[i].status)) mark(s, x, by, r.stages[i]); });
    if (p.stop >= 0) {
      const x = xs[p.stop], st = r.stages[p.stop];
      // The callout opens toward the free side, so it is never cut at the right edge.
      const k = x > 420 ? -1 : 1;
      el('polyline', { points: `${x},92 ${x},72 ${x + 12 * k},72`, style: `fill:none;stroke:${c(st.status)};stroke-width:0.8` }, s);
      txt(s, x + 18 * k, 76, t(st.status === 'blocked' ? 'core.o.stopped' : 'core.o.scattered', { stage: st.name }), { size: 12, color: c(st.status), anchor: k < 0 ? 'end' : 'start' });
    }
    const res = r.stages[5];
    el('rect', { x: 736, y: 300, width: 8, height: rail - 300, style: `fill:url(#${id}railv);stroke:var(--core-line-2);stroke-width:0.6` }, s);
    housing(s, id, 716, 204, 48, 64);
    el('rect', { x: 724, y: 220, width: 32, height: 32, rx: 3, style: 'fill:var(--core-well);stroke:var(--metal-1);stroke-width:0.8' }, s);
    el('rect', { x: 724, y: 220, width: 32, height: 32, rx: 3, style: `fill:url(#${id}win)` }, s);
    el('rect', { x: 713, y: by - 4, width: 5, height: 8, rx: 1, style: 'fill:var(--core-well);stroke:var(--metal-1);stroke-width:0.6' }, s);
    if (p.through) symbol(s, 740, 236, res.status, 9);
    txt(s, 740, 192, t('core.o.det'), { size: 11, color: 'var(--core-ink-3)', anchor: 'middle', spacing: 1 });
    txt(s, 740, 288, t(p.through ? 'core.o.arrived' : 'core.o.none'), { size: 11, color: p.through ? c(res.status) : 'var(--core-ink-4)', anchor: 'middle' });
  }
  // Mobile: vertical bench, geometry only.
  {
    const id = 'om', s = svg(host, 300, 600, true, '');
    grid(s, 300, 600, 'ogm', 20); defs(s, id);
    const bx = 170, ys = [116, 196, 276, 356, 436, 516], p = path(r);
    el('rect', { x: 28, y: 20, width: 14, height: 568, rx: 3, style: `fill:url(#${id}railv);stroke:var(--core-line-2);stroke-width:0.8` }, s);
    el('line', { x1: 35, y1: 24, x2: 35, y2: 584, style: 'stroke:var(--core-line);stroke-width:1.2' }, s);
    for (let y = 20, i = 0; y <= 584; y += 10, i++) el('line', { x1: i % 10 ? 18 : 12, y1: y, x2: 24, y2: y, style: `stroke:var(${i % 10 ? '--core-line-2' : '--core-ink-4'});stroke-width:0.8` }, s);
    el('line', { x1: bx, y1: 40, x2: bx, y2: 575, style: 'stroke:var(--core-ink-4);stroke-width:0.6;opacity:0.55' }, s);
    el('rect', { x: 42, y: 40, width: 96, height: 6, style: `fill:url(#${id}rail);stroke:var(--core-line-2);stroke-width:0.6` }, s);
    housing(s, id, 138, 18, 64, 44);
    aperture(s, bx, 62);
    const endY = p.end === 6 ? 556 : p.end >= 0 ? ys[p.end] - 2 : 66;
    if (endY > 66) signal(s, id, 70, ys, endY, p, bx, true);
    ys.forEach((y, i) => {
      const st = r.stages[i], quiet = !RAN.has(st.status);
      el('rect', { x: 42, y: y - 3, width: 62, height: 6, style: `fill:${quiet ? 'none' : `url(#${id}rail)`};stroke:var(--core-line-2);stroke-width:0.6;${quiet ? 'stroke-dasharray:2 3' : ''}` }, s);
      el('rect', { x: 22, y: y - 12, width: 26, height: 24, rx: 2, style: `fill:url(#${id}railv);stroke:var(--core-line-2);stroke-width:0.8;opacity:${quiet ? 0.55 : 1}` }, s);
      el('polygon', { points: `11,${y} 6,${y - 3.5} 6,${y + 3.5}`, style: `fill:${quiet ? 'var(--core-ink-4)' : c(st.status)}` }, s);
      plate(s, id, `104,${y - 2} 236,${y - 9} 236,${y + 3} 104,${y + 10}`, st);
      caps(s, [104, y - 2, 104, y + 10, 236, y - 9, 236, y + 3], quiet);
      el('path', { d: `M${bx} ${y - 16} v4 M${bx} ${y + 12} v4`, style: 'stroke:var(--core-ink-4);stroke-width:0.8' }, s);
      if (st.status === 'blocked' && i < 5) el('rect', { x: bx - 16, y: y - 8, width: 32, height: 16, rx: 2, style: `fill:var(--blocked-fill);stroke:${c('blocked')};stroke-width:2` }, s);
      symbol(s, 260, y, st.status, 7);
    });
    ys.forEach((y, i) => { if (i <= p.end && RAN.has(r.stages[i].status) && r.stages[i].status !== 'blocked') mark(s, bx, y, r.stages[i]); });
    housing(s, id, bx - 24, 560, 48, 30);
    el('rect', { x: bx - 14, y: 566, width: 28, height: 18, rx: 2, style: `fill:url(#${id}win);stroke:var(--metal-1);stroke-width:0.6` }, s);
    if (p.through) symbol(s, bx, 575, r.stages[5].status, 7);
  }
};
