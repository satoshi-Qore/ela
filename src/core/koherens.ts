// KOHERENS, the Coherence Chip (7C-36). A photonic processor in a titanium carrier: light enters
// through a fibre in a V-groove block and runs a sapphire waveguide through six interferometer nodes
// (each with a phase heater, an electrode and a wire bond) to a TO-can photodiode. The waveguide is
// lit only as far as execution really went: to the stop, the running stage, or — only when every
// stage succeeded — the photodiode, which then shows the result.
// ok: both arms carry light and the electrode carries the success inlay; running: only the segment
// entering the node moves; waiting: an unlit ridge; blocked: a metal absorber with a red edge cuts the
// waveguide before the node; failed: broken arms with scatter; skipped: a passivation lid; unknown:
// frosted glass. Nothing here is a measurement.
// Desktop: two rows that both read left to right (01–03, then 04–06). Mobile: a portrait chip, one
// vertical column of the same six nodes (the HTML stage list carries the text there).
import { c, E, el, G, grid, header, P, R, RAN, reachIndex, rim, stopIndex, stroke, svg, symbol, txt } from './draw.ts';
import type { CoreRecord, Render, Status } from './draw.ts';
import { ink, QL, qkit } from './quantum.ts';

const NX = [196, 344, 492], R1 = 176, R2 = 326, RET = 251, HALF = 40, MX = 150, MY = [118, 192, 266, 340, 414, 488], MH = 640;
const node = (i: number): [number, number] => [NX[i % 3], i < 3 ? R1 : R2];
type U = (n: string) => string;

/** How far execution really got along the waveguide (6 = the photodiode). */
function reach(r: CoreRecord): { stop: number; running: number; end: number; through: boolean } {
  const stop = stopIndex(r), running = r.stages.findIndex(x => x.status === 'running');
  const through = stop < 0 && running < 0 && reachIndex(r) === 4 && r.stages[5].status === 'ok';
  return { stop, running, through, end: stop >= 0 ? stop : running >= 0 ? running : through ? 6 : reachIndex(r) };
}

/** A waveguide segment as a raised ridge (cast shadow, lit edge, unlit core); lit when execution passed it. */
function guide(s: Element, d: string, lit: boolean, run: boolean): void {
  P(s, d, 'fill:none;stroke:var(--q-line);stroke-width:4;opacity:0.75;transform:translate(1px,1.4px)');
  P(s, d, 'fill:none;stroke:var(--q-ti-mid);stroke-width:3');
  P(s, d, 'fill:none;stroke:var(--q-sap-hi);stroke-width:0.9;opacity:0.4');
  if (!lit) return;
  P(s, d, 'fill:none;stroke:var(--beam-2);stroke-width:6;opacity:0.35');
  el('path', { d, class: run ? 'core-moving' : undefined, style: `fill:none;stroke:#fff;stroke-width:2;${run ? 'stroke-dasharray:6 4' : ''}` }, s);
}

