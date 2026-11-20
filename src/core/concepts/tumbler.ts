// Concept D — Tumbler (prototype, not wired into the interface). The six stages are the six pin
// stacks of a precision pin-tumbler lock, cut away. The command is a key that enters the keyway
// only as far as execution really went. A stage that succeeded lifts its pin so the gap sits on the
// shear line (with the success inlay there); a running stage's pin is half lifted and is the only
// thing that moves; a blocked stage is jammed by a red stop bar and the key stops before it; a
// failed stage's pin is broken; a skipped chamber is sealed; a waiting pin rests; an unknown chamber
// is fogged. The plug's end face, beside the housing, shows the result: its cam turns only when all
// six stages succeeded. Pin lengths are a fixed lock code, not data.
import { c, E, el, G, grid, header, kit, OUT, P, R, RAN, rim, stroke, svg, symbol, txt } from '../draw.ts';
import type { CoreRecord, Render, Status } from '../draw.ts';

const LEN = [34, 46, 28, 52, 40, 36];
const XS = [136, 222, 308, 394, 480, 566];
const SHEAR = 304, KEY_TOP = 326, KEY_BOT = 382, REST = 378;

/** How far the key went (index of the last chamber it passed) and where it stopped. */
function keyReach(r: CoreRecord): { last: number; tip: number } {
  let last = -1, tip = 0;
  for (let i = 0; i < 6; i++) {
    const s = r.stages[i].status;
    if (s === 'blocked') { tip = XS[i] - 16; break; }
    if (!RAN.has(s)) break;
    last = i; tip = XS[i] + 18;
    if (s === 'failed' || s === 'running') break;
  }
  return { last, tip };
}

