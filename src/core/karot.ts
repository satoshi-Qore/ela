// C — Karot (core sample), the default view. The command is a probe that reaches only as deep as the
// execution really went: a blocked stage gets a barrier plate on its floor, a failed stage a
// fracture, and layers whose stage never ran stay sealed.
//
// 7C-33: drawn as a precision sample assembly. Six specimen sections (one material each) are held
// between machined steel collars, under a metal end cap with a glass window, on a pedestal; the whole
// assembly casts a shadow under one light from the upper left. A collar the probe really passed
// carries a thin state inlay; the collar on a blocked stage's floor becomes the red barrier plate.
// The bore is lit only through sections whose stage succeeded. Nothing moves.
import { c, E, el, G, grid, header, kit, linear, P, R, RAN, reachIndex, stopIndex, stroke, svg, symbol, txt } from './draw.ts';
import type { CoreRecord, Render, Text } from './draw.ts';

interface Geometry { x: number; top: number; w: number; h: number; ry: number; ruler: number; labelX: number; mobile: boolean }

function materials(s: Element, id: string): void {
  const defs = kit(s, id);
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
  // Section shading: deep at the silhouette, a narrow specular band left of centre, a faint rim right.
  linear(defs, id + 'shade', [[0, 'var(--shade-edge)', 0.8], [0.1, 'var(--shade-edge)', 0.3], [0.26, 'var(--shade-hi)', 0.22], [0.33, 'var(--shade-hi)', 0.04], [0.62, 'var(--shade-edge)', 0.14], [0.88, 'var(--shade-edge)', 0.6], [0.95, 'var(--shade-hi)', 0.14], [1, 'var(--shade-edge)', 0.85]]);
  linear(defs, id + 'lit', [[0, 'var(--s-running)', 0.38], [0.6, 'var(--s-running)', 0]], true);
}