/** One interferometer node in its own frame (flow along +x, electrode toward −y), placed by `tf`. */
/** `cut`: the absorber, only where execution really stopped (stages 01–05; a blocked result is not a cut). */
function nodeAt(s: Element, u: U, tf: string, s0: Status, lit: boolean, pad: number, cut: boolean): void {
  const g = G(s, { transform: tf });
  const arms = `M${-HALF} 0 C-22 0 -20 -15 0 -15 C20 -15 22 0 ${HALF} 0 C22 0 20 15 0 15 C-20 15 -22 0 ${-HALF} 0`;
  guide(g, arms, lit, false);
  if (s0 === 'running') P(g, arms, 'fill:none;stroke:var(--core-well);stroke-width:2;stroke-dasharray:4 6');
  // Phase heater on the arm, its lead to an electrode pad, a wire bond with ball bonds to the frame.
  R(g, -11, -17, 22, 4, `fill:${u('Tt')};${QL}`, 1);
  P(g, 'M8 -17 V-50', 'stroke:var(--q-ti-hi);stroke-width:1.2;opacity:0.85');
  R(g, -14, -60, 28, 10, `fill:${u('Tt')};${QL}`, 1.5);
  const bond = `M-9 -55 C-12 -80 -36 ${-pad + 10} -40 ${-pad}`;
  P(g, bond, 'fill:none;stroke:var(--q-line);stroke-width:1.8;opacity:0.5');
  P(g, bond, 'fill:none;stroke:var(--q-ti-hi);stroke-width:0.8;opacity:0.95');
  for (const [bx, by] of [[-9, -55], [-40, -pad]]) E(g, bx, by, 1.8, 1.8, `fill:${u('Tt')};${QL}`);
  R(g, -18, -64, 36, 18, `fill:none;${stroke(s0, 1)}`, 3);
  if (s0 === 'ok') P(g, 'M-11 -52.6 h22', `stroke:${c('ok')};stroke-width:1.8`);
  if (cut) R(G(g, { filter: u('ss') }), -HALF - 18, -12, 12, 24, `fill:${u('Tf')};stroke:${c('blocked')};stroke-width:2.2`, 2);
  if (s0 === 'failed') for (let k = 0; k < 4; k++) P(g, `M6 0 l${10 + k * 3} ${-12 + k * 8}`, `fill:none;${stroke('failed', 0.9)}`);
  if (s0 === 'skipped') { R(G(g, { filter: u('ss') }), -32, -20, 64, 40, `fill:${u('Tf')};${QL}`, 4); R(g, -32, -20, 64, 40, 'fill:var(--seal-overlay);opacity:0.4', 4); }
  if (s0 === 'unknown') R(g, -32, -20, 64, 40, 'fill:var(--seal-overlay)', 4);
}

/** Carrier, guard rim, die pocket and die zones; `zones` are the graphite electrode fields. */
function carrier(s: Element, u: U, x: number, y: number, w: number, h: number, zones: readonly (readonly number[])[]): void {
  const f = G(s, { filter: u('sh') });
  R(f, x, y + h - 10, w, 22, `fill:${u('Ts')};${QL}`, 6);
  R(f, x, y, w, h, `fill:${u('Gf')};${QL}`, 10);
  P(s, `M${x + 10} ${y + 0.9} h${w - 20} M${x + 0.9} ${y + 10} v${h - 20}`, 'stroke:#fff;stroke-width:1.2;opacity:0.8');
  P(s, `M${x + w - 1} ${y + 12} v${h - 22}`, 'stroke:var(--q-vio);stroke-width:1.3;opacity:0.8');
  for (const [sx, sy] of [[x + 18, y + 18], [x + w - 18, y + 18], [x + 18, y + h - 18], [x + w - 18, y + h - 18]]) { E(s, sx, sy, 6.5, 6.5, `fill:${u('Tt')};${QL}`); P(s, `M${sx - 4.5} ${sy} h9`, 'stroke:var(--q-line);stroke-width:1.5;opacity:0.85'); }
  const [px, py, pw, ph] = [x + 36, y + 28, w - 72, h - 56];
  R(s, px - 6, py - 6, pw + 12, ph + 12, `fill:${u('Tt')};${QL}`, 5);
  R(s, px, py, pw, ph, 'fill:var(--q-line)', 3);
  P(s, `M${px} ${py} h${pw} l-6 6 h${12 - pw} Z M${px} ${py} v${ph} l6 -6 v${12 - ph} Z`, 'fill:var(--q-ti-deep);opacity:0.9');
  P(s, `M${px} ${py + ph} h${pw} l-6 -6 h${12 - pw} Z M${px + pw} ${py} v${ph} l-6 -6 v${12 - ph} Z`, 'fill:var(--q-ti-mid)');
  const [dx, dy, dw, dh] = [px + 6, py + 6, pw - 12, ph - 12];
  R(s, dx, dy, dw, dh, `fill:${u('Sk')}`); R(s, dx, dy, dw, dh, `fill:${u('Sd')};opacity:0.3`); R(s, dx, dy, dw, dh, 'fill:var(--q-gr-lo);opacity:0.45');
  R(s, dx, dy, dw, dh, `fill:${u('Sw')};opacity:0.35`); R(s, dx, dy, dw, dh, `fill:${u('Sv')};opacity:0.32`);
  for (const [zx, zy, zw, zh] of zones) {
    R(s, zx, zy, zw, zh, `fill:${u('Gf')};opacity:0.9`);
    R(s, zx, zy, zw, zh, 'fill:none;stroke:var(--q-ti-hi);stroke-width:1;stroke-opacity:0.6');
  }
}

