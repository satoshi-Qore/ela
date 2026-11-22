// Concept E — Nivo (prototype, not wired into the interface). The six stages are six spirit levels
// set into a machined reference block: five tube vials (stages 01–05) along an engraved datum, and a
// round bullseye vial (06 Result) at the foot. A level only says aligned or not; nothing is measured.
// A stage that succeeded has its bubble centred between the datum marks (marks inlaid in the success
// colour); a running stage's bubble is drifting toward centre and its trace is the only thing that
// moves; a waiting bubble rests at the end of its vial; a blocked bubble is pinned against a red stop
// pin; a failed vial is cracked and has lost its bubble; a skipped pocket is closed by a cover plate;
// an unknown vial is frosted.
import { c, E, el, G, grid, header, kit, OUT, P, R, RAN, rim, stroke, svg, symbol, txt } from '../draw.ts';
import type { CoreRecord, Render, Status } from '../draw.ts';

const PX = 150, PY = 66, PW = 280, PH = 440, DX = PX + PW / 2;
const VY = [106, 170, 234, 298, 362], BY = 446;

function screw(s: Element, u: (n: string) => string, x: number, y: number): void {
  E(s, x, y, 6, 6, `fill:${u('md')};${OUT}`);
  P(s, `M${x - 4} ${y + 1.5} L${x + 4} ${y - 1.5}`, 'stroke:var(--mat-line);stroke-width:1.4;opacity:0.8');
}

function block(s: Element, id: string, r: CoreRecord): void {
  const u = (n: string): string => `url(#${id}${n})`;
  R(s, PX - 60, PY - 20, PW + 120, PH + 40, `fill:${u('sp')}`);
  // The reference block: machined face, chamfer lit on the top and left edges, four countersunk screws.
  R(G(s, { filter: u('sh') }), PX, PY, PW, PH, `fill:${u('md')};${OUT}`, 12);
  P(s, `M${PX + 10} ${PY + 1} H${PX + PW - 10} M${PX + 1} ${PY + 10} V${PY + PH - 10}`, 'stroke:var(--mat-spec);stroke-width:1.2;opacity:0.85');
  P(s, `M${PX + PW - 1} ${PY + 12} V${PY + PH - 10}`, 'stroke:var(--mat-violet);stroke-width:1;opacity:0.6');
  for (const [x, y] of [[PX + 18, PY + 18], [PX + PW - 18, PY + 18], [PX + 18, PY + PH - 18], [PX + PW - 18, PY + PH - 18]]) screw(s, u, x, y);
  // The datum: an engraved line (dark cut, lit lip) with a fiducial at each end.
  P(s, `M${DX} ${PY + 14} V${BY - 54}`, 'stroke:var(--mat-line);stroke-width:1.1;opacity:0.7');
  P(s, `M${DX + 0.9} ${PY + 14} V${BY - 54}`, 'stroke:var(--mat-spec);stroke-width:0.6;opacity:0.45');
  for (const y of [PY + 14, BY - 54]) P(s, `M${DX - 5} ${y} h10`, 'stroke:var(--mat-line);stroke-width:1.2;opacity:0.7');

  r.stages.slice(0, 5).forEach((st, i) => vial(s, u, VY[i], st.status));
  bullseye(s, u, r.stages[5].status);
}

