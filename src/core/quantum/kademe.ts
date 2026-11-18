// Concept Q1 — KADEME, the Energy Ladder (prototype; nothing in the interface imports it).
// The quantum energy-level diagram built as an architecture: six separately machined titanium level
// modules rise left to right on a plinth, along an engraved energy axis. Each module has a chamfered
// nosing, a polished vertical edge, a recessed front panel engraved with its level index, and a round
// sapphire lens seated in a bezel on its top face (drawn in the top plane's perspective). A sapphire
// light guide joins the lenses of levels that really succeeded, and only those. ok: a seated lens with
// the success inlay on its bezel; running: a half-lit lens and the only moving ring; waiting: an empty
// bezel; blocked: a red-edged shutter blade on the module edge (the climb stops there); failed: a
// fractured lens; skipped: a titanium cap; unknown: a frosted lens. The crown fixture on the top level
// shows the result: the faceted gem only on a real success, the state mark otherwise.
import { c, E, el, G, grid, header, OUT, P, R, RAN, stroke, svg, symbol, txt } from '../draw.ts';
import type { CoreRecord, Render, Status } from '../draw.ts';
import { ink, QL, qkit } from './optics.ts';

const X0 = 74, W = 84, S = 44, GROUND = 452, DX = 58, DY = -34, BASE = 22, GAP = 3;
const top = (i: number): number => GROUND - BASE - (i + 1) * S;
const pt = (x: number, y: number): string => `${x.toFixed(1)} ${y.toFixed(1)}`;
/** A circle in a module's top plane (u along x, v along depth), as a closed path. */
const disc = (x: number, y: number, w: number, r: number, cu = 0.5, cv = 0.5): string => {
  let d = '';
  for (let k = 0; k <= 24; k++) {
    const a = (k / 24) * Math.PI * 2, u = cu + r * Math.cos(a), v = cv + r * Math.sin(a);
    d += (k ? 'L' : 'M') + pt(x + u * w + v * DX, y + v * DY);
  }
  return d + 'Z';
};
const onTop = (x: number, y: number, w: number, u: number, v: number): [number, number] => [x + u * w + v * DX, y + v * DY];

function gem(s: Element, x: number, y: number, r: number): void {
  const v = [[0, -r], [r, 0], [0, r], [-r, 0]], col = 'var(--s-result)';
  [0.72, 0.3, 0.5, 0.95].forEach((o, k) => { const [p, q] = [v[k], v[(k + 1) % 4]]; P(s, `M${x} ${y} L${x + p[0]} ${y + p[1]} L${x + q[0]} ${y + q[1]} Z`, `fill:${col};opacity:${o}`); });
  P(s, `M${x} ${y - r} L${x + r} ${y} L${x} ${y + r} L${x - r} ${y} Z`, `fill:none;stroke:${col};stroke-width:1`);
}

/** A machined module: side face (turned away), top face (lit), front face (lit from above), with a
 *  polished chamfer on the nosing and on the front-right vertical edge, and a recessed front panel. */
function module(p: Element, u: (n: string) => string, x: number, y: number, w: number, bottom: number, level: number): void {
  const k = 0.1;
  P(p, `M${pt(x + w, y)} l${DX} ${DY} V${bottom + DY} l${-DX} ${-DY} Z`, `fill:${u('Ts')};${QL}`);
  P(p, `M${pt(x, y)} h${w} l${DX} ${DY} h${-w} Z`, `fill:${u('Tt')};${QL}`);
  R(p, x, y, w, bottom - y, `fill:${u('Tf')};${QL}`);
  // Chamfers: a bright strip along the nosing, a lit strip down the front-right edge.
  P(p, `M${pt(x, y)} h${w} l${DX * k} ${DY * k} h${-w} Z`, 'fill:#fff;opacity:0.75');
  P(p, `M${pt(x + w, y)} l${DX * k} ${DY * k} V${bottom + DY * k} l${-DX * k} ${-DY * k} Z`, `fill:${u('Tf')};opacity:0.9`);
  // A short level plate recessed under the nosing (shadow on its upper inner edge, light on its lower),
  // engraved with the level index as dots; the rest of the face stays smooth, brushed titanium.
  const px = x + 8, py = y + 14, pw = w - 16, ph = 14;
  if (level >= 0) {
    R(p, px, py, pw, ph, `fill:${u('Ts')};opacity:0.3`, 2);
    P(p, `M${px} ${py + ph} V${py} H${px + pw}`, 'fill:none;stroke:var(--q-line);stroke-width:1.4;opacity:0.7');
    P(p, `M${px} ${py + ph} H${px + pw} V${py}`, 'fill:none;stroke:#fff;stroke-width:0.8;opacity:0.6');
    for (let j = 0; j <= level; j++) E(p, px + 8 + j * 7, py + ph / 2, 1.6, 1.6, 'fill:var(--q-line);opacity:0.7');
  }
}

