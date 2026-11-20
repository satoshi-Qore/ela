// Concept Q3 — OKTA, the Seal Crystal (prototype; nothing in the interface imports it).
// ELA's diamond mark made physical: an octahedral sapphire crystal held between two collets in a
// titanium C-yoke. Its six vertices are the six stages; execution travels along its edges from the
// bottom tip (01) around the girdle (02 left, 03 back — seen through the glass, 04 right, 05 front)
// to the crown (06 Result). Each vertex is a machined ferrule. ok: the edge into it is lit and the
// ferrule carries the success inlay; running: only the edge entering it moves; waiting: an unlit
// edge and a plain ferrule; blocked: a red collar on the ferrule and the path stops; failed: fracture
// lines in the facets; skipped: a capped ferrule; unknown: a frosted ferrule. On a real success the
// upper facets take a faint seal tint and the crown collet shows the faceted gem.
import { c, E, el, G, grid, header, kit, OUT, P, R, RAN, reachIndex, stopIndex, stroke, svg, symbol, txt } from '../draw.ts';
import type { CoreRecord, Render, Status } from '../draw.ts';
import { ink, QL, qkit } from './optics.ts';

type V = readonly [number, number];
const T: V = [292, 92], B: V = [292, 470], L: V = [118, 270], RT: V = [466, 270], F: V = [322, 306], K: V = [262, 236];
/** Stage order: bottom tip, girdle left, girdle back, girdle right, girdle front, crown. */
const VX: readonly V[] = [B, L, K, RT, F, T];
const tri = (a: V, b: V, d: V): string => `M${a[0]} ${a[1]} L${b[0]} ${b[1]} L${d[0]} ${d[1]} Z`;

function gem(s: Element, x: number, y: number, r: number): void {
  const v = [[0, -r], [r, 0], [0, r], [-r, 0]], col = 'var(--s-result)';
  [0.72, 0.3, 0.5, 0.95].forEach((o, k) => { const [p, q] = [v[k], v[(k + 1) % 4]]; P(s, `M${x} ${y} L${x + p[0]} ${y + p[1]} L${x + q[0]} ${y + q[1]} Z`, `fill:${col};opacity:${o}`); });
  P(s, `M${x} ${y - r} L${x + r} ${y} L${x} ${y + r} L${x - r} ${y} Z`, `fill:none;stroke:${col};stroke-width:1`);
}

