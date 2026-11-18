// Concept Q2 — KOHERENS, the Coherence Chip (prototype; nothing in the interface imports it).
// A photonic quantum chip in a titanium carrier, in plan view. Light enters through a fiber coupler
// and runs a sapphire waveguide through six interferometer nodes (Mach–Zehnder "eyes", each with a
// phase electrode wire-bonded to the frame) to a photodiode. Both rows read left to right (01–03,
// then 04–06), joined by a return channel; chevrons show the direction. The waveguide is lit only
// as far as execution really went. ok: both arms carry light, the electrode is inlaid in the success
// colour; running: only the arm entering the node moves; waiting: a dim etched trace; blocked: a
// metal absorber with a red edge cuts the waveguide before the node; failed: broken arms with
// scatter; skipped: a passivation lid; unknown: frosted glass. The photodiode shows the result only
// if the signal really arrived. Nothing here is a measurement.
import { c, E, el, G, grid, header, kit, OUT, P, R, RAN, reachIndex, rim, stopIndex, stroke, svg, symbol, txt } from '../draw.ts';
import type { CoreRecord, Render, Status } from '../draw.ts';

const NX = [196, 344, 492], R1 = 176, R2 = 326, RET = 251, HALF = 40;
const node = (i: number): [number, number] => [NX[i % 3], i < 3 ? R1 : R2];

/** The waveguide from the coupler to the photodiode, as segments: [path, the node index it leads into (6 = the diode)]. */
function segments(): [string, number][] {
  const seg: [string, number][] = [];
  for (let i = 0; i < 6; i++) {
    const [x, y] = node(i);
    let from: string;
    if (i === 0) from = `M66 ${R1} H${x - HALF}`;
    else if (i === 3) from = `M${NX[2] + HALF} ${R1} H576 C620 ${R1} 620 ${RET} 576 ${RET} H120 C76 ${RET} 76 ${R2} 120 ${R2} H${x - HALF}`;
    else from = `M${NX[(i % 3) - 1] + HALF} ${y} H${x - HALF}`;
    seg.push([from, i]);
  }
  seg.push([`M${NX[2] + HALF} ${R2} H612`, 6]);
  return seg;
}

