// Quantum optics kit for the three 7C-35 concepts (prototype; nothing in the interface imports it).
// It leaves production draw.ts and web.css untouched: its theme tokens (--q-*) are injected once,
// as a style element, only when a concept renders, and its gradients are its own.
//
// Why it exists (7C-35 master pass): the concepts looked pale because their glass was an ice-blue
// tint at 7–34% opacity and their metal started at the light theme's own background value. Here
// sapphire runs from a cyan edge through vivid blue to a near-black royal core, metal has a real
// range from a white specular to a deep shadow, and every face type gets its own gradient. Violet
// stays reflected light only (coating sheen, edges), never a state.
import { c, el, kit } from '../draw.ts';
import type { Status } from '../draw.ts';

const TOKENS = `:root{--q-ti-hi:#eef2f8;--q-ti:#a2aec1;--q-ti-mid:#5c6982;--q-ti-lo:#172033;--q-ti-deep:#070b15;--q-gr-hi:#8a94a6;--q-gr:#353e50;--q-gr-lo:#10151f;--q-sap-hi:#8bd8ff;--q-sap:#2b7af2;--q-sap-deep:#0c3aa4;--q-sap-core:#041656;--q-vio:#b07cff;--q-line:#02050c;--q-spot:#2f66c4;--q-bg-lo:#02060f}
:root[data-theme="dark"]{--q-ti-hi:#f2f4f7;--q-ti:#a5abb5;--q-ti-mid:#5d636d;--q-ti-lo:#1f2227;--q-ti-deep:#0a0b0e;--q-gr-hi:#8e949e;--q-gr:#3a3f47;--q-gr-lo:#141619;--q-sap-hi:#86d2ff;--q-sap:#347ff5;--q-sap-deep:#103ca0;--q-sap-core:#05164f;--q-vio:#bb96ff;--q-line:#000;--q-spot:#4f5866;--q-bg-lo:#030304}
:root[data-theme="light"]{--q-ti-hi:#fff;--q-ti:#c5ccd7;--q-ti-mid:#77829a;--q-ti-lo:#343c4b;--q-ti-deep:#1d232e;--q-gr-hi:#9aa3b2;--q-gr:#465063;--q-gr-lo:#232a36;--q-sap-hi:#68c6ff;--q-sap:#1c62de;--q-sap-deep:#0a2f8c;--q-sap-core:#051852;--q-vio:#7633ee;--q-line:#18202c;--q-spot:#fff;--q-bg-lo:#cfd7e4}`;

type Stops = readonly (readonly [number, string, number?])[];
const v = (n: string): string => `var(--q-${n})`;

/** The shared kit (cast shadows, key light) plus the quantum materials, under the same id prefix:
 *  'Tf' titanium front face (lit from above), 'Tt' top face, 'Ts' side face turned from the light,
 *  'Tr' a rod or cylinder across x, 'Gf' graphite face, 'Sa' a sapphire facet facing the light,
 *  'Sd' a facet half turned away, 'Sk' a dark inner facet, 'Sv' the violet coating sheen (a narrow
 *  band), 'Sw' a narrow white specular band, 'Bg' the backdrop (key light, darker edges). */
export function qkit(s: Element, id: string): Element {
  if (!document.getElementById('ela-q-tokens')) {
    const st = document.createElement('style');
    st.id = 'ela-q-tokens'; st.textContent = TOKENS;
    document.head.append(st);
  }
  const d = kit(s, id);
  const lin = (n: string, stops: Stops, x2: number, y2: number): void => {
    const g = el('linearGradient', { id: id + n, x1: 0, y1: 0, x2, y2 }, d);
    for (const [o, c, a = 1] of stops) el('stop', { offset: o, style: `stop-color:${c};stop-opacity:${a}` }, g);
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
  for (const [o, c, a] of [[0, v('spot'), 0.42], [0.55, v('spot'), 0.06], [1, v('bg-lo'), 0.55]] as const) el('stop', { offset: o, style: `stop-color:${c};stop-opacity:${a}` }, bg);
  return d;
}

/** A crisp outline in the quantum line colour (stronger than the production contact line). */
export const QL = 'stroke:var(--q-line);stroke-width:0.9;stroke-opacity:0.85';

/** Text colour for a state. Waiting text uses the muted ink: --s-waiting is below 4.5:1 as text in all
 *  three themes (3.43–4.23, measured); the waiting symbol keeps its state colour. */
export const ink = (s: Status): string => (s === 'waiting' ? 'var(--core-ink-3)' : c(s));