/** A tube vial in its milled pocket. */
function vial(s: Element, u: (n: string) => string, y: number, st: Status): void {
  const x0 = PX + 26, x1 = PX + PW - 26, w = x1 - x0;
  R(s, x0 - 4, y - 20, w + 8, 40, 'fill:var(--mat-line);opacity:0.75', 20);
  P(s, `M${x0 + 14} ${y + 19.4} H${x1 - 14}`, 'stroke:var(--mat-spec);stroke-width:0.8;opacity:0.6');
  R(s, x0 - 8, y - 24, w + 16, 48, `fill:none;${stroke(st, 1)}`, 24);
  if (st === 'skipped') {
    R(s, x0 - 2, y - 18, w + 4, 36, `fill:${u('md')};${OUT}`, 18);
    R(s, x0 - 2, y - 18, w + 4, 36, 'fill:var(--seal-overlay);opacity:0.5', 18);
    for (const x of [x0 + 14, x1 - 14]) E(s, x, y, 4, 4, `fill:${u('mv')};${OUT}`);
    return;
  }
  // Glass tube: dark well, sapphire liquid, one specular streak along the top, edge thickness.
  R(s, x0, y - 14, w, 28, 'fill:var(--core-well)', 14);
  R(s, x0, y - 14, w, 28, 'fill:var(--glass-1);opacity:0.2', 14);
  R(s, x0, y - 14, w, 28, `fill:${u('gl')};stroke:var(--glass-edge);stroke-width:0.7;stroke-opacity:0.55`, 14);
  P(s, `M${x0 + 10} ${y - 12.6} H${x1 - 10}`, 'stroke:var(--mat-line);stroke-width:2;opacity:0.35;stroke-linecap:round');
  P(s, `M${x0 + 12} ${y - 9} H${x1 - 12}`, 'stroke:var(--glass-edge);stroke-width:1.1;opacity:0.7;stroke-linecap:round');
  const mark = st === 'ok' ? `stroke:${c('ok')};stroke-width:1.8` : 'stroke:var(--mat-line);stroke-width:1;opacity:0.7';
  P(s, `M${DX - 24} ${y - 14} v28 M${DX + 24} ${y - 14} v28`, mark);
  const bubble = (bx: number): void => {
    E(s, bx, y, 18.6, 8.6, 'fill:none;stroke:var(--mat-line);stroke-width:0.9;opacity:0.55');
    E(s, bx, y, 18, 8, 'fill:var(--glass-edge);fill-opacity:0.32;stroke:var(--glass-edge);stroke-width:0.9;stroke-opacity:0.8');
    E(s, bx - 6, y - 3, 6, 2, 'fill:var(--mat-spec);opacity:0.9');
  };
  if (st === 'ok') bubble(DX);
  else if (st === 'running') {
    bubble(DX + 46);
    el('line', { x1: DX + 26, y1: y, x2: DX + 6, y2: y, class: 'core-moving', style: `stroke:${c('running')};stroke-width:1.4;stroke-dasharray:6 4` }, s);
  } else if (st === 'waiting') bubble(x1 - 24);
  else if (st === 'blocked') {
    bubble(x0 + 30);
    R(s, x0 + 6, y - 14, 5, 28, `fill:${c('blocked')}`, 1.5);
    P(s, `M${x0 + 11} ${y - 14} v28`, `stroke:${c('blocked')};stroke-width:0.8;opacity:0.6`);
  } else if (st === 'failed') {
    let d = `M${x0 + 40} ${y - 14}`;
    [[6, -4], [12, 5], [18, -3], [24, 6], [30, 14]].forEach(([dx, dy]) => { d += ` L${x0 + 40 + dx * 2} ${y + dy}`; });
    P(s, d, `fill:none;${stroke('failed', 1.4)}`);
  } else if (st === 'unknown') {
    R(s, x0, y - 14, w, 28, 'fill:var(--seal-overlay)', 14);
    symbol(s, DX, y, 'unknown', 7);
  }
}