function specimen(s: Element, r: CoreRecord, id: string, g: Geometry, t: Text): number {
  materials(s, id);
  const { x, top, w, h, ry, ruler, labelX, mobile } = g;
  const cx = x + w / 2, bottom = top + h * 6, u = (n: string): string => `url(#${id}${n})`;
  const arc = (y: number, rx = w / 2, e = ry): string => `M${cx - rx} ${y} A${rx} ${e} 0 0 0 ${cx + rx} ${y}`;
  const drum = (y0: number, y1: number, rx = w / 2, e = ry): string => `${arc(y0, rx, e)} L${cx + rx} ${y1} A${rx} ${e} 0 0 1 ${cx - rx} ${y1} Z`;
  const stop = stopIndex(r), reach = reachIndex(r);
  const through = stop < 0 && r.stages[5].status === 'ok';
  const depthLayer = stop >= 0 ? stop : through ? 5 : reach;
  const depth = depthLayer < 0 ? top - 18 : top + (depthLayer + 1) * h - (depthLayer === 5 ? 10 : 6);
  const opened = (i: number): boolean => i <= depthLayer && r.stages[i].status === 'ok';

  // Key light behind the assembly, kept inside the drawing (a shape past its edge would count as overflow).
  R(s, Math.max(0, x - w * 0.6), top - 40, Math.min(w * 2.2, x + w * 1.6), h * 6 + 70, `fill:${u('sp')}`);
  el('line', { x1: ruler, y1: top, x2: ruler, y2: bottom, style: 'stroke:var(--core-line-2);stroke-width:0.8' }, s);
  for (let i = 0; i <= 36; i++) {
    const y = top + (h / 6) * i, major = i % 6 === 0;
    el('line', { x1: ruler - (major ? 12 : 5), y1: y, x2: ruler, y2: y, style: `stroke:var(${major ? '--core-ink-4' : '--core-line-2'});stroke-width:0.8` }, s);
    if (major && !mobile) txt(s, ruler - 16, y + 4, String(i / 6).padStart(2, '0'), { size: 11, color: 'var(--core-ink-4)', anchor: 'end' });
  }

  // The assembly, drawn from the pedestal up so each part sits on the one below.
  const a = G(s, { filter: u('sh') });
  const metal = (y0: number, y1: number, rx: number, e: number): void => {
    P(a, drum(y0, y1, rx, e), `fill:${u('mh')}`);
    E(a, cx, y0, rx, e, `fill:${u('mv')};stroke:var(--mat-edge);stroke-width:0.5;stroke-opacity:0.5`);
  };
  metal(bottom, bottom + 14, w / 2 + 18, ry + 4);
  for (let i = 5; i >= 0; i--) {
    const st = r.stages[i], y0 = top + i * h, y1 = i < 5 ? y0 + h - 3 : bottom, mid = y0 + h / 2 + ry * 0.5, d = drum(y0, y1);
    // The collar on this section's floor: after the section below, before this one, which sits on it.
    if (i < 5) {
      const yc = y0 + h;
      metal(yc - 3, yc + 3, w / 2 + 6, ry + 1.5);
      if (st.status === 'blocked') {
        P(a, arc(yc + 1, w / 2 + 6, ry + 1.5), `fill:none;stroke:${c('blocked')};stroke-width:5`);
        P(a, arc(yc + 8, w / 2, ry), `fill:none;stroke:${c('blocked')};stroke-width:0.8;opacity:0.6`);
      } else if (opened(i)) P(a, arc(yc + 0.5, w / 2 + 6, ry + 1.5), `fill:none;stroke:${c('ok')};stroke-width:1.3`);
    }
    P(a, d, `fill:${u('m' + i)}`);
    P(a, d, `fill:${u('shade')}`);
    if (st.status === 'skipped') { P(a, d, 'fill:var(--seal-overlay)'); P(a, d, `fill:${u('seal')}`); }
    if (st.status === 'waiting' || st.status === 'unknown') P(a, d, 'fill:var(--seal-overlay);opacity:0.6');
    if (st.status === 'unknown') symbol(a, cx + w * 0.28, mid, 'unknown', 7);
    if (st.status === 'running') P(a, d, `fill:${u('lit')}`);
    if (st.status === 'failed') {
      let f = `M${x + 3} ${mid}`;
      [-6, 5, -2, 7, -5, 3, -7, 4, 0].forEach((dy, k) => { f += ` L${x + 3 + ((w - 6) * (k + 1)) / 9} ${mid + dy}`; });
      P(a, f, 'fill:none;stroke:var(--shade-edge);stroke-width:3;opacity:0.5;transform:translateY(1.5px)');
      P(a, f, `fill:none;${stroke('failed', 1.5)}`);
    }
  }
  // End cap with a glass window, and the probe drive above it.
  metal(top - 16, top + 3, w / 2 + 7, ry + 2);
  E(a, cx, top - 16, w / 2 - 12, ry - 4, 'fill:var(--layer-top)');
  E(a, cx, top - 16, w / 2 - 12, ry - 4, `fill:${u('gl')};stroke:var(--mat-lo);stroke-width:1.2`);
  for (let y = top + h / 6; y < bottom; y += h / 6) el('line', { x1: x + w + 7, y1: y, x2: x + w + 11, y2: y, style: 'stroke:var(--core-line-2);stroke-width:0.8' }, s);

  // The bore, lit only through sections whose stage succeeded, with a ring at each joint passed.
  if (depth > top - 16) {
    R(s, cx - 7, top - 16, 14, depth - top + 16, 'fill:var(--bore)');
    el('line', { x1: cx + 6.6, y1: top - 16, x2: cx + 6.6, y2: depth, style: 'stroke:var(--shade-hi);stroke-width:0.6;opacity:0.3' }, s);
    r.stages.forEach((st, i) => {
      const y0 = top + i * h, y1 = Math.min(y0 + h, depth);
      if (y1 <= y0) return;
      if (opened(i)) R(s, cx - 6, y0 + 3, 12, y1 - y0 - 6, `fill:${c('ok')};opacity:0.22`);
      if (st.status === 'running') R(s, cx - 6, y0, 12, y1 - y0, `fill:${u('lit')}`);
    });
    E(s, cx, top - 16, 7, 2.4, 'fill:var(--bore);stroke:var(--mat-hi);stroke-width:0.6');
  }
  const tip = Math.max(depth, top - 26), hd = G(s, { filter: u('ss') });
  R(hd, cx - 16, top - 66, 32, 18, `fill:${u('mv')};stroke:var(--mat-lo);stroke-width:0.8`, 3);
  R(hd, cx - 10, top - 59, 20, 3, 'fill:var(--mat-lo)', 1.5);
  R(hd, cx - 2.5, top - 48, 5, tip - 10 - (top - 48), `fill:${u('mh')}`);
  R(hd, cx - 4.5, tip - 13, 9, 3, 'fill:var(--mat-mid)', 1);
  el('polygon', { points: `${cx - 4},${tip - 10} ${cx + 4},${tip - 10} ${cx},${tip}`, style: 'fill:var(--probe-tip)' }, hd);

  r.stages.forEach((st, i) => {
    const yc = top + i * h + h / 2 + ry * 0.4, quiet = !RAN.has(st.status);
    el('line', { x1: x + w + 14, y1: yc, x2: labelX - 10, y2: yc, style: stroke(st.status, 0.8) }, s);
    if (!quiet) el('circle', { cx: x + w + 14, cy: yc, r: 1.8, style: `fill:${c(st.status)}` }, s);
    symbol(s, labelX + (mobile ? 6 : 32), mobile ? yc : yc + 9, st.status, mobile ? 6 : 5.5);
    if (mobile) return;
    txt(s, labelX, yc - 8, st.n, { size: 11, color: c(st.status) });
    txt(s, labelX + 26, yc - 8, st.name, { size: 15, color: quiet ? 'var(--core-ink-3)' : 'var(--core-ink)', font: 'text' });
    txt(s, labelX + 44, yc + 13, t('core.s.' + st.status) + (st.rpc ? ` · ${st.rpc}${st.value ? ' → ' + st.value : ''}` : ''), { size: 12, color: c(st.status) });
  });
  if (!mobile) {
    const bx = x - 34;
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
  const reached = specimen(d, r, 'kd', { x: 180, top: 110, w: 220, h: 60, ry: 15, ruler: 112, labelX: 462, mobile: false }, t);
  txt(d, 462, 74, t('core.k.depth', { n: String(Math.max(reached, 0)).padStart(2, '0') }), { size: 12, color: 'var(--s-ok)' });
  const sealed = r.stages.filter(s => s.status === 'skipped').length;
  txt(d, 462, 522, r.stages.every(s => s.status === 'waiting') ? t('core.k.idle') : sealed ? t('core.k.sealed', { n: sealed }) : reached === 6 ? t('core.k.all') : '', { size: 12, color: 'var(--core-ink-3)' });

  const m = svg(host, 300, 560, true, '');
  grid(m, 300, 560, 'kgm', 20);
  specimen(m, r, 'km', { x: 52, top: 90, w: 136, h: 72, ry: 10, ruler: 30, labelX: 222, mobile: true }, t);
};
