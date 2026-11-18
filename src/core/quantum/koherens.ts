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
import { ink, QL, qkit } from './optics.ts';

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
  seg.push([`M${NX[2] + HALF} ${R2} H604`, 6]);
  return seg;
}

function chip(s: Element, id: string, r: CoreRecord): void {
  const u = (n: string): string => `url(#${id}${n})`, st = (i: number): Status => r.stages[i].status;
  const stop = stopIndex(r), reach = reachIndex(r), running = r.stages.findIndex(x => x.status === 'running');
  const through = stop < 0 && running < 0 && reach === 4 && st(5) === 'ok';
  const end = stop >= 0 ? stop : running >= 0 ? running : through ? 6 : reach;
  R(s, 0, 0, 800, 540, `fill:${u('Bg')}`);
  // Titanium carrier with real thickness: a graphite top, a lit chamfer, a shaded front face, four screws.
  const f = G(s, { filter: u('sh') });
  R(f, 34, 416, 640, 22, `fill:${u('Ts')};${QL}`, 6);
  R(f, 34, 70, 640, 356, `fill:${u('Gf')};${QL}`, 10);
  P(s, 'M44 70.9 H664 M34.9 80 V416', 'stroke:#fff;stroke-width:1.2;opacity:0.8');
  P(s, 'M673 82 V418', 'stroke:var(--q-vio);stroke-width:1.3;opacity:0.8');
  for (const [x, y] of [[52, 88], [656, 88], [52, 408], [656, 408]]) { E(s, x, y, 6.5, 6.5, `fill:${u('Tt')};${QL}`); P(s, `M${x - 4.5} ${y} h9`, 'stroke:var(--q-line);stroke-width:1.5;opacity:0.85'); }
  for (let i = 0; i < 14; i++) for (const y of [80, 408]) R(s, 118 + i * 34, y - 4, 16, 8, `fill:${u('Tt')};${QL}`, 1);
  // A machined titanium guard rim, then the die pocket: shaded upper and left walls, lit lower and right ones.
  R(s, 64, 92, 580, 316, `fill:${u('Tt')};${QL}`, 5);
  R(s, 70, 98, 568, 304, 'fill:var(--q-line)', 3);
  P(s, 'M70 98 h568 l-6 6 h-556 Z M70 98 v304 l6 -6 v-292 Z', 'fill:var(--q-ti-deep);opacity:0.9');
  P(s, 'M70 402 h568 l-6 -6 h-556 Z M638 98 v304 l-6 -6 v-292 Z', 'fill:var(--q-ti-mid)');
  // The die: a dark sapphire wafer. A central optical zone (sapphire, one specular band, a restrained
  // violet sheen) between two graphite electrode fields, separated by titanium guard lines.
  const dz = (y: number, h: number, f2: string): SVGElement => R(s, 76, y, 556, h, f2);
  dz(104, 292, `fill:${u('Sk')}`); dz(104, 292, `fill:${u('Sd')};opacity:0.3`); dz(104, 292, 'fill:var(--q-gr-lo);opacity:0.45');
  dz(142, 216, `fill:${u('Sw')};opacity:0.35`); dz(142, 216, `fill:${u('Sv')};opacity:0.32`);
  for (const [y, h] of [[104, 34], [362, 34]]) dz(y, h, `fill:${u('Gf')};opacity:0.9`);
  P(s, 'M76 139 H632 M76 361 H632', 'stroke:var(--q-ti-hi);stroke-width:1.2;opacity:0.7');
  P(s, 'M76 140.4 H632 M76 362.4 H632', 'stroke:var(--q-line);stroke-width:1;opacity:0.6');
  for (let x = 100; x < 632; x += 28) P(s, `M${x} 144 v212`, 'stroke:var(--q-sap-hi);stroke-width:0.4;opacity:0.12');

  // Fiber input: a fibre with a strain-relief boot, seated in a V-groove block under a glass lid.
  const fb = G(s, { filter: u('ss') });
  P(fb, `M0 ${R1 - 7} L22 ${R1 - 5} V${R1 + 5} L0 ${R1 + 7} Z`, `fill:${u('Ts')};${QL}`);
  R(fb, 20, R1 - 3.5, 40, 7, `fill:${u('Tf')};${QL}`, 3.5);
  R(fb, 56, R1 - 16, 34, 32, `fill:${u('Tf')};${QL}`, 3);
  R(fb, 60, R1 - 13, 26, 11, `fill:${u('Sk')};${QL}`, 2);
  R(fb, 60, R1 - 13, 26, 11, `fill:${u('Sw')}`, 2);
  P(s, `M22 ${R1 - 2} H58`, 'stroke:#fff;stroke-width:0.8;opacity:0.85');

  // Waveguides: raised ridges (a cast shadow, a lit edge, an unlit core), lit only as far as execution
  // really got. Execution light is white over a blue glow; decoration stays thin and cyan.
  const ridge = (d: string): void => {
    P(s, d, 'fill:none;stroke:var(--q-line);stroke-width:4;opacity:0.75;transform:translate(1px,1.4px)');
    P(s, d, 'fill:none;stroke:var(--q-ti-mid);stroke-width:3');
    P(s, d, 'fill:none;stroke:var(--q-sap-hi);stroke-width:0.9;opacity:0.4');
  };
  segments().forEach(([d, k]) => {
    ridge(d.replace('M66 ', 'M90 '));
    if (k <= end && k !== stop) {
      const run = k === running, dd = d.replace('M66 ', 'M86 ');
      P(s, dd, 'fill:none;stroke:var(--beam-2);stroke-width:6;opacity:0.35');
      el('path', { d: dd, class: run ? 'core-moving' : undefined, style: `fill:none;stroke:#fff;stroke-width:2;${run ? 'stroke-dasharray:6 4' : ''}` }, s);
    }
  });
  for (const [x, y, dir] of [[130, R1, 1], [270, R1, 1], [418, R1, 1], [350, RET, -1], [270, R2, 1], [418, R2, 1]] as const) P(s, `M${x - 4 * dir} ${y - 7} l${5 * dir} 5 l${-5 * dir} 5`, 'fill:none;stroke:var(--q-sap-hi);stroke-width:1.1;opacity:0.75');

  for (let i = 0; i < 6; i++) {
    const [x, y] = node(i), s0 = st(i), lit = i <= end && (s0 === 'ok' || s0 === 'running');
    const arms = `M${x - HALF} ${y} C${x - 22} ${y} ${x - 20} ${y - 15} ${x} ${y - 15} C${x + 20} ${y - 15} ${x + 22} ${y} ${x + HALF} ${y} C${x + 22} ${y} ${x + 20} ${y + 15} ${x} ${y + 15} C${x - 20} ${y + 15} ${x - 22} ${y} ${x - HALF} ${y}`;
    ridge(arms);
    if (lit) {
      P(s, arms, 'fill:none;stroke:var(--beam-2);stroke-width:6;opacity:0.35');
      P(s, arms, `fill:none;stroke:#fff;stroke-width:2;${s0 === 'running' ? 'stroke-dasharray:6 4' : ''}`);
    }
    // Phase heater on one arm, its lead to an electrode pad in the graphite field, a wire bond with
    // ball bonds to the frame. Row 1 uses the upper field, row 2 the lower one.
    const up = y < RET, hy = up ? y - 17 : y + 13, py = up ? 121 : 379, pad = up ? 80 : 408;
    R(s, x - 11, hy, 22, 4, `fill:${u('Tt')};${QL}`, 1);
    P(s, `M${x + 8} ${up ? hy : hy + 4} V${up ? py + 5 : py - 5}`, 'stroke:var(--q-ti-hi);stroke-width:1.2;opacity:0.85');
    R(s, x - 14, py - 5, 28, 10, `fill:${u('Tt')};${QL}`, 1.5);
    const bond = `M${x - 9} ${py} C${x - 12} ${up ? py - 26 : py + 26} ${x - 36} ${up ? pad + 10 : pad - 10} ${x - 40} ${pad}`;
    P(s, bond, 'fill:none;stroke:var(--q-line);stroke-width:1.8;opacity:0.5');
    P(s, bond, 'fill:none;stroke:var(--q-ti-hi);stroke-width:0.8;opacity:0.95');
    for (const [bx, by] of [[x - 9, py], [x - 40, pad]]) E(s, bx, by, 1.8, 1.8, `fill:${u('Tt')};${QL}`);
    R(s, x - 18, py - 9, 36, 18, `fill:none;${stroke(s0, 1)}`, 3);
    if (s0 === 'ok') P(s, `M${x - 11} ${py + 2.4} h22`, `stroke:${c('ok')};stroke-width:1.8`);
    if (s0 === 'blocked' && i < 5) R(G(s, { filter: u('ss') }), x - HALF - 18, y - 12, 12, 24, `fill:${u('Tf')};stroke:${c('blocked')};stroke-width:2.2`, 2);
    if (s0 === 'failed') for (let k = 0; k < 4; k++) P(s, `M${x + 6} ${y} l${10 + k * 3} ${-12 + k * 8}`, `fill:none;${stroke('failed', 0.9)}`);
    if (s0 === 'skipped') { R(G(s, { filter: u('ss') }), x - 32, y - 20, 64, 40, `fill:${u('Tf')};${QL}`, 4); R(s, x - 32, y - 20, 64, 40, 'fill:var(--seal-overlay);opacity:0.4', 4); }
    if (s0 === 'unknown') { R(s, x - 32, y - 20, 64, 40, 'fill:var(--seal-overlay)', 4); symbol(s, x, y, 'unknown', 7); }
  }
  // Photodiode: a TO-can seen from above (flange, cap, sapphire window); it shows the result only if
  // the signal really arrived.
  const res = st(5), dx = 626, dy = R2, pd = G(s, { filter: u('ss') });
  E(pd, dx, dy, 22, 22, `fill:${u('Tt')};${QL}`);
  E(pd, dx, dy, 16, 16, `fill:${u('Tf')};${QL}`);
  E(s, dx, dy, 10, 10, `fill:${u('Sk')};${QL}`);
  E(s, dx, dy, 10, 10, `fill:${u('Sw')}`);
  rim(s, dx, dy, 21, 21, '#fff', 1, 52, 18, 0.85);
  if (through) symbol(s, dx, dy, res, 7);
}