function ladder(s: Element, id: string, r: CoreRecord): void {
  const u = (n: string): string => `url(#${id}${n})`, st = (i: number): Status => r.stages[i].status;
  R(s, 0, 0, 800, 540, `fill:${u('Bg')}`);
  // Energy axis: an engraved scale on the left with one tick per level.
  P(s, `M42 ${GROUND - BASE} V${top(5) - 10}`, 'stroke:var(--core-ink-4);stroke-width:0.8');
  for (let i = 0; i < 6; i++) P(s, `M36 ${top(i)} h12`, 'stroke:var(--core-ink-4);stroke-width:0.8');
  // Plinth: a heavy chamfered base on four feet.
  const b = G(s, { filter: u('sh') });
  for (const fx of [X0 - 16, X0 + 6 * W - 4]) R(b, fx, GROUND + 14, 20, 8, `fill:${u('Ts')};${QL}`, 1);
  module(b, u, X0 - 24, GROUND - 2, 6 * W + 48, GROUND + 14, -1);

  const reachedOk = (i: number): boolean => st(i) === 'ok' && r.stages.slice(0, i).every(x => x.status === 'ok');
  const m = G(s, { filter: u('sh') });
  for (let i = 0; i < 6; i++) module(m, u, X0 + i * W + GAP / 2, top(i), W - GAP, GROUND - 2, i);
  // Contact shadow where each module stands on the plinth.
  P(s, `M${X0} ${GROUND - 2.5} h${6 * W}`, 'stroke:var(--q-line);stroke-width:2;opacity:0.6');
  P(s, `M${X0 + 6 * W + DX - 1.4} ${top(5) + DY + 3} V${GROUND - 2 + DY}`, 'stroke:var(--q-vio);stroke-width:1.4;opacity:0.8');

  for (let i = 0; i < 6; i++) {
    const x = X0 + i * W + GAP / 2, w = W - GAP, y = top(i), s0 = st(i);
    P(s, `M${x + 1} ${y + 7} h${w - 2}`, `fill:none;${stroke(s0, 1.6)}`);
    // The lens: a bezel ring cut into the top face, a seat, and the sapphire itself.
    const [lx, ly] = onTop(x, y, w, 0.5, 0.52);
    P(s, disc(x, y, w, 0.3, 0.5, 0.52), `fill:${u('Tt')};${QL}`);
    P(s, disc(x, y, w, 0.24, 0.5, 0.52), 'fill:var(--q-line);opacity:0.9');
    if (s0 === 'skipped') { P(s, disc(x, y, w, 0.23, 0.5, 0.52), `fill:${u('Tf')};${QL}`); continue; }
    if (s0 !== 'waiting') {
      // Only a stage that succeeded (or is running) has vivid glass; blocked, failed and unknown keep the dark core.
      P(s, disc(x, y, w, 0.21, 0.5, 0.52), `fill:${u('Sk')}`);
      if (s0 === 'ok' || s0 === 'running') P(s, disc(x, y, w, 0.21, 0.5, 0.52), `fill:${u('Sa')};opacity:${s0 === 'running' ? 0.5 : 0.95}`);
      E(s, lx - 5, ly - 2, 5, 2.2, `fill:#fff;opacity:${s0 === 'ok' ? 0.9 : 0.45}`);
      P(s, disc(x, y, w, 0.21, 0.5, 0.52), 'fill:none;stroke:var(--q-sap-hi);stroke-width:0.7;opacity:0.7');
    }
    if (s0 === 'ok') P(s, disc(x, y, w, 0.27, 0.5, 0.52), `fill:none;stroke:${c('ok')};stroke-width:1.6`);
    if (s0 === 'running') el('path', { d: disc(x, y, w, 0.27, 0.5, 0.52), class: 'core-moving', style: `fill:none;stroke:${c('running')};stroke-width:1.6;stroke-dasharray:6 4` }, s);
    if (s0 === 'failed') P(s, `M${lx - 14} ${ly - 3} l7 5 l5 -6 l6 6 l8 -3`, `fill:none;${stroke('failed', 1.4)}`);
    if (s0 === 'unknown') { P(s, disc(x, y, w, 0.21, 0.5, 0.52), 'fill:var(--seal-overlay)'); symbol(s, lx, ly, 'unknown', 6); }
    if (s0 === 'blocked' && i < 5) {
      // Shutter blade: a machined plate standing on the module edge, red-edged, with its pivot screw.
      P(s, `M${x + 6} ${y} V${y - 30} l${w - 12} 0 V${y} Z`, `fill:${u('Tf')};stroke:${c('blocked')};stroke-width:2.2;stroke-linejoin:round`);
      P(s, `M${x + 9} ${y - 27.5} h${w - 18}`, 'stroke:#fff;stroke-width:0.9;opacity:0.85');
      E(s, x + 14, y - 15, 2.6, 2.6, `fill:${u('Tt')};${QL}`);
    }
  }
  // Sapphire light guide: lens to lens, only across levels that really succeeded in order.
  let d = '';
  for (let i = 0; i < 6 && reachedOk(i); i++) { const [lx, ly] = onTop(X0 + i * W + GAP / 2, top(i), W - GAP, 0.5, 0.52); d += (d ? 'L' : 'M') + pt(lx, ly); }
  if (d.includes('L')) { P(s, d, 'fill:none;stroke:var(--q-line);stroke-width:4;opacity:0.55;stroke-linejoin:round'); P(s, d, `fill:none;stroke:${c('ok')};stroke-width:1.8;stroke-linejoin:round`); }

  // Crown fixture on the top level: a turned column holding the result window.
  const [cx, cy0] = onTop(X0 + 5 * W + GAP / 2, top(5), W - GAP, 0.5, 0.52), cy = cy0 - 34, res = st(5);
  const cap = G(s, { filter: u('ss') });
  R(cap, cx - 7, cy + 10, 14, cy0 - cy - 12, `fill:${u('Tr')};${QL}`);
  E(cap, cx, cy0 - 2, 12, 4.5, `fill:${u('Tf')};${QL}`);
  E(cap, cx, cy - 6, 17, 17, `fill:${u('Tt')};${QL}`);
  E(s, cx, cy - 6, 12, 12, `fill:${u('Sk')};${QL}`);
  E(s, cx, cy - 6, 12, 12, `fill:${u('Sw')}`);
  if (res === 'ok') gem(s, cx, cy - 6, 10);
  else if (res !== 'waiting') symbol(s, cx, cy - 6, res, 8);
}

