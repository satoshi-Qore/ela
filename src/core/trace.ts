// A semantic execution map. This renderer consumes the existing record, never runs commands,
// and never infers success from geometry, time, the selected theme or a previous query.
import type { Render, Status } from './draw.ts';

const GLYPHS = [
  'M20 25 9 36l11 11M52 25l11 11-11 11M42 19 30 53',
  'M36 10 58 19v17c0 14-22 26-22 26S14 50 14 36V19ZM26 35h20M36 25v20',
  'M12 36h18M30 36 45 19h15M30 36l15 17h15M9 31v10M60 14v10M60 48v10',
  'M36 14 14 49h44ZM36 14v23M14 49l22-12 22 12M30 37h12M31 9h10v10H31ZM9 44h10v10H9ZM53 44h10v10H53Z',
  'M13 18h46v36H13ZM21 28h30M21 36h21M21 44h25M51 30v12',
  'M23 14H12v44h11M49 14h11v44H49M25 28h22M25 36h22M25 44h14',
];
const MARK: Readonly<Record<Status, string>> = {
  waiting: '○', running: '◐', ok: '✓', blocked: '⊣', failed: '×', skipped: '—', unknown: '?',
};
// Legacy tone attributes remain available to the trace diagnostics; data-status retains all 7 states.
const TONE: Readonly<Record<Status, string>> = {
  ok: 'done', blocked: 'failed', failed: 'failed', waiting: 'neutral', running: 'neutral', skipped: 'neutral', unknown: 'neutral',
};
export const render: Render = (host, record, t) => {
  const box = document.createElement('div');
  box.className = 'ot execution-map';
  const statuses = record.stages.map(s => s.status);
  box.dataset.mode = statuses.every(s => s === 'ok') ? 'replay'
    : statuses.every(s => s === 'waiting') || statuses.includes('running') ? 'idle'
    : statuses.slice(0, 5).find(s => s === 'blocked' || s === 'failed') === 'blocked' ? 'refusal' : 'capture';
  const map = document.createElement('ol');
  map.className = 'ot-stage stage-map';
  map.setAttribute('aria-label', t('flow.label'));
  record.stages.forEach((stage, index) => {
    const card = document.createElement('li');
    card.className = 'stage-card';
    card.dataset.status = stage.status;
    card.dataset.plate = String(index);
    card.dataset.state = TONE[stage.status];
    // Only static drawing paths are interpolated; all record and catalog text uses textContent.
    card.innerHTML = `<div class="stage-top"><span class="stage-number"></span><span class="stage-status-symbol" aria-hidden="true"></span></div>
      <div class="stage-optic"><svg viewBox="0 0 72 72" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><defs><linearGradient id="stage-glass-${index}" x1="0" y1="0" x2="1" y2="1"><stop class="optic-hi"/><stop offset=".32" class="optic-mid"/><stop offset=".6" class="optic-low"/><stop offset=".84" class="optic-mid"/><stop offset="1" class="optic-hi"/></linearGradient></defs><path class="glyph-depth" d="${GLYPHS[index]}"/><path class="glyph-body" stroke="url(#stage-glass-${index})" d="${GLYPHS[index]}"/><path class="glyph-reflection" d="${GLYPHS[index]}"/></svg></div>
      <div class="stage-info"><span class="stage-name"></span><span class="stage-state"></span></div>`;
    card.querySelector('.stage-number')!.textContent = stage.n;
    card.querySelector('.stage-status-symbol')!.textContent = MARK[stage.status];
    card.querySelector('.stage-name')!.textContent = stage.name;
    card.querySelector('.stage-state')!.textContent = t('core.s.' + stage.status);
    const svg = card.querySelector('svg')!;
    svg.dataset.node = String(index);
    svg.dataset.state = TONE[stage.status];
    if (index === 0) { svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', t('core.title') + ' · ' + record.title); }
    else svg.setAttribute('aria-hidden', 'true');
    map.append(card);
  });
  const caption = document.createElement('p');
  caption.className = 'ot-caption';
  caption.textContent = t(statuses.every(s => s === 'waiting') ? 'core.t.idle' : 'core.t.trace');
  box.append(map, caption);
  host.append(box);
};