function diode(s: Element, u: U, x: number, y: number, show: Status | null): void {
  const pd = G(s, { filter: u('ss') });
  E(pd, x, y, 22, 22, `fill:${u('Tt')};${QL}`);
  E(pd, x, y, 16, 16, `fill:${u('Tf')};${QL}`);
  E(s, x, y, 10, 10, `fill:${u('Sk')};${QL}`);
  E(s, x, y, 10, 10, `fill:${u('Sw')}`);
  rim(s, x, y, 21, 21, '#fff', 1, 52, 18, 0.85);
  if (show) symbol(s, x, y, show, 7);
}

/** The fibre input: a fibre with a strain-relief boot in a V-groove block under a glass lid, along +x from `x0`. */
function fibre(s: Element, u: U, tf: string): void {
  const fb = G(s, { transform: tf, filter: u('ss') });
  P(fb, 'M0 -7 L22 -5 V5 L0 7 Z', `fill:${u('Ts')};${QL}`);
  R(fb, 20, -3.5, 40, 7, `fill:${u('Tf')};${QL}`, 3.5);
  R(fb, 56, -16, 34, 32, `fill:${u('Tf')};${QL}`, 3);
  R(fb, 60, -13, 26, 11, `fill:${u('Sk')};${QL}`, 2);
  R(fb, 60, -13, 26, 11, `fill:${u('Sw')}`, 2);
}

function desktop(s: Element, id: string, r: CoreRecord): void {
  const u: U = n => `url(#${id}${n})`, st = (i: number): Status => r.stages[i].status, q = reach(r);
  R(s, 0, 0, 800, 540, `fill:${u('Bg')}`);
  carrier(s, u, 34, 70, 640, 356, [[76, 104, 556, 34], [76, 362, 556, 34]]);
  for (let i = 0; i < 14; i++) for (const y of [80, 408]) R(s, 118 + i * 34, y - 4, 16, 8, `fill:${u('Tt')};${QL}`, 1);
  fibre(s, u, `translate(0 ${R1})`);
  // Segment k leads into node k (6 = the photodiode); the one into 04 runs the return channel.
  const seg = (k: number): string => k === 0 ? `M86 ${R1} H${NX[0] - HALF}`
    : k === 3 ? `M${NX[2] + HALF} ${R1} H576 C620 ${R1} 620 ${RET} 576 ${RET} H120 C76 ${RET} 76 ${R2} 120 ${R2} H${NX[0] - HALF}`
    : k === 6 ? `M${NX[2] + HALF} ${R2} H604` : `M${NX[(k % 3) - 1] + HALF} ${node(k)[1]} H${NX[k % 3] - HALF}`;
  for (let k = 0; k <= 6; k++) guide(s, seg(k), k <= q.end && k !== q.stop, k === q.running);
  for (const [x, y, dir] of [[130, R1, 1], [270, R1, 1], [418, R1, 1], [350, RET, -1], [270, R2, 1], [418, R2, 1]] as const) P(s, `M${x - 4 * dir} ${y - 7} l${5 * dir} 5 l${-5 * dir} 5`, 'fill:none;stroke:var(--q-sap-hi);stroke-width:1.1;opacity:0.75');
  for (let i = 0; i < 6; i++) {
    const [x, y] = node(i), s0 = st(i);
    nodeAt(s, u, `translate(${x} ${y})${i < 3 ? '' : ' scale(1 -1)'}`, s0, i <= q.end && (s0 === 'ok' || s0 === 'running'), i < 3 ? y - 80 : 408 - y, i === q.stop && s0 === 'blocked');
    if (s0 === 'unknown') symbol(s, x, y, 'unknown', 7);
  }
  diode(s, u, 626, R2, q.through ? st(5) : null);
}