function crystal(s: Element, id: string, r: CoreRecord): void {
  const u = (n: string): string => `url(#${id}${n})`, st = (i: number): Status => r.stages[i].status;
  const stop = stopIndex(r), running = r.stages.findIndex(x => x.status === 'running'), reach = reachIndex(r);
  // How far the signal really got (same rule as the bench views): the crown edge lights only when every stage succeeded.
  const end = stop >= 0 ? stop : running >= 0 ? running : reach === 4 && st(5) === 'ok' ? 5 : reach;
  const sealed = r.stages.every(x => x.status === 'ok');
  R(s, 0, 0, 800, 540, `fill:${u('Bg')}`);
  // The mount: a precision gantry. A plinth, two turned pillars with collars, a bridge beam carrying
  // the crown collet, two short girdle clamps; the frame stays outside the crystal's silhouette.
  const g = G(s, { filter: u('sh') });
  P(g, 'M40 500 h486 l14 -8 h-486 Z', `fill:${u('Tt')};${QL}`);
  R(g, 40, 500, 486, 20, `fill:${u('Tf')};${QL}`, 3);
  for (const x of [58, 508]) {
    R(g, x, 64, 20, 436, `fill:${u('Tr')};${QL}`, 3);
    for (const y of [70, 262, 484]) R(g, x - 4, y, 28, 12, `fill:${u('Tf')};${QL}`, 3);
  }
  P(g, 'M50 50 h486 l10 -6 h-486 Z', `fill:${u('Tt')};${QL}`);
  R(g, 50, 50, 486, 20, `fill:${u('Tf')};${QL}`, 4);
  P(s, 'M44 500.8 H520 M54 50.8 H532', 'stroke:#fff;stroke-width:1.2;opacity:0.9');
  P(s, 'M77 84 V480 M527 84 V480', 'stroke:var(--q-vio);stroke-width:1.2;opacity:0.7');
  // Girdle clamps: an arm from each pillar to a jaw at the 02 and 04 ferrules.
  for (const [x0, x1] of [[78, L[0] - 16], [RT[0] + 16, 508]]) {
    R(g, x0, L[1] - 4, x1 - x0, 8, `fill:${u('Tf')};${QL}`, 2);
    R(g, x0 < 200 ? x1 - 8 : x0, L[1] - 9, 8, 18, `fill:${u('Tt')};${QL}`, 2);
  }
  const col = G(s, { filter: u('ss') });
  R(col, T[0] - 9, 70, 18, T[1] - 70 + 4, `fill:${u('Tr')};${QL}`, 2);
  R(col, B[0] - 9, B[1] - 4, 18, 492 - B[1] + 4, `fill:${u('Tr')};${QL}`, 2);
  R(col, T[0] - 13, 76, 26, 8, `fill:${u('Tf')};${QL}`, 2);
  R(col, B[0] - 13, 480, 26, 10, `fill:${u('Tf')};${QL}`, 2);

  // The crystal. Each facet's light runs, in real coordinates, from where the key light (upper left)
  // strikes it; front facets are partly translucent, so the back facets, back edges and a dark inner
  // core read through the glass. A violet reflection rises from the lower edge of the facet turned
  // down (light bounced from below), never as a stripe across the glass.
  const defs = s.querySelector('defs')!;
  const lg = (n: string, a1: V, a2: V, stops: readonly (readonly [number, string, number])[]): string => {
    const gr = el('linearGradient', { id: id + n, gradientUnits: 'userSpaceOnUse', x1: a1[0], y1: a1[1], x2: a2[0], y2: a2[1] }, defs);
    for (const [o, c2, al] of stops) el('stop', { offset: o, style: `stop-color:${c2};stop-opacity:${al}` }, gr);
    return u(n);
  };
  const sh = 'var(--q-sap-hi)', sp = 'var(--q-sap)', sd = 'var(--q-sap-deep)', sc = 'var(--q-sap-core)', vi = 'var(--q-vio)';
  const cr = G(s, { filter: u('sh') });
  // Back facets (seen through the front): deep, faintly lit by internal reflection.
  for (const [a2, b2] of [[T, L], [T, RT], [B, L], [B, RT]] as const) P(cr, tri(a2, K, b2), `fill:${lg('bk' + a2[1] + b2[0], K, a2, [[0, sd, 1], [1, sc, 1]])}`);
  for (const v2 of [T, B, L, RT]) P(cr, `M${K[0]} ${K[1]} L${v2[0]} ${v2[1]}`, 'stroke:var(--q-sap-hi);stroke-width:0.8;opacity:0.35');
  // The dark inner volume.
  const core = [T, L, B, RT].map(([x, y]) => `${(292 + (x - 292) * 0.5).toFixed(1)} ${(281 + (y - 281) * 0.5).toFixed(1)}`);
  P(cr, `M${core.join(' L')} Z`, `fill:${sc};opacity:0.55`);
  // Front facets.
  P(cr, tri(T, L, F), `fill:${lg('f1', [200, 170], F, [[0, sh, 0.92], [0.45, sp, 0.78], [1, sd, 0.72]])}`);
  P(cr, tri(T, F, RT), `fill:${lg('f2', T, RT, [[0, sp, 0.78], [0.6, sd, 0.8], [1, sc, 0.85]])}`);
  P(cr, tri(B, L, F), `fill:${lg('f3', L, B, [[0, sd, 0.74], [1, sc, 0.88]])}`);
  P(cr, tri(B, F, RT), `fill:${lg('f4', [380, 400], [330, 330], [[0, vi, 0.55], [0.35, sc, 0.82], [1, sc, 0.9]])}`);
  if (sealed) for (const f2 of [tri(T, L, F), tri(T, F, RT)]) P(cr, f2, 'fill:var(--s-result);opacity:0.1');
  // Edges: front edges crisp (a dark seat under a cyan-white line), inner facet boundaries finer.
  for (const [a2, b2] of [[T, L], [T, RT], [B, L], [B, RT]] as const) {
    P(s, `M${a2[0]} ${a2[1]} L${b2[0]} ${b2[1]}`, 'stroke:var(--q-line);stroke-width:2.6;opacity:0.5');
    P(s, `M${a2[0]} ${a2[1]} L${b2[0]} ${b2[1]}`, 'stroke:var(--q-sap-hi);stroke-width:1;opacity:0.75');
  }
  for (const [a2, b2] of [[T, F], [B, F], [L, F], [F, RT]] as const) P(s, `M${a2[0]} ${a2[1]} L${b2[0]} ${b2[1]}`, 'stroke:var(--q-sap-hi);stroke-width:0.8;opacity:0.55');
  // Specular highlights: short, sharp, on the edges that face the key light, near their vertices.
  const spec = (a2: V, b2: V, t0: number, t1: number, w: number): void => {
    const p0 = [a2[0] + (b2[0] - a2[0]) * t0, a2[1] + (b2[1] - a2[1]) * t0], p1 = [a2[0] + (b2[0] - a2[0]) * t1, a2[1] + (b2[1] - a2[1]) * t1];
    P(s, `M${p0[0]} ${p0[1]} L${p1[0]} ${p1[1]}`, `stroke:#fff;stroke-width:${w};opacity:0.95;stroke-linecap:round`);
  };
  spec(T, L, 0.08, 0.34, 1.6); spec(L, F, 0.1, 0.24, 1.2); spec(T, F, 0.1, 0.22, 1);

  // The path along the edges, lit only as far as execution really went (over the facets and edges, so it stays legible).
  const edge = (k: number): void => {
    const [a, b] = [VX[k - 1], VX[k]];
    if (k > end) return;
    if (k === stop) {
      const mx = a[0] + (b[0] - a[0]) * 0.6, my = a[1] + (b[1] - a[1]) * 0.6;
      P(s, `M${a[0]} ${a[1]} L${mx} ${my}`, 'stroke:var(--q-line);stroke-width:4.4;opacity:0.6');
      P(s, `M${a[0]} ${a[1]} L${mx} ${my}`, 'stroke:#fff;stroke-width:2.6');
      return;
    }
    P(s, `M${a[0]} ${a[1]} L${b[0]} ${b[1]}`, 'stroke:var(--q-line);stroke-width:4.4;opacity:0.6');
    P(s, `M${a[0]} ${a[1]} L${b[0]} ${b[1]}`, 'stroke:var(--beam-2);stroke-width:8;opacity:0.32');
    el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: k === running ? 'core-moving' : undefined, style: `stroke:#fff;stroke-width:2.6;${k === running ? 'stroke-dasharray:6 4' : ''}` }, s);
  };
  if (RAN.has(st(0))) { P(s, `M${B[0]} 500 V${B[1]}`, 'stroke:var(--q-line);stroke-width:4.4;opacity:0.6'); P(s, `M${B[0]} 500 V${B[1]}`, 'stroke:#fff;stroke-width:2'); }
  for (let k = 1; k < 6; k++) edge(k);

  // Ferrules at the six vertices.
  VX.forEach((v, i) => {
    const s0 = st(i), [x, yy] = v, back = i === 2;
    const g = G(s, { filter: back ? undefined : u('ss'), opacity: back ? 0.85 : undefined });
    if (s0 === 'failed') for (const [dx, dy] of [[-22, -14], [18, -20], [24, 10], [-16, 18]]) P(s, `M${x} ${yy} l${dx * 0.5} ${dy * 0.5} l${dx * 0.3} ${dy * 0.6}`, `fill:none;${stroke('failed', 1.2)}`);
    // Ferrules of stages that really ran are polished; the others stay a duller, unlit finish.
    E(g, x, yy, 10, 10, `fill:${s0 === 'skipped' ? 'var(--q-ti-lo)' : RAN.has(s0) ? u('Tt') : u('Ts')};${QL}`);
    E(g, x - 2.5, yy - 3, 3.2, 2, 'fill:#fff;opacity:0.9');
    E(s, x, yy, 14, 14, 'fill:none;stroke:var(--q-line);stroke-width:3.6;opacity:0.55');
    E(s, x, yy, 14, 14, `fill:none;${stroke(s0, s0 === 'blocked' ? 2 : 1.2)}`);
    if (s0 === 'ok') E(s, x, yy, 6, 6, `fill:none;stroke:${c('ok')};stroke-width:2`);
    if (s0 === 'running') E(s, x, yy, 6, 6, `fill:none;${stroke('running', 1.6)}`);
    if (s0 === 'blocked') E(s, x, yy, 6, 6, `fill:${c('blocked')}`);
    if (s0 === 'unknown') { E(s, x, yy, 10, 10, 'fill:var(--seal-overlay)'); symbol(s, x, yy, 'unknown', 5); }
  });

  // The crown collet's window: the seal. The gem only on a real success; the state mark otherwise.
  const res = st(5), wx = T[0], wy = 60;
  E(G(s, { filter: u('ss') }), wx, wy, 18, 18, `fill:${u('Tt')};${QL}`);
  E(s, wx, wy, 12, 12, `fill:${u('Sk')};${QL}`);
  E(s, wx, wy, 12, 12, `fill:${u('Sw')}`);
  if (res === 'ok') gem(s, wx, wy, 8);
  else if (res !== 'waiting') symbol(s, wx, wy, res, 6.5);
}