function mechanism(s: Element, id: string, r: CoreRecord): void {
  const u = (n: string): string => `url(#${id}${n})`, st = (i: number): Status => r.stages[i].status;
  const { last, tip } = keyReach(r);
  R(s, 70, 70, 690, 360, `fill:${u('sp')}`);
  // Housing and plug: a machined block, the plug a lying cylinder; the shear line is their seam.
  const body = G(s, { filter: u('sh') });
  R(body, 92, 112, 520, 282, `fill:${u('md')};${OUT}`, 8);
  // Section hatching (as on an engineering cut): housing one way, plug the other, so the parts separate.
  for (const [n, a] of [['hh', 45], ['hp', -45]] as const) {
    const pt = el('pattern', { id: id + n, width: 7, height: 7, patternUnits: 'userSpaceOnUse', patternTransform: `rotate(${a})` }, s.querySelector('defs')!);
    el('line', { x1: 0, y1: 0, x2: 0, y2: 7, style: 'stroke:var(--mat-line);stroke-width:0.7;opacity:0.16' }, pt);
  }
  R(s, 92, 112, 520, 282, `fill:${u('hh')}`, 8);
  P(body, 'M100 112.8 h504', 'stroke:var(--mat-spec);stroke-width:1;opacity:0.8');
  R(s, 100, SHEAR, 504, 82, `fill:${u('md')};${OUT}`, 4);
  R(s, 100, SHEAR, 504, 82, `fill:${u('hp')}`, 4);
  R(s, 100, KEY_TOP, 504, KEY_BOT - KEY_TOP, 'fill:var(--bore)', 2);
  P(s, `M100 ${KEY_TOP + 0.6} h504`, 'stroke:var(--mat-line);stroke-width:1.4;opacity:0.8');
  P(s, `M100 ${SHEAR} h504`, 'stroke:var(--mat-line);stroke-opacity:var(--mat-line-o);stroke-width:1.2');
  P(s, `M100 ${SHEAR + 1.4} h504`, 'stroke:var(--mat-spec);stroke-width:0.6;opacity:0.45');

  // The key: bitting lifts exactly the pins it really reached; it is absent before any command.
  if (tip > 100) {
    let d = `M28 ${KEY_TOP + 8} L100 ${KEY_TOP + 8}`;
    for (let i = 0; i <= last; i++) { const y = SHEAR + LEN[i]; d += ` L${XS[i] - 12} ${KEY_TOP + 4} L${XS[i] - 6} ${y} L${XS[i] + 6} ${y} L${XS[i] + 12} ${KEY_TOP + 4}`; }
    d += ` L${tip} ${KEY_TOP + 10} L${tip + 6} ${KEY_BOT - 12} L${tip} ${KEY_BOT - 4} L28 ${KEY_BOT - 4} Z`;
    const k = G(s, { filter: u('ss') });
    P(k, d, `fill:${u('mv')};${OUT}`);
    P(k, `M30 ${KEY_TOP + 9} L${Math.min(tip, 100)} ${KEY_TOP + 9}`, 'stroke:var(--mat-spec);stroke-width:0.8;opacity:0.8');
    R(k, 6, KEY_TOP - 14, 30, 82, `fill:${u('md')};${OUT}`, 10);
    E(k, 21, KEY_TOP + 27, 6, 14, 'fill:var(--bore)');
  }

  XS.forEach((x, i) => {
    const s0 = st(i), len = LEN[i];
    // Chamber bore and its screw cap; the cap's ring carries the state's line style.
    R(s, x - 10, 132, 20, SHEAR - 132, 'fill:var(--bore)');
    P(s, `M${x + 9.4} 132 V${SHEAR}`, 'stroke:var(--mat-spec);stroke-width:0.6;opacity:0.3');
    R(s, x - 13, 116, 26, 12, `fill:${u('mv')};${OUT}`, 2);
    R(s, x - 16, 113, 32, 18, `fill:none;${stroke(s0, 1)}`, 4);
    const lift = s0 === 'ok' ? 1 : s0 === 'running' ? 0.5 : 0;
    const keyTop = REST - len - (REST - len - SHEAR) * lift, drv = keyTop - 46;
    // Spring, driver pin, key pin (pointed), lit from the upper left.
    let z = `M${x} 134`;
    for (let k = 1; k <= 8; k++) z += ` L${x + (k % 2 ? 6 : -6)} ${134 + ((drv - 134) * k) / 8}`;
    P(s, z + ` L${x} ${drv}`, 'fill:none;stroke:var(--mat-hi);stroke-width:1.3;opacity:0.85');
    R(s, x - 7, drv, 14, 45, `fill:${u('mh')};${OUT}`, 3);
    if (s0 === 'failed') {
      P(s, `M${x - 7} ${keyTop} h14 v${len * 0.45} l-4 3 l-3 -4 l-3 5 l-4 -3 Z`, `fill:${u('mh')};${OUT}`);
      P(s, `M${x - 7} ${keyTop + len * 0.6} l4 -3 l3 4 l3 -5 l4 3 V${keyTop + len - 6} L${x} ${keyTop + len} L${x - 7} ${keyTop + len - 6} Z`, `fill:${u('mh')};${OUT};transform:translate(2px,3px)`);
      P(s, `M${x - 11} ${keyTop + len * 0.5} h22`, `fill:none;${stroke('failed', 1.4)}`);
    } else P(s, `M${x - 7} ${keyTop + 1} h14 V${keyTop + len - 6} L${x} ${keyTop + len} L${x - 7} ${keyTop + len - 6} Z`, `fill:${u('mh')};${OUT}`);
    if (s0 === 'ok') P(s, `M${x - 12} ${SHEAR} h24`, `stroke:${c('ok')};stroke-width:2.2`);
    if (s0 === 'running') {
      P(s, `M${x - 12} ${SHEAR} h24`, `fill:none;${stroke('running', 1.6)}`);
      el('line', { x1: x + 11, y1: keyTop + len, x2: x + 11, y2: SHEAR - 30, class: 'core-moving', style: `stroke:${c('running')};stroke-width:1.2;stroke-dasharray:6 4` }, s);
    }
    if (s0 === 'blocked' && i < 5) {
      R(s, x - 15, SHEAR - 5, 30, 10, `fill:${u('md')};stroke:${c('blocked')};stroke-width:2.4`, 2);
      E(s, x - 10, SHEAR, 1.6, 1.6, 'fill:var(--mat-lo)');
    }
    if (s0 === 'skipped') R(s, x - 10, 132, 20, SHEAR - 132, `fill:var(--seal-overlay);${stroke('skipped', 0.8)}`);
    if (s0 === 'unknown') { R(s, x - 10, 132, 20, SHEAR - 132, 'fill:var(--seal-overlay)'); symbol(s, x, 220, 'unknown', 7); }
    if (s0 === 'waiting') R(s, x - 10, 132, 20, SHEAR - 132, 'fill:var(--seal-overlay);opacity:0.5');
  });

  // The plug's end face: the cam turns a quarter only when all six stages succeeded.
  const res = st(5), open = r.stages.every(x => x.status === 'ok'), fx = 690, fy = 300, f = G(s, { filter: u('sh') });
  E(f, fx, fy, 60, 60, `fill:${u('md')};${OUT}`);
  rim(f, fx, fy, 59, 59, 'var(--mat-spec)', 1.2, 52, 20, 0.85);
  E(s, fx, fy, 42, 42, `fill:${u('mv')};${OUT}`);
  rim(s, fx, fy, 41, 41, 'var(--mat-violet)', 1.1, 2, 20, 0.8);
  P(s, `M${fx - 4} ${fy - 30} h8 v18 h-8 Z`, 'fill:var(--bore)');
  el('rect', { x: fx - 36, y: fy - 5, width: 72, height: 10, rx: 4, transform: `rotate(${open ? 90 : 0} ${fx} ${fy})`, style: `fill:${u('mh')};${OUT}` }, s);
  E(s, fx, fy, 16, 16, 'fill:var(--core-well);stroke:var(--mat-line);stroke-width:1');
  E(s, fx, fy, 16, 16, `fill:${u('gl')};opacity:0.6`);
  if (RAN.has(res) || res === 'skipped' || res === 'unknown') symbol(s, fx, fy, res, 9);
}

export const render: Render = (host, r, t) => {
  const s = svg(host, 800, 540, false, 'Tumbler · ' + r.title);
  grid(s, 800, 540, 'dg'); kit(s, 'dd'); header(s, 'PIN TUMBLER · EXECUTION LOCK');
  mechanism(s, 'dd', r);
  XS.forEach((x, i) => {
    const st = r.stages[i], quiet = !RAN.has(st.status);
    txt(s, x, 102, st.n, { size: 12, color: c(st.status), anchor: 'middle' });
    txt(s, x, 448, st.short, { size: 15, color: quiet ? 'var(--core-ink-3)' : 'var(--core-ink)', font: 'text', anchor: 'middle' });
    const label = t('core.s.' + st.status), tw = label.length * 6.6;
    symbol(s, x - tw / 2 - 4, 467, st.status, 4.5);
    txt(s, x - tw / 2 + 5, 471, label, { size: 11, color: c(st.status) });
  });
  txt(s, 690, 220, 'RESULT', { size: 11, color: 'var(--core-ink-3)', anchor: 'middle', spacing: 1 });
  txt(s, 690, 392, t('core.s.' + r.stages[5].status), { size: 12, color: c(r.stages[5].status), anchor: 'middle' });
  const m = svg(host, 300, 150, true, '');
  m.setAttribute('viewBox', '0 92 760 314');
  kit(m, 'dm'); mechanism(m, 'dm', r);
};