function mobile(s: Element, id: string, r: CoreRecord): void {
  const u: U = n => `url(#${id}${n})`, st = (i: number): Status => r.stages[i].status, q = reach(r);
  R(s, 0, 0, 300, MH, `fill:${u('Bg')}`);
  // Portrait chip: electrode fields on the right, the waveguide down the centre, the fibre at the top.
  carrier(s, u, 16, 14, 268, 590, [[206, 48, 36, 522]]);
  for (const y of MY) R(s, 256, y - 48, 8, 16, `fill:${u('Tt')};${QL}`, 1);
  fibre(s, u, `translate(${MX} 0) rotate(90)`);
  const seg = (k: number): string => `M${MX} ${k ? MY[k - 1] + HALF : 90} V${k === 6 ? 534 : MY[k] - HALF}`;
  for (let k = 0; k <= 6; k++) guide(s, seg(k), k <= q.end && k !== q.stop, k === q.running);
  for (let i = 0; i < 6; i++) {
    const s0 = st(i);
    nodeAt(s, u, `translate(${MX} ${MY[i]}) rotate(90)`, s0, i <= q.end && (s0 === 'ok' || s0 === 'running'), 110, i === q.stop && s0 === 'blocked');
    // The stage index, engraved as dots beside the node.
    for (let j = 0; j <= i; j++) E(s, 70, MY[i] - 15 + j * 6, 1.8, 1.8, 'fill:var(--q-ti-hi);opacity:0.75');
    if (s0 === 'unknown') symbol(s, MX, MY[i], 'unknown', 7);
  }
  diode(s, u, MX, 556, q.through ? st(5) : null);
}

export const render: Render = (host, r, t) => {
  const s = svg(host, 800, 540, false, t('view.koherens') + ' · ' + r.title);
  grid(s, 800, 540, 'hg'); qkit(s, 'hd'); header(s, t('core.h.title'));
  desktop(s, 'hd', r);
  const q = reach(r);
  // Node labels sit on the die, on small plates in the panel's own colour, so they read in every theme.
  r.stages.forEach((st, i) => {
    const [x, y] = node(i), label = st.n + ' ' + st.short, ly = i < 3 ? y + 32 : y - 24, lw = label.length * 6.6 + 12;
    R(s, x - lw / 2, ly - 12, lw, 16, 'fill:var(--core-well);stroke:var(--core-line-2);stroke-width:0.8', 3);
    txt(s, x, ly, label, { size: 12, color: RAN.has(st.status) ? 'var(--core-ink)' : 'var(--core-ink-3)', font: 'text', anchor: 'middle' });
  });
  // What the signal did: where it stopped (above the carrier) and whether it arrived (by the diode).
  if (q.stop >= 0) { const sx = r.stages[q.stop]; txt(s, 40, 60, t(sx.status === 'blocked' ? 'core.o.stopped' : 'core.o.scattered', { stage: sx.name }), { size: 12, color: ink(sx.status) }); }
  txt(s, 738, 226, t('core.result'), { size: 11, color: 'var(--core-ink-3)', anchor: 'middle', spacing: 1 });
  txt(s, 738, 246, t('core.s.' + r.stages[5].status), { size: 12, color: ink(r.stages[5].status), anchor: 'middle' });
  txt(s, 738, 266, t(q.through ? 'core.o.arrived' : 'core.o.none'), { size: 11, color: q.through ? ink(r.stages[5].status) : 'var(--core-ink-3)', anchor: 'middle' });
  r.stages.forEach((st, i) => {
    const x = 40 + (i % 3) * 230, y = 470 + Math.floor(i / 3) * 34;
    symbol(s, x + 5, y - 4, st.status, 5);
    txt(s, x + 16, y, st.n + ' ' + st.name, { size: 13, color: RAN.has(st.status) ? 'var(--core-ink)' : 'var(--core-ink-3)', font: 'text' });
    txt(s, x + 16, y + 15, t('core.s.' + st.status), { size: 11, color: ink(st.status) });
  });
  const m = svg(host, 300, MH, true, '');
  qkit(m, 'hm'); mobile(m, 'hm', r);
};