function chip(s: Element, id: string, r: CoreRecord): void {
  const u = (n: string): string => `url(#${id}${n})`, st = (i: number): Status => r.stages[i].status;
  const stop = stopIndex(r), reach = reachIndex(r), running = r.stages.findIndex(x => x.status === 'running');
  const through = stop < 0 && running < 0 && reach === 4 && st(5) === 'ok';
  const end = stop >= 0 ? stop : running >= 0 ? running : through ? 6 : reach;
  R(s, 20, 50, 690, 410, `fill:${u('sp')}`);
  // Titanium carrier: frame with a lit chamfer, four screws, bond pads along the long edges.
  const f = G(s, { filter: u('sh') });
  R(f, 34, 70, 640, 360, `fill:${u('md')};${OUT}`, 10);
  P(s, 'M44 71 H664 M35 80 V420', 'stroke:var(--mat-spec);stroke-width:1.1;opacity:0.85');
  P(s, 'M673 82 V420', 'stroke:var(--mat-violet);stroke-width:1;opacity:0.6');
  for (const [x, y] of [[52, 88], [656, 88], [52, 412], [656, 412]]) { E(s, x, y, 6, 6, `fill:${u('mv')};${OUT}`); P(s, `M${x - 4} ${y} h8`, 'stroke:var(--mat-line);stroke-width:1.3;opacity:0.8'); }
  // Sapphire die in a recessed seat: dark substrate, glass sheen, an etched alignment grid.
  R(s, 70, 98, 568, 304, 'fill:var(--mat-line);opacity:0.8', 4);
  R(s, 72, 100, 564, 300, 'fill:var(--core-well)', 3);
  R(s, 72, 100, 564, 300, `fill:${u('gl')};opacity:0.35`, 3);
  P(s, 'M72 101 H636', 'stroke:var(--mat-shadow);stroke-width:3;opacity:0.45');
  for (let x = 100; x < 636; x += 28) P(s, `M${x} 104 v292`, 'stroke:var(--glass-edge);stroke-width:0.4;opacity:0.08');
  for (const [x, y] of [[86, 114], [622, 114], [86, 386], [622, 386]]) P(s, `M${x - 6} ${y} h12 M${x} ${y - 6} v12`, 'stroke:var(--glass-edge);stroke-width:0.7;opacity:0.5');
  for (let i = 0; i < 14; i++) for (const y of [80, 412]) R(s, 118 + i * 34, y - 4, 16, 8, `fill:${u('mv')};${OUT}`, 1);

  // Fiber coupler entering from the left edge.
  const fb = G(s, { filter: u('ss') });
  R(fb, 6, R1 - 9, 62, 18, `fill:${u('mv')};${OUT}`, 9);
  R(fb, 52, R1 - 12, 16, 24, `fill:${u('mv')};${OUT}`, 3);
  P(s, `M10 ${R1 - 7.2} H50`, 'stroke:var(--mat-spec);stroke-width:0.8;opacity:0.8');

  // Waveguide: etched everywhere, lit only up to where execution really got.
  segments().forEach(([d, k]) => {
    P(s, d, 'fill:none;stroke:var(--mat-line);stroke-width:3;opacity:0.55');
    P(s, d, 'fill:none;stroke:var(--glass-edge);stroke-width:1;opacity:0.25');
    if (k <= end && k !== stop) {
      const run = k === running;
      P(s, d, 'fill:none;stroke:var(--beam-2);stroke-width:4;opacity:0.18');
      el('path', { d, class: run ? 'core-moving' : undefined, style: `fill:none;stroke:var(--beam-1);stroke-width:1.5;${run ? 'stroke-dasharray:6 4' : ''}` }, s);
    }
  });
  // Direction chevrons on the straight runs.
  for (const [x, y, dir] of [[130, R1, 1], [270, R1, 1], [418, R1, 1], [350, RET, -1], [270, R2, 1], [418, R2, 1]] as const) P(s, `M${x - 4 * dir} ${y - 4} l${4 * dir} 4 l${-4 * dir} 4`, 'fill:none;stroke:var(--core-ink-4);stroke-width:1');

  for (let i = 0; i < 6; i++) {
    const [x, y] = node(i), s0 = st(i), lit = i <= end && (s0 === 'ok' || s0 === 'running');
    const arms = `M${x - HALF} ${y} C${x - 22} ${y} ${x - 20} ${y - 15} ${x} ${y - 15} C${x + 20} ${y - 15} ${x + 22} ${y} ${x + HALF} ${y} C${x + 22} ${y} ${x + 20} ${y + 15} ${x} ${y + 15} C${x - 20} ${y + 15} ${x - 22} ${y} ${x - HALF} ${y}`;
    P(s, arms, 'fill:none;stroke:var(--mat-line);stroke-width:3;opacity:0.55');
    P(s, arms, `fill:none;stroke:${lit ? 'var(--beam-1)' : 'var(--glass-edge)'};stroke-width:${lit ? 1.5 : 1};opacity:${lit ? 1 : 0.25};${s0 === 'running' ? 'stroke-dasharray:6 4' : ''}`);
    // Phase electrode on the upper arm, wire-bonded to the frame.
    // Row 1 has its electrode above the node (bonded to the top pads), row 2 below (bonded to the bottom pads).
    const up = y < RET, py = up ? y - 24 : y + 24, pad = up ? 80 : 412;
    R(s, x - 14, py - 4, 28, 8, `fill:${u('mv')};${OUT}`, 1.5);
    P(s, `M${x - 10} ${py} C${x - 10} ${(py + pad) / 2} ${x - 34} ${(py + pad) / 2} ${x - 40} ${pad + (up ? 4 : -4)}`, 'fill:none;stroke:var(--mat-hi);stroke-width:0.7;opacity:0.7');
    R(s, x - 18, py - 8, 36, 16, `fill:none;${stroke(s0, 1)}`, 3);
    if (s0 === 'ok') P(s, `M${x - 12} ${py + 2.6} h24`, `stroke:${c('ok')};stroke-width:1.8`);
    if (s0 === 'blocked' && i < 5) {
      R(G(s, { filter: u('ss') }), x - HALF - 18, y - 11, 12, 22, `fill:${u('md')};stroke:${c('blocked')};stroke-width:2.2`, 2);
    }
    if (s0 === 'failed') for (let k = 0; k < 4; k++) P(s, `M${x + 6} ${y} l${10 + k * 3} ${-12 + k * 8}`, `fill:none;${stroke('failed', 0.9)}`);
    if (s0 === 'skipped') { R(s, x - 32, y - 20, 64, 40, `fill:${u('md')};${OUT}`, 4); R(s, x - 32, y - 20, 64, 40, 'fill:var(--seal-overlay);opacity:0.5', 4); }
    if (s0 === 'unknown') { R(s, x - 32, y - 20, 64, 40, 'fill:var(--seal-overlay)', 4); symbol(s, x, y, 'unknown', 7); }
  }
  // Photodiode at the end of the waveguide: a recessed sapphire window; lit only if the signal arrived.
  const res = st(5), dx = 626, dy = R2;
  R(G(s, { filter: u('ss') }), dx - 22, dy - 26, 44, 52, `fill:${u('mv')};${OUT}`, 5);
  R(s, dx - 14, dy - 16, 28, 32, 'fill:var(--core-well);stroke:var(--mat-line);stroke-width:1', 3);
  R(s, dx - 14, dy - 16, 28, 32, `fill:${u('gl')};opacity:0.6`, 3);
  rim(s, dx, dy, 15, 17, 'var(--mat-spec)', 0.8, 55, 15, 0.7);
  if (through) symbol(s, dx, dy, res, 8);
}

