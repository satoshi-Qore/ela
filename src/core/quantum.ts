// Shared materials of the KOHERENS and OKTA Core views (7C-36). Theme tokens (--q-*) live in
// web.css with the other Core tokens; this module only builds gradients under an id prefix, on top
// of the shared kit in draw.ts (cast shadows, key light).
//
// Materials: titanium with a real range (white specular to deep shadow), graphite, and sapphire
// from a cyan edge through vivid blue to a near-black royal core. Violet stays reflected light only
// (coating sheen, edges), never a state.
import { c, el, kit } from './draw.ts';
import type { Status } from './draw.ts';

type Stops = readonly (readonly [number, string, number?])[];
const v = (n: string): string => `var(--q-${n})`;

/** The shared kit plus the quantum materials, under the same id prefix:
 *  'Tf' titanium front face (lit from above), 'Tt' top face, 'Ts' side face turned from the light,
 *  'Tr' a rod or cylinder across x, 'Gf' graphite face, 'Sa' a sapphire facet facing the light,
 *  'Sd' a facet half turned away, 'Sk' a dark inner facet, 'Sv' the violet coating sheen (a narrow
 *  band), 'Sw' a narrow white specular band, 'Bg' the backdrop (key light, darker edges). */
export function qkit(s: Element, id: string): Element {
  const d = kit(s, id);
  const lin = (n: string, stops: Stops, x2: number, y2: number): void => {
    const g = el('linearGradient', { id: id + n, x1: 0, y1: 0, x2, y2 }, d);
    for (const [o, c2, a = 1] of stops) el('stop', { offset: o, style: `stop-color:${c2};stop-opacity:${a}` }, g);
  };
  lin('Tf', [[0, v('ti-hi')], [0.06, v('ti')], [0.5, v('ti-mid')], [1, v('ti-lo')]], 0, 1);
  lin('Tt', [[0, '#fff'], [0.1, v('ti-hi')], [0.55, v('ti')], [1, v('ti-mid')]], 1, 1);
  lin('Ts', [[0, v('ti-mid')], [0.12, v('ti-lo')], [1, v('ti-deep')]], 0, 1);
  lin('Tr', [[0, v('ti-lo')], [0.14, v('ti-mid')], [0.26, v('ti-hi')], [0.3, '#fff'], [0.36, v('ti-hi')], [0.56, v('ti-mid')], [0.82, v('ti-lo')], [0.92, v('vio'), 0.85], [1, v('ti-deep')]], 1, 0);
  lin('Gf', [[0, v('gr-hi')], [0.22, v('gr')], [0.75, v('gr-lo')], [1, v('gr')]], 1, 1);
  lin('Sa', [[0, v('sap-hi')], [0.32, v('sap')], [1, v('sap-deep')]], 1, 1);
  lin('Sd', [[0, v('sap')], [0.45, v('sap-deep')], [1, v('sap-core')]], 1, 1);
  lin('Sk', [[0, v('sap-deep')], [1, v('sap-core')]], 0, 1);
  lin('Sv', [[0, v('vio'), 0], [0.47, v('vio'), 0], [0.515, v('vio'), 0.7], [0.56, v('vio'), 0], [1, v('vio'), 0]], 1, 1);
  lin('Sw', [[0, '#fff', 0], [0.26, '#fff', 0], [0.31, '#fff', 0.9], [0.36, '#fff', 0], [1, '#fff', 0]], 1, 1);
  const bg = el('radialGradient', { id: id + 'Bg', fx: 0.4, fy: 0.32, r: 0.75 }, d);
  for (const [o, c2, a] of [[0, v('spot'), 0.42], [0.55, v('spot'), 0.06], [1, v('bg-lo'), 0.55]] as const) el('stop', { offset: o, style: `stop-color:${c2};stop-opacity:${a}` }, bg);
  return d;
}

/** A crisp outline in the quantum line colour. */
export const QL = 'stroke:var(--q-line);stroke-width:0.9;stroke-opacity:0.85';

/** Text colour for a state. Waiting text uses the muted ink (--s-waiting is below 4.5:1 as text in
 *  all three themes); the waiting symbol keeps its state colour. */
export const ink = (s: Status): string => (s === 'waiting' ? 'var(--core-ink-3)' : c(s));

/** The faceted gem (ELA's mark) lit from the upper left; shown for a real success only. */
export function gem(s: Element, x: number, y: number, r: number): void {
  const pts = [[0, -r], [r, 0], [0, r], [-r, 0]], col = 'var(--s-result)';
  [0.72, 0.3, 0.5, 0.95].forEach((o, k) => { const [p, q] = [pts[k], pts[(k + 1) % 4]]; el('path', { d: `M${x} ${y} L${x + p[0]} ${y + p[1]} L${x + q[0]} ${y + q[1]} Z`, style: `fill:${col};opacity:${o}` }, s); });
  el('path', { d: `M${x} ${y - r} L${x + r} ${y} L${x} ${y + r} L${x - r} ${y} Z`, style: `fill:none;stroke:${col};stroke-width:1` }, s);
}
