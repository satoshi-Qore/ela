// Concept Q1 — KADEME, the Energy Ladder (prototype; nothing in the interface imports it).
// The quantum energy-level diagram built as one machined titanium monolith: six levels are six steps
// rising left to right along an engraved energy axis. Each step's top face carries a recessed
// sapphire level cell; its front edge carries the state inlay. A sapphire excitation filament joins
// the cells of steps that really succeeded, and only those. ok: a sealed cell with a raised crystal;
// running: a half-lit cell and the only moving inlay; waiting: an empty recess; blocked: a red
// barrier blade on the step edge (the climb stops there); failed: a fractured cell; skipped: a
// titanium cover plate; unknown: a frosted cell. The capstone on the top level shows the result: the
// faceted gem only on a real success, the state mark otherwise.
import { c, E, el, G, grid, header, kit, OUT, P, R, RAN, stroke, svg, symbol, txt } from '../draw.ts';
import type { CoreRecord, Render, Status } from '../draw.ts';

const X0 = 74, W = 84, S = 44, GROUND = 452, DX = 58, DY = -34, BASE = 22;
const top = (i: number): number => GROUND - BASE - (i + 1) * S;
const pt = (x: number, y: number): string => `${x.toFixed(1)} ${y.toFixed(1)}`;

/** The faceted gem (ELA's mark) lit from the upper left, for a real success only. */
function gem(s: Element, x: number, y: number, r: number): void {
  const v = [[0, -r], [r, 0], [0, r], [-r, 0]], col = 'var(--s-result)';
  [0.72, 0.3, 0.5, 0.95].forEach((o, k) => { const [p, q] = [v[k], v[(k + 1) % 4]]; P(s, `M${x} ${y} L${x + p[0]} ${y + p[1]} L${x + q[0]} ${y + q[1]} Z`, `fill:${col};opacity:${o}`); });
  P(s, `M${x} ${y - r} L${x + r} ${y} L${x} ${y + r} L${x - r} ${y} Z`, `fill:none;stroke:${col};stroke-width:1`);
}