export const render: Render = (host, r, t) => {
  const s = svg(host, 800, 540, false, 'Kademe · ' + r.title);
  grid(s, 800, 540, 'q1g'); qkit(s, 'q1'); header(s, 'KADEME · ENERGY LADDER');
  ladder(s, 'q1', r);
  for (let i = 0; i < 6; i++) txt(s, 30, top(i) + 4, 'E' + (i + 1), { size: 11, color: 'var(--core-ink-4)', anchor: 'end' });
  r.stages.forEach((st, i) => {
    const x = X0 + i * W + 4, y = top(i), quiet = !RAN.has(st.status), last = i === 5;
    const lx = last ? 680 : x, ly = last ? top(5) + 40 : y - 64;
    txt(s, lx, ly, st.n + ' ' + st.short, { size: 13, color: quiet ? 'var(--core-ink-3)' : 'var(--core-ink)', font: 'text' });
    symbol(s, lx + 5, ly + 14, st.status, 4.5);
    txt(s, lx + 14, ly + 18, t('core.s.' + st.status), { size: 11, color: ink(st.status) });
  });
  const m = svg(host, 300, 252, true, '');
  m.setAttribute('viewBox', '30 70 680 440');
  qkit(m, 'q1m'); ladder(m, 'q1m', r);
};