export const render: Render = (host, r, t) => {
  const s = svg(host, 800, 540, false, 'Okta · ' + r.title);
  grid(s, 800, 540, 'q3g'); qkit(s, 'q3'); header(s, 'OKTA · SEAL CRYSTAL');
  // Labels ascend with the crystal: 01 at the bottom tip, 06 at the crown.
  const LY = [470, 394, 318, 242, 166, 96], LX = 560;
  crystal(s, 'q3', r);
  // Each ferrule carries its stage number; the list on the right ascends the same way.
  const TAG: readonly V[] = [[22, 6], [-34, -14], [-30, -16], [20, -14], [16, 26], [22, 6]];
  VX.forEach((v, i) => txt(s, v[0] + TAG[i][0], v[1] + TAG[i][1], r.stages[i].n, { size: 11, color: ink(r.stages[i].status) }));
  r.stages.forEach((st, i) => {
    const y = LY[i], quiet = !RAN.has(st.status);
    txt(s, LX, y - 4, st.n, { size: 11, color: ink(st.status) });
    txt(s, LX + 24, y - 4, st.name, { size: 15, color: quiet ? 'var(--core-ink-3)' : 'var(--core-ink)', font: 'text' });
    symbol(s, LX + 30, y + 12, st.status, 5);
    txt(s, LX + 42, y + 16, t('core.s.' + st.status), { size: 12, color: ink(st.status) });
  });
  const m = svg(host, 300, 312, true, '');
  m.setAttribute('viewBox', '30 30 520 520');
  qkit(m, 'q3m'); crystal(m, 'q3m', r);
};
