// C — Karot (core sample), the default view. The command is a probe that reaches only as deep as the
// execution really went: a blocked stage gets a barrier plate on its floor, a failed stage a
// fracture, and layers whose stage never ran stay sealed.
//
// 7C-33 visual pass: the same cylinder, layers, perspective, and probe, drawn as a machined specimen.
// One light from the upper left (a specular band, a rim on the right, a cast shadow below), a bevelled
// seam between layers, a sapphire cap in a metal rim, and a bore that is lit only through the layers
// whose stage succeeded. Nothing moves: light here is a state, not an activity.
import { c, el, grid, header, linear, radial, RAN, reachIndex, stopIndex, stroke, svg, symbol, txt } from './draw.ts';
import type { CoreRecord, Render, Text } from './draw.ts';

interface Geometry { x: number; top: number; w: number; h: number; ry: number; ruler: number; labelX: number; mobile: boolean }

function materials(s: Element, id: string): void {
  const defs = el('defs', {}, s);
  const ln = 'stroke:var(--layer-line);stroke-width:0.6;fill:none';
  const pat = (i: number, w: number, h: number, draw: (p: Element) => void, rotate?: number): void => {
    const p = el('pattern', { id: `${id}m${i}`, width: w, height: h, patternUnits: 'userSpaceOnUse', patternTransform: rotate ? `rotate(${rotate})` : undefined }, defs);
    el('rect', { width: w, height: h, style: `fill:var(--layer-${i})` }, p);
    draw(p);
  };
  pat(0, 8, 5, p => el('line', { x1: 0, y1: 2.5, x2: 8, y2: 2.5, style: ln }, p));
  pat(1, 10, 10, p => { el('circle', { cx: 2.5, cy: 2.5, r: 0.9, style: 'fill:var(--layer-line)' }, p); el('circle', { cx: 7.5, cy: 7.5, r: 0.9, style: 'fill:var(--layer-line)' }, p); });
  pat(2, 9, 9, p => el('line', { x1: 0, y1: 0, x2: 0, y2: 9, style: ln }, p), 32);
  pat(3, 24, 24, p => [[3, 4], [11, 2], [19, 7], [6, 13], [15, 15], [22, 19], [2, 21], [11, 22]].forEach(([x, y], i) => el('circle', { cx: x, cy: y, r: i % 3 ? 0.8 : 1.2, style: 'fill:var(--layer-line)' }, p)));
  pat(4, 40, 10, p => el('path', { d: 'M0 5 Q10 1 20 5 T40 5', style: ln }, p));
  pat(5, 4, 12, p => el('line', { x1: 2, y1: 0, x2: 2, y2: 12, style: ln }, p));
  const seal = el('pattern', { id: id + 'seal', width: 7, height: 7, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
  el('line', { x1: 0, y1: 0, x2: 0, y2: 7, style: 'stroke:var(--s-skipped);stroke-width:0.8;opacity:0.55' }, seal);
  // Cylinder light: shadow at the silhouette, a narrow specular band left of centre, a faint rim on the right.
  linear(defs, id + 'shade', [[0, 'var(--shade-edge)', 0.72], [0.09, 'var(--shade-edge)', 0.26], [0.25, 'var(--shade-hi)', 0.16], [0.32, 'var(--shade-hi)', 0.05], [0.6, 'var(--shade-edge)', 0.1], [0.87, 'var(--shade-edge)', 0.5], [0.95, 'var(--shade-hi)', 0.12], [1, 'var(--shade-edge)', 0.78]]);
  linear(defs, id + 'metal', [[0, 'var(--metal-1)'], [0.4, 'var(--metal-2)'], [1, 'var(--metal-1)']]);
  linear(defs, id + 'cap', [[0, 'var(--glass-1)', 0.3], [1, 'var(--glass-2)', 0.05]], true);
  linear(defs, id + 'lit', [[0, 'var(--s-running)', 0.34], [0.6, 'var(--s-running)', 0]], true);
  radial(defs, id + 'cast', [[0, 'var(--shade-edge)', 0.42], [1, 'var(--shade-edge)', 0]]);
  radial(defs, id + 'halo', [[0, 'var(--beam-2)', 0.1], [1, 'var(--beam-2)', 0]]);
}

function specimen(s: Element, r: CoreRecord, id: string, g: Geometry, t: Text): number {
  materials(s, id);
  const { x, top, w, h, ry, ruler, labelX, mobile } = g;
  const cx = x + w / 2, bottom = top + h * 6;
  const arc = (y: number): string => `M${x} ${y} A${w / 2} ${ry} 0 0 0 ${x + w} ${y}`;
  const layer = (i: number): string => { const y0 = top + i * h, y1 = y0 + h; return `${arc(y0)} L${x + w} ${y1} A${w / 2} ${ry} 0 0 1 ${x} ${y1} Z`; };
  const stop = stopIndex(r), reach = reachIndex(r);
  const through = stop < 0 && r.stages[5].status === 'ok';
  const depthLayer = stop >= 0 ? stop : through ? 5 : reach;
  const depth = depthLayer < 0 ? top - 8 : top + (depthLayer + 1) * h - (depthLayer === 5 ? 10 : 6);
  const opened = (i: number): boolean => i <= depthLayer && r.stages[i].status === 'ok';

  el('ellipse', { cx, cy: top + h * 3, rx: w * 1.05, ry: h * 3.6, style: `fill:url(#${id}halo)` }, s);
  el('ellipse', { cx: cx + 6, cy: bottom + ry * 0.7, rx: w * 0.64, ry: ry * 1.5, style: `fill:url(#${id}cast)` }, s);
  el('line', { x1: ruler, y1: top, x2: ruler, y2: bottom, style: 'stroke:var(--core-line-2);stroke-width:0.8' }, s);
  for (let i = 0; i <= 36; i++) {
    const y = top + (h / 6) * i, major = i % 6 === 0;
    el('line', { x1: ruler - (major ? 12 : 5), y1: y, x2: ruler, y2: y, style: `stroke:var(${major ? '--core-ink-4' : '--core-line-2'});stroke-width:0.8` }, s);
    if (major && !mobile) txt(s, ruler - 16, y + 4, String(i / 6).padStart(2, '0'), { size: 11, color: 'var(--core-ink-4)', anchor: 'end' });
  }
  r.stages.forEach((_, i) => el('path', { d: layer(i), style: `fill:url(#${id}m${i})` }, s));
  const clip = el('clipPath', { id: id + 'clip' }, el('defs', {}, s));
  el('path', { d: `M${x} ${top} L${x + w} ${top} L${x + w} ${bottom} A${w / 2} ${ry} 0 0 1 ${x} ${bottom} Z` }, clip);
  const body = el('g', { 'clip-path': `url(#${id}clip)` }, s);
  // Seams: a soft inner shadow under each joint, a dark cut, and a hairline of light just below it.
  for (let i = 1; i < 6; i++) {
    const y = top + i * h;
    el('path', { d: arc(y + 4), style: 'fill:none;stroke:var(--shade-edge);stroke-width:7;opacity:0.16' }, body);
    el('path', { d: arc(y), style: 'fill:none;stroke:var(--shade-edge);stroke-width:1.1;opacity:0.55' }, body);
    el('path', { d: arc(y + 1.3), style: 'fill:none;stroke:var(--shade-hi);stroke-width:0.7;opacity:0.22' }, body);
  }
  el('rect', { x, y: top - ry, width: w, height: h * 6 + ry * 2, style: `fill:url(#${id}shade)` }, body);

  r.stages.forEach((st, i) => {
    const y1 = top + (i + 1) * h, mid = top + i * h + h / 2 + ry * 0.5;
    if (st.status === 'skipped') { el('path', { d: layer(i), style: 'fill:var(--seal-overlay)' }, s); el('path', { d: layer(i), style: `fill:url(#${id}seal)` }, s); }
    if (st.status === 'waiting' || st.status === 'unknown') el('path', { d: layer(i), style: 'fill:var(--seal-overlay);opacity:0.6' }, s);
    if (st.status === 'unknown') symbol(s, cx + w * 0.28, mid, 'unknown', 7);
    if (st.status === 'running') el('path', { d: layer(i), style: `fill:url(#${id}lit)` }, s);
    // A succeeded layer keeps a quiet lit floor: six of them read as one system that ran through.
    if (opened(i)) el('path', { d: arc(y1 - 1), style: `fill:none;stroke:${c('ok')};stroke-width:1;opacity:0.5` }, body);
    if (st.status === 'failed') {
      let d = `M${x + 3} ${mid}`;
      [-6, 5, -2, 7, -5, 3, -7, 4, 0].forEach((dy, k) => { d += ` L${x + 3 + ((w - 6) * (k + 1)) / 9} ${mid + dy}`; });
      el('path', { d, transform: 'translate(0 1.4)', style: 'fill:none;stroke:var(--shade-edge);stroke-width:2.6;opacity:0.45' }, s);
      el('path', { d, style: `fill:none;${stroke('failed', 1.4)}` }, s);
    }
    if (st.status === 'blocked' && i < 5) {
      el('path', { d: arc(y1), style: `fill:none;stroke:${c('blocked')};stroke-width:4` }, s);
      el('path', { d: arc(y1 - 1.2), style: 'fill:none;stroke:var(--shade-hi);stroke-width:0.6;opacity:0.45' }, s);
      el('path', { d: arc(y1 + 5), style: `fill:none;stroke:${c('blocked')};stroke-width:0.8;opacity:0.6` }, s);
    }
  });
  // Silhouette edges, the bottom collar, and the sapphire cap in its metal rim.
  el('line', { x1: x + 0.4, y1: top, x2: x + 0.4, y2: bottom, style: 'stroke:var(--metal-1);stroke-width:0.8;opacity:0.55' }, s);
  el('line', { x1: x + w - 0.4, y1: top, x2: x + w - 0.4, y2: bottom, style: 'stroke:var(--shade-hi);stroke-width:0.8;opacity:0.3' }, s);
  el('path', { d: arc(bottom), style: 'fill:none;stroke:var(--metal-1);stroke-width:1.3' }, s);
  el('path', { d: arc(bottom - 2.5), style: 'fill:none;stroke:var(--shade-hi);stroke-width:0.6;opacity:0.22' }, s);
  el('ellipse', { cx, cy: top, rx: w / 2, ry, style: 'fill:var(--layer-top)' }, s);
  el('ellipse', { cx, cy: top, rx: w / 2, ry, style: `fill:url(#${id}cap);stroke:var(--metal-1);stroke-width:1.6` }, s);
  el('ellipse', { cx, cy: top, rx: w / 2 - 6, ry: ry - 3, style: 'fill:none;stroke:var(--core-line-2);stroke-width:0.6' }, s);
  el('ellipse', { cx, cy: top, rx: w / 2 - 1, ry: ry - 0.6, pathLength: 100, style: 'fill:none;stroke:var(--shade-hi);stroke-width:0.9;opacity:0.6;stroke-dasharray:16 84;stroke-dashoffset:-55' }, s);
  for (let y = top + h / 6; y < bottom; y += h / 6) el('line', { x1: x + w, y1: y, x2: x + w + 5, y2: y, style: 'stroke:var(--core-line-2);stroke-width:0.8' }, s);

  // The bore: a dark channel, lit only through layers whose stage succeeded, with a collar at each
  // joint the probe really passed.
  if (depth > top) {
    el('rect', { x: cx - 7, y: top, width: 14, height: depth - top, style: 'fill:var(--bore)' }, s);
    el('line', { x1: cx - 6.6, y1: top, x2: cx - 6.6, y2: depth, style: 'stroke:var(--shade-edge);stroke-width:0.8' }, s);
    el('line', { x1: cx + 6.6, y1: top, x2: cx + 6.6, y2: depth, style: 'stroke:var(--shade-hi);stroke-width:0.6;opacity:0.3' }, s);
    r.stages.forEach((st, i) => {
      const y0 = top + i * h, y1 = Math.min(y0 + h, depth);
      if (y1 <= y0) return;
      if (opened(i)) el('rect', { x: cx - 6, y: y0 + 2, width: 12, height: y1 - y0 - 4, style: `fill:${c('ok')};opacity:0.2` }, s);
      if (st.status === 'running') el('rect', { x: cx - 6, y: y0, width: 12, height: y1 - y0, style: `fill:url(#${id}lit)` }, s);
    });
    el('ellipse', { cx, cy: top, rx: 7, ry: 2.4, style: 'fill:var(--bore);stroke:var(--metal-1);stroke-width:0.6' }, s);
  }
  const tip = Math.max(depth, top - 8);
  el('rect', { x: cx - 14, y: top - 56, width: 28, height: 16, rx: 3, style: `fill:url(#${id}metal);stroke:var(--core-line-2);stroke-width:0.8` }, s);
  el('line', { x1: cx - 8, y1: top - 48, x2: cx + 8, y2: top - 48, style: 'stroke:var(--core-line-2);stroke-width:1.2' }, s);
  el('rect', { x: cx - 2.5, y: top - 40, width: 5, height: tip - 10 - (top - 40), style: `fill:url(#${id}metal)` }, s);
  el('rect', { x: cx - 4.5, y: tip - 13, width: 9, height: 3, rx: 1, style: 'fill:var(--metal-1)' }, s);
  el('polygon', { points: `${cx - 4},${tip - 10} ${cx + 4},${tip - 10} ${cx},${tip}`, style: 'fill:var(--probe-tip)' }, s);
  for (let i = 1; i <= Math.min(depthLayer, 5); i++) if (opened(i - 1)) el('path', { d: `M${cx - 9} ${top + i * h} A9 2.6 0 0 0 ${cx + 9} ${top + i * h}`, style: `fill:none;stroke:${c('ok')};stroke-width:1.1` }, s);

  r.stages.forEach((st, i) => {
    const yc = top + i * h + h / 2 + ry * 0.4, quiet = !RAN.has(st.status);
    el('line', { x1: x + w + 9, y1: yc, x2: labelX - 10, y2: yc, style: stroke(st.status, 0.8) }, s);
    if (!quiet) el('circle', { cx: x + w + 9, cy: yc, r: 1.8, style: `fill:${c(st.status)}` }, s);
    symbol(s, labelX + (mobile ? 6 : 32), mobile ? yc : yc + 9, st.status, mobile ? 6 : 5.5);
    if (mobile) return;
    txt(s, labelX, yc - 8, st.n, { size: 11, color: c(st.status) });
    txt(s, labelX + 26, yc - 8, st.name, { size: 15, color: quiet ? 'var(--core-ink-3)' : 'var(--core-ink)', font: 'text' });
    txt(s, labelX + 44, yc + 13, t('core.s.' + st.status) + (st.rpc ? ` · ${st.rpc}${st.value ? ' → ' + st.value : ''}` : ''), { size: 12, color: c(st.status) });
  });
  if (!mobile) {
    const bx = x - 30;
    if (depth > top) {
      el('line', { x1: bx, y1: top, x2: bx, y2: depth, style: `stroke:${c('ok')};stroke-width:1.2` }, s);
      el('line', { x1: bx - 4, y1: top, x2: bx + 4, y2: top, style: `stroke:${c('ok')};stroke-width:1.2` }, s);
      el('line', { x1: bx - 4, y1: depth, x2: bx + 4, y2: depth, style: `stroke:${c(stop >= 0 ? r.stages[stop].status : 'ok')};stroke-width:2` }, s);
    }
    if (depth < bottom - 12) el('line', { x1: bx, y1: Math.max(depth + 6, top), x2: bx, y2: bottom, style: 'stroke:var(--core-line-2);stroke-width:1;stroke-dasharray:2 4' }, s);
  }
  return depthLayer + 1;
}

export const render: Render = (host, r, t) => {
  const d = svg(host, 800, 540, false, t('view.karot') + ' · ' + r.title);
  grid(d, 800, 540, 'kg');
  header(d, t('core.k.title'));
  const reached = specimen(d, r, 'kd', { x: 180, top: 104, w: 220, h: 62, ry: 15, ruler: 112, labelX: 462, mobile: false }, t);
  txt(d, 462, 74, t('core.k.depth', { n: String(Math.max(reached, 0)).padStart(2, '0') }), { size: 12, color: 'var(--s-ok)' });
  const sealed = r.stages.filter(s => s.status === 'skipped').length;
  txt(d, 462, 522, r.stages.every(s => s.status === 'waiting') ? t('core.k.idle') : sealed ? t('core.k.sealed', { n: sealed }) : reached === 6 ? t('core.k.all') : '', { size: 12, color: 'var(--core-ink-3)' });

  const m = svg(host, 300, 560, true, '');
  grid(m, 300, 560, 'kgm', 20);
  specimen(m, r, 'km', { x: 52, top: 82, w: 136, h: 74, ry: 10, ruler: 30, labelX: 222, mobile: true }, t);
};