function ladder(s: Element, id: string, r: CoreRecord): void {
  const u = (n: string): string => `url(#${id}${n})`, st = (i: number): Status => r.stages[i].status;
  R(s, 30, 50, 700, 430, `fill:${u('sp')}`);
  // Energy axis: an engraved scale on the left with one tick per level.
  P(s, `M42 ${GROUND - BASE} V${top(5) - 10}`, 'stroke:var(--core-ink-4);stroke-width:0.8');
  for (let i = 0; i < 6; i++) P(s, `M36 ${top(i)} h12`, 'stroke:var(--core-ink-4);stroke-width:0.8');
  // Base slab under the monolith.
  const b = G(s, { filter: u('sh') });
  P(b, `M${X0 - 24} ${GROUND} h${6 * W + 48} l${DX} ${DY} h${-(6 * W + 48)} Z`, `fill:${u('md')};${OUT}`);
  R(b, X0 - 24, GROUND, 6 * W + 48, 14, `fill:${u('mv')};${OUT}`);
  P(s, `M${X0 - 22} ${GROUND + 0.8} h${6 * W + 44}`, 'stroke:var(--mat-spec);stroke-width:1;opacity:0.85');

  // The monolith, left to right, so each taller step covers the right face of the one before it.
  const reachedOk = (i: number): boolean => st(i) === 'ok' && r.stages.slice(0, i).every(x => x.status === 'ok');
  const m = G(s, { filter: u('sh') });
  for (let i = 0; i < 6; i++) {
    const x = X0 + i * W, y = top(i), x1 = x + W;
    P(m, `M${pt(x1, y)} l${DX} ${DY} V${GROUND + DY} l${-DX} ${-DY} Z`, `fill:var(--mat-lo);${OUT}`);
    P(m, `M${pt(x, y)} h${W} l${DX} ${DY} h${-W} Z`, `fill:${u('md')};${OUT}`);
    R(m, x, y, W, GROUND - y, `fill:${u('mv')};${OUT}`);
  }
  for (let i = 0; i < 6; i++) {
    const x = X0 + i * W, y = top(i), s0 = st(i);
    // Front-face detail: a machined index groove; the nosing (front-top edge) has a polished chamfer.
    P(s, `M${x + 8} ${y + 16} h${W - 16}`, 'stroke:var(--mat-line);stroke-width:1.1;opacity:0.55');
    P(s, `M${x + 8} ${y + 17.2} h${W - 16}`, 'stroke:var(--mat-spec);stroke-width:0.6;opacity:0.4');
    P(s, `M${x + 1} ${y + 1} h${W - 2}`, 'stroke:var(--mat-spec);stroke-width:1.1;opacity:0.9');
    P(s, `M${x + 1} ${y + 6} h${W - 2}`, `fill:none;${stroke(s0, 1.6)}`);
    // The level cell: a recessed sapphire window inset in the top face.
    const k = 0.2, cx0 = x + W * k + DX * k, cy0 = y + DY * k, cw = W * (1 - 2 * k), cd = 1 - 2 * k;
    const cell = `M${pt(cx0, cy0)} h${cw} l${DX * cd} ${DY * cd} h${-cw} Z`;
    const cc = [cx0 + cw / 2 + (DX * cd) / 2, cy0 + (DY * cd) / 2];
    P(s, cell, 'fill:var(--mat-line);opacity:0.8');
    P(s, `M${pt(cx0, cy0)} l${DX * cd} ${DY * cd}`, 'stroke:var(--mat-shadow);stroke-width:2;opacity:0.5');
    P(s, `M${pt(cx0 + 1, cy0 - 1)} h${cw - 2}`, 'stroke:var(--mat-spec);stroke-width:0.7;opacity:0.6');
    if (s0 === 'skipped') { P(s, cell, `fill:${u('md')};${OUT}`); P(s, cell, 'fill:var(--seal-overlay);opacity:0.5'); continue; }
    if (s0 !== 'waiting') { P(s, cell, 'fill:var(--core-well)'); P(s, cell, `fill:${u('gl')};opacity:${s0 === 'running' ? 0.55 : 1};stroke:var(--glass-edge);stroke-width:0.6;stroke-opacity:0.5`); }
    if (s0 === 'ok') {
      // The level crystal: a small raised prism seated in the cell.
      const [qx, qy] = cc;
      P(s, `M${qx - 9} ${qy + 3} L${qx} ${qy - 12} L${qx + 9} ${qy + 3} L${qx} ${qy + 7} Z`, 'fill:var(--mat-shadow);opacity:0.35;transform:translate(2px,2px)');
      P(s, `M${qx - 9} ${qy + 3} L${qx} ${qy - 12} L${qx} ${qy + 7} Z`, 'fill:var(--glass-edge);opacity:0.85');
      P(s, `M${qx} ${qy - 12} L${qx + 9} ${qy + 3} L${qx} ${qy + 7} Z`, 'fill:var(--glass-1);opacity:0.75');
      P(s, `M${qx - 9} ${qy + 3} L${qx} ${qy - 12} L${qx + 9} ${qy + 3} L${qx} ${qy + 7} Z`, `fill:none;stroke:${c('ok')};stroke-width:0.9`);
    }
    if (s0 === 'running') el('line', { x1: x + 4, y1: y + 6, x2: x + W - 4, y2: y + 6, class: 'core-moving', style: `stroke:${c('running')};stroke-width:1.8;stroke-dasharray:6 4` }, s);
    if (s0 === 'failed') P(s, `M${cc[0] - 16} ${cc[1] - 4} l8 5 l6 -6 l7 7 l9 -3`, `fill:none;${stroke('failed', 1.4)}`);
    if (s0 === 'unknown') { P(s, cell, 'fill:var(--seal-overlay)'); symbol(s, cc[0], cc[1], 'unknown', 6); }
    if (s0 === 'blocked' && i < 5) {
      // Barrier blade: a machined plate standing on the step edge, red-edged.
      P(s, `M${x + 6} ${y} V${y - 30} l${W - 12} 0 V${y} Z`, `fill:${u('md')};stroke:${c('blocked')};stroke-width:2.2;stroke-linejoin:round`);
      P(s, `M${x + 9} ${y - 27.5} h${W - 18}`, 'stroke:var(--mat-spec);stroke-width:0.8;opacity:0.8');
    }
  }
  // Excitation filament: cell to cell, only across steps that really succeeded in order.
  let d = '';
  for (let i = 0; i < 6 && reachedOk(i); i++) {
    const x = X0 + i * W + W / 2 + DX / 2, y = top(i) + DY / 2;
    d += (d ? 'L' : 'M') + pt(x, y);
  }
  if (d.includes('L')) P(s, d, `fill:none;stroke:${c('ok')};stroke-width:1.2;opacity:0.75;stroke-linejoin:round`);

  // Capstone on the top level: the result.
  const cx = X0 + 5 * W + W / 2 + DX / 2, cy = top(5) + DY / 2 - 30, res = st(5);
  const cap = G(s, { filter: u('ss') });
  P(cap, `M${cx - 22} ${cy + 22} L${cx - 14} ${cy + 6} H${cx + 14} L${cx + 22} ${cy + 22} Z`, `fill:${u('mv')};${OUT}`);
  E(cap, cx, cy - 6, 16, 16, `fill:var(--core-well);${OUT}`);
  E(s, cx, cy - 6, 16, 16, `fill:${u('gl')};opacity:0.5`);
  if (res === 'ok') gem(s, cx, cy - 6, 10);
  else if (res !== 'waiting') symbol(s, cx, cy - 6, res, 8);
}

export const render: Render = (host, r, t) => {
  const s = svg(host, 800, 540, false, 'Kademe · ' + r.title);
  grid(s, 800, 540, 'q1g'); kit(s, 'q1'); header(s, 'KADEME · ENERGY LADDER');
  ladder(s, 'q1', r);
  for (let i = 0; i < 6; i++) txt(s, 30, top(i) + 4, 'E' + (i + 1), { size: 11, color: 'var(--core-ink-4)', anchor: 'end' });
  r.stages.forEach((st, i) => {
    const x = X0 + i * W + 4, y = top(i), quiet = !RAN.has(st.status), last = i === 5;
    const lx = last ? 680 : x, ly = last ? top(5) + 40 : y - 64;
    txt(s, lx, ly, st.n + ' ' + st.short, { size: 13, color: quiet ? 'var(--core-ink-3)' : 'var(--core-ink)', font: 'text' });
    symbol(s, lx + 5, ly + 14, st.status, 4.5);
    txt(s, lx + 14, ly + 18, t('core.s.' + st.status), { size: 11, color: c(st.status) });
  });
  const m = svg(host, 300, 252, true, '');
  m.setAttribute('viewBox', '30 90 680 420');
  kit(m, 'q1m'); ladder(m, 'q1m', r);
};