/** The round bullseye vial of the result. */
function bullseye(s: Element, u: (n: string) => string, st: Status): void {
  const x = DX, y = BY;
  E(s, x, y, 46, 46, 'fill:var(--mat-line);opacity:0.75');
  rim(s, x, y, 45.5, 45.5, 'var(--mat-spec)', 1, 2, 22, 0.6);
  E(s, x, y, 52, 52, `fill:none;${stroke(st, 1)}`);
  if (st === 'skipped') { E(s, x, y, 42, 42, `fill:${u('md')};${OUT}`); E(s, x, y, 42, 42, 'fill:var(--seal-overlay);opacity:0.5'); return; }
  E(s, x, y, 40, 40, 'fill:var(--core-well)');
  E(s, x, y, 40, 40, 'fill:var(--glass-1);opacity:0.2');
  E(s, x, y, 40, 40, `fill:${u('gl')};stroke:var(--glass-edge);stroke-width:0.7;stroke-opacity:0.55`);
  rim(s, x, y, 36, 36, 'var(--glass-edge)', 1.1, 55, 14, 0.7);
  E(s, x, y, 14, 14, st === 'ok' ? `fill:none;stroke:${c('ok')};stroke-width:1.8` : 'fill:none;stroke:var(--mat-line);stroke-width:1;opacity:0.7');
  P(s, `M${x - 40} ${y} h26 M${x + 14} ${y} h26 M${x} ${y - 40} v26 M${x} ${y + 14} v26`, 'stroke:var(--mat-line);stroke-width:0.6;opacity:0.4');
  const bubble = (bx: number, by: number): void => {
    E(s, bx, by, 10.6, 10.6, 'fill:none;stroke:var(--mat-line);stroke-width:0.9;opacity:0.55');
    E(s, bx, by, 10, 10, 'fill:var(--glass-edge);fill-opacity:0.32;stroke:var(--glass-edge);stroke-width:0.9;stroke-opacity:0.8');
    E(s, bx - 3, by - 3.5, 3.5, 2, 'fill:var(--mat-spec);opacity:0.9');
  };
  if (st === 'ok') bubble(x, y);
  else if (st === 'running') { bubble(x + 18, y + 14); el('line', { x1: x + 10, y1: y + 8, x2: x + 3, y2: y + 2, class: 'core-moving', style: `stroke:${c('running')};stroke-width:1.4;stroke-dasharray:4 3` }, s); }
  else if (st === 'waiting') bubble(x + 24, y + 22);
  else if (st === 'blocked') { bubble(x - 24, y + 20); E(s, x - 33, y + 28, 3.5, 3.5, `fill:${c('blocked')}`); }
  else if (st === 'failed') P(s, `M${x - 30} ${y - 18} L${x - 16} ${y - 4} L${x - 8} ${y - 10} L${x + 6} ${y + 6} L${x + 20} ${y + 2}`, `fill:none;${stroke('failed', 1.4)}`);
  else { E(s, x, y, 40, 40, 'fill:var(--seal-overlay)'); symbol(s, x, y, 'unknown', 8); }
}

export const render: Render = (host, r, t) => {
  const s = svg(host, 800, 540, false, 'Nivo · ' + r.title);
  grid(s, 800, 540, 'eg'); kit(s, 'ed'); header(s, 'ALIGNMENT BLOCK · SPIRIT LEVELS');
  block(s, 'ed', r);
  r.stages.forEach((st, i) => {
    const y = i < 5 ? VY[i] : BY, quiet = !RAN.has(st.status), lx = 478;
    el('line', { x1: PX + PW + 6, y1: y, x2: lx - 12, y2: y, style: stroke(st.status, 0.8) }, s);
    txt(s, lx, y - 6, st.n, { size: 11, color: c(st.status) });
    txt(s, lx + 26, y - 6, st.name, { size: 15, color: quiet ? 'var(--core-ink-3)' : 'var(--core-ink)', font: 'text' });
    symbol(s, lx + 32, y + 11, st.status, 5.5);
    txt(s, lx + 44, y + 15, t('core.s.' + st.status) + (st.rpc ? ' · ' + st.rpc : ''), { size: 12, color: c(st.status) });
  });
  const m = svg(host, 300, 432, true, '');
  m.setAttribute('viewBox', `${PX - 20} ${PY - 10} ${PW + 40} ${PH + 20}`);
  kit(m, 'em'); block(m, 'em', r);
};