export const render: Render = (host, r, t) => {
  const s = svg(host, 800, 540, false, 'Koherens · ' + r.title);
  grid(s, 800, 540, 'q2g'); kit(s, 'q2'); header(s, 'KOHERENS · COHERENCE CHIP');
  chip(s, 'q2', r);
  r.stages.forEach((st, i) => {
    const [x, y] = node(i), quiet = !RAN.has(st.status);
    txt(s, x, i < 3 ? y + 32 : y - 24, st.n + ' ' + st.short, { size: 12, color: quiet ? 'var(--core-ink-3)' : 'var(--core-ink)', font: 'text', anchor: 'middle' });
  });
  // The stage list below the carrier, in reading order.
  r.stages.forEach((st, i) => {
    const x = 40 + (i % 3) * 230, y = 470 + Math.floor(i / 3) * 34;
    symbol(s, x + 5, y - 4, st.status, 5);
    txt(s, x + 16, y, st.n + ' ' + st.name, { size: 13, color: RAN.has(st.status) ? 'var(--core-ink)' : 'var(--core-ink-3)', font: 'text' });
    txt(s, x + 16, y + 15, t('core.s.' + st.status), { size: 11, color: c(st.status) });
  });
  txt(s, 724, 230, 'RESULT', { size: 11, color: 'var(--core-ink-3)', anchor: 'middle', spacing: 1 });
  txt(s, 724, 250, t('core.s.' + r.stages[5].status), { size: 12, color: c(r.stages[5].status), anchor: 'middle' });
  const m = svg(host, 300, 186, true, '');
  m.setAttribute('viewBox', '0 60 690 428');
  kit(m, 'q2m'); chip(m, 'q2m', r);
};
