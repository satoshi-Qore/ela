// Concept F — Drum (prototype, not wired into the interface). A pinned program drum, the mechanical
// memory of automata and sequencers: a lying steel cylinder with six circumferential tracks (one per
// stage) read by a steel comb of six tines. Each track's pin pattern is that stage's own 3-bit
// identifier (01 = 001 … 06 = 110), a fixed code, not data. A stage that succeeded has its pins set
// (raised studs) and its tine tipped with the success inlay; a waiting track shows empty dimples; a
// running track's tine carries the only moving trace; a blocked tine is jammed by a red wedge; a
// failed tine is snapped; a skipped track is covered by a sleeve; an unknown track is fogged. The
// result is a drop flag in a register housing beside the drum.
import { c, E, el, G, grid, header, kit, OUT, P, R, RAN, rim, stroke, svg, symbol, txt } from '../draw.ts';
import type { CoreRecord, Render, Status } from '../draw.ts';

const XS = [160, 240, 320, 400, 480, 560];
const X0 = 100, X1 = 600, CY = 212, RY = 92, COMB = 384, TIP = CY + RY + 6;
const BITS = [-56, 0, 56];

function machine(s: Element, id: string, r: CoreRecord): void {
  const u = (n: string): string => `url(#${id}${n})`, st = (i: number): Status => r.stages[i].status;
  R(s, 40, 70, 720, 360, `fill:${u('sp')}`);
  // Base plate, bearing pedestals, the drum (a lying cylinder lit from above) and its right end cap.
  const base = G(s, { filter: u('sh') });
  R(base, 64, COMB + 4, 560, 26, `fill:${u('mv')};${OUT}`, 4);
  for (const x of [X0 - 30, X1 + 4]) R(base, x, CY - 12, 26, COMB + 4 - CY + 12, `fill:${u('mh')};${OUT}`, 3);
  P(s, `M68 ${COMB + 5} H620`, 'stroke:var(--mat-spec);stroke-width:1;opacity:0.8');
  const d = G(s, { filter: u('sh') });
  R(d, X0, CY - RY, X1 - X0, RY * 2, `fill:${u('mv')};${OUT}`, 6);
  E(d, X1, CY, 24, RY, `fill:${u('md')};${OUT}`);
  rim(d, X1, CY, 23.4, RY - 0.6, 'var(--mat-spec)', 1.1, 52, 20, 0.85);
  rim(d, X1, CY, 23.4, RY - 0.6, 'var(--mat-violet)', 1, 2, 18, 0.75);
  E(s, X1, CY, 9, 30, `fill:${u('mv')};${OUT}`);
  E(s, X0 - 17, CY, 8, 8, `fill:${u('md')};${OUT}`);
  // A narrow reflected band low on the drum, so the cylinder reads round, not flat.
  P(s, `M${X0 + 4} ${CY + RY - 10} H${X1 - 6}`, 'stroke:var(--mat-violet);stroke-width:1.2;opacity:0.45');

  XS.forEach((x, i) => {
    const s0 = st(i), code = i + 1;
    // Track: two machined grooves around the drum; their line style is the stage's state.
    for (const dx of [-26, 26]) {
      P(s, `M${x + dx} ${CY - RY + 2} V${CY + RY - 2}`, 'stroke:var(--mat-line);stroke-width:1.4;opacity:0.7');
      P(s, `M${x + dx + 1.2} ${CY - RY + 2} V${CY + RY - 2}`, 'stroke:var(--mat-spec);stroke-width:0.6;opacity:0.45');
    }
    P(s, `M${x - 30} ${CY - RY - 4} H${x + 30}`, `fill:none;${stroke(s0, 1.2)}`);
    // Pins: raised studs when recorded, empty dimples when not; foreshortened toward the drum's edges.
    BITS.forEach((dy, b) => {
      if (!(code & (4 >> b))) return;
      const k = Math.sqrt(1 - (dy / RY) ** 2), y = CY + dy;
      if (s0 === 'ok') {
        E(s, x + 1.5, y + 3 * k, 7, 6 * k, 'fill:var(--mat-shadow);opacity:var(--mat-shadow-o)');
        E(s, x, y, 7, 6.4 * k, `fill:${u('mh')};${OUT}`);
        E(s, x - 2.2, y - 2 * k, 2.2, 1.6 * k, 'fill:var(--mat-spec);opacity:0.9');
      } else {
        E(s, x, y, 5.5, 4.8 * k, 'fill:var(--mat-line);opacity:0.6');
        E(s, x + 0.8, y + 1 * k, 5, 4.2 * k, 'fill:none;stroke:var(--mat-spec);stroke-width:0.6;opacity:0.35');
      }
    });
    if (s0 === 'skipped') { R(s, x - 26, CY - RY, 52, RY * 2, `fill:${u('mv')};${OUT}`); R(s, x - 26, CY - RY, 52, RY * 2, 'fill:var(--seal-overlay);opacity:0.55'); }
    if (s0 === 'unknown') { R(s, x - 26, CY - RY, 52, RY * 2, 'fill:var(--seal-overlay)'); symbol(s, x, CY, 'unknown', 8); }
    if (s0 === 'waiting') R(s, x - 26, CY - RY, 52, RY * 2, 'fill:var(--seal-overlay);opacity:0.35');

    // Tine: a tapered steel reed from the comb up to the drum.
    const t = G(s, { filter: u('ss') });
    if (s0 === 'failed') {
      P(t, `M${x - 6} ${COMB} L${x - 4} ${TIP + 34} l3 -4 l2 5 l3 -4 L${x + 6} ${COMB} Z`, `fill:${u('mh')};${OUT}`);
      P(t, `M${x - 3} ${TIP + 22} l3 -4 l2 5 l2 -3 L${x + 2.5} ${TIP} L${x - 2.5} ${TIP} Z`, `fill:${u('mh')};${OUT};transform:translate(3px,-4px) rotate(8deg);transform-box:fill-box`);
      P(s, `M${x - 10} ${TIP + 30} h20`, `fill:none;${stroke('failed', 1.4)}`);
    } else P(t, `M${x - 6} ${COMB} L${x - 2.5} ${TIP} L${x + 2.5} ${TIP} L${x + 6} ${COMB} Z`, `fill:${u('mh')};${OUT}`);
    if (s0 === 'ok') R(s, x - 3.5, TIP - 2, 7, 5, `fill:${c('ok')}`, 1.5);
    if (s0 === 'running') el('line', { x1: x + 9, y1: COMB - 4, x2: x + 9, y2: TIP + 2, class: 'core-moving', style: `stroke:${c('running')};stroke-width:1.3;stroke-dasharray:6 4` }, s);
    if (s0 === 'blocked' && i < 5) P(s, `M${x - 9} ${TIP - 2} L${x + 9} ${TIP - 2} L${x} ${TIP + 12} Z`, `fill:${u('md')};stroke:${c('blocked')};stroke-width:2.2;stroke-linejoin:round`);
  });
  // The comb's clamp bar over the tine roots.
  R(G(s, { filter: u('ss') }), XS[0] - 30, COMB - 10, XS[5] - XS[0] + 60, 14, `fill:${u('mv')};${OUT}`, 3);
  for (const x of [XS[0] - 20, XS[5] + 20]) E(s, x, COMB - 3, 3, 3, `fill:${u('md')};${OUT}`);

  // Result: a drop-flag register. The flag falls and shows the result only once stage 06 has a state.
  const res = st(5), rx = 652, f = G(s, { filter: u('sh') });
  R(f, rx, 132, 104, 176, `fill:${u('md')};${OUT}`, 8);
  P(f, `M${rx + 8} 133 h88`, 'stroke:var(--mat-spec);stroke-width:1;opacity:0.85');
  R(s, rx + 18, 166, 68, 92, 'fill:var(--mat-line);opacity:0.8', 5);
  R(s, rx + 20, 168, 64, 88, 'fill:var(--core-well)', 4);
  const dropped = RAN.has(res);
  R(G(s, { filter: u('ss') }), rx + 26, dropped ? 192 : 172, 52, 50, `fill:${u('mv')};${OUT}`, 3);
  if (dropped) symbol(s, rx + 52, 217, res, 11);
  R(s, rx + 20, 168, 64, 88, `fill:${u('gl')};opacity:0.45`, 4);
  R(s, rx + 14, 160, 76, 104, `fill:none;${stroke(res, 1)}`, 7);
}