export const render: Render = (host, r, t) => {
  const s = svg(host, 800, 540, false, 'Koherens · ' + r.title);
  grid(s, 800, 540, 'q2g'); qkit(s, 'q2'); header(s, 'KOHERENS · COHERENCE CHIP');
  chip(s, 'q2', r);
  r.stages.forEach((st, i) => {
    const [x, y] = node(i), quiet = !RAN.has(st.status);
    // Node labels sit on the die, so they get a dark silkscreen plate and light ink in every theme.
    const label = st.n + ' ' + st.short, ly = i < 3 ? y + 32 : y - 24, lw = label.length * 6.6 + 12;
    R(s, x - lw / 2, ly - 12, lw, 16, 'fill:var(--q-sap-core);opacity:0.85', 3);
    txt(s, x, ly, label, { size: 12, color: quiet ? 'var(--q-ti)' : 'var(--q-ti-hi)', font: 'text', anchor: 'middle' });
  });
  // The stage list below the carrier, in reading order.
  r.stages.forEach((st, i) => {
    const x = 40 + (i % 3) * 230, y = 470 + Math.floor(i / 3) * 34;
    symbol(s, x + 5, y - 4, st.status, 5);
    txt(s, x + 16, y, st.n + ' ' + st.name, { size: 13, color: RAN.has(st.status) ? 'var(--core-ink)' : 'var(--core-ink-3)', font: 'text' });
    txt(s, x + 16, y + 15, t('core.s.' + st.status), { size: 11, color: ink(st.status) });
  });
  txt(s, 724, 230, 'RESULT', { size: 11, color: 'var(--core-ink-3)', anchor: 'middle', spacing: 1 });
  txt(s, 724, 250, t('core.s.' + r.stages[5].status), { size: 12, color: ink(r.stages[5].status), anchor: 'middle' });
  const m = svg(host, 300, 186, true, '');
  m.setAttribute('viewBox', '0 60 690 428');
  qkit(m, 'q2m'); chip(m, 'q2m', r);
};