export const render: Render = (host, r, t) => {
  const s = svg(host, 800, 540, false, 'Drum · ' + r.title);
  grid(s, 800, 540, 'fg'); kit(s, 'fd'); header(s, 'PROGRAM DRUM · EXECUTION RECORD');
  machine(s, 'fd', r);
  XS.forEach((x, i) => {
    const st = r.stages[i], quiet = !RAN.has(st.status);
    txt(s, x, 104, st.n, { size: 12, color: c(st.status), anchor: 'middle' });
    txt(s, x, 448, st.short, { size: 15, color: quiet ? 'var(--core-ink-3)' : 'var(--core-ink)', font: 'text', anchor: 'middle' });
    const label = t('core.s.' + st.status), tw = label.length * 6.6;
    symbol(s, x - tw / 2 - 4, 467, st.status, 4.5);
    txt(s, x - tw / 2 + 5, 471, label, { size: 11, color: c(st.status) });
  });
  txt(s, 704, 120, 'RESULT', { size: 11, color: 'var(--core-ink-3)', anchor: 'middle', spacing: 1 });
  txt(s, 704, 330, t('core.s.' + r.stages[5].status), { size: 12, color: c(r.stages[5].status), anchor: 'middle' });
  const m = svg(host, 300, 154, true, '');
  m.setAttribute('viewBox', '40 106 724 372');
  kit(m, 'fm'); machine(m, 'fm', r);
};
