import './web.css';
import { createSession } from './agent/session.ts';
import type { CommandResult } from './agent/session.ts';
import type { StepResult } from './agent/executor.ts';
import type { ToolError } from './agent/registry.ts';

// Every command goes through one agent session: input checks and the safety gate first, then the
// deterministic routes and the rule-based classifier, then only the registry's read-only tool
// (eth_chainId, eth_blockNumber on Diana testnet). This file only renders the session's results.
//
// Interface text lives in the #ela-i18n catalog in index.html (English and Turkish), so switching
// the language costs the main chunk almost nothing. Text that comes from the agent itself (step
// titles and details, reader summaries and error messages) and the verifier's results stay English.

type QueryState = 'Ready' | 'Querying' | 'Success' | 'Partial' | 'Needs clarification' | 'Refused' | 'Unsupported' | 'Error';
type Lang = 'en' | 'tr';

const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
const form = $<HTMLFormElement>('#command-form');
const command = $<HTMLTextAreaElement>('#command');
const run = $<HTMLButtonElement>('#run');
const state = $('#query-state');
const message = $('#query-message');
const blockNumber = $('#block-number');
const chainId = $('#chain-id');
const evmChainId = $('#evm-chain-id');
const lastRead = $('#last-read');
const plan = $('#plan');
const planTarget = $('#plan-target');
const planSteps = $<HTMLOListElement>('#plan-steps');
const planSource = $('#plan-source');
const contextStatus = $('#context-status');
const clearContext = $<HTMLButtonElement>('#clear-context');
const networkStatus = $('#network-status');

// --- Language ---------------------------------------------------------------------------------

const catalog = JSON.parse($('#ela-i18n').textContent!) as Record<Lang, Record<string, string>>;
// Kept here because it names the agent session, which index.html must not mention.
catalog.en['clarify.no_context'] = 'There is no earlier successful query in this page session to follow up on. Ask for the latest block number on Diana testnet or ask ELA to check the Diana network first.';
let lang: Lang = 'en';
/** Looks a key up in the current language, then English; text that is not a key passes through. */
const L = (key: string): string => catalog[lang][key] ?? catalog.en[key] ?? key;

// Elements whose text was written at run time, as the keys (or raw agent text) they were built from.
const written = new Map<HTMLElement, readonly string[]>();
function put(element: HTMLElement, ...parts: string[]): void {
  written.set(element, parts);
  element.textContent = parts.map(L).join('');
}

// Static text: [data-i18n] text, [data-i18n-label] aria-label, [data-i18n-ph] placeholder. The
// English original is taken from the markup.
const statics = [...document.querySelectorAll<HTMLElement>('[data-i18n],[data-i18n-label],[data-i18n-ph]')].map(element => {
  const d = element.dataset;
  return [element, d.i18n, element.textContent, d.i18nLabel, element.getAttribute('aria-label'), d.i18nPh, element.getAttribute('placeholder')] as const;
});

function setLanguage(next: Lang): void {
  lang = next;
  const tr = (key: string | undefined, english: string | null): string => (next === 'tr' && key && catalog.tr[key]) || english || '';
  document.documentElement.lang = next;
  document.title = L('title');
  for (const [element, text, english, label, englishLabel, ph, englishPh] of statics) {
    if (text) element.textContent = tr(text, english);
    if (label) element.setAttribute('aria-label', tr(label, englishLabel));
    if (ph) element.setAttribute('placeholder', tr(ph, englishPh));
  }
  $('.pqc-lang-note').hidden = next === 'en';
  for (const [element, parts] of written) element.textContent = parts.map(L).join('');
  for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-lang]')) button.setAttribute('aria-pressed', String(button.dataset.lang === next));
}

for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-lang]')) {
  button.addEventListener('click', () => setLanguage(button.dataset.lang as Lang));
}

// --- Agent session ----------------------------------------------------------------------------

// In-memory only: a page reload starts a new session with no context.
const session = createSession();

function showStatus(next: QueryState, ...detail: string[]): void {
  state.dataset.state = next.toLowerCase();
  put(state, 'state.' + state.dataset.state);
  put(message, ...detail);
}

function showContext(): void {
  const current = session.context;
  put(contextStatus, current ? 'ctx.' + current.kind : 'ctx.none');
  clearContext.disabled = !current;
}

// Execution flow (Command, Safety gate, Intent & scope, Network check, Data read, Result). Each
// stage shows only what the session reported for the last command; a stage that did not run says so.
const stages = [...document.querySelectorAll<HTMLElement>('#flow > li')];
const links = [...document.querySelectorAll<HTMLElement>('[data-link]')];
const mark = (items: HTMLElement[], states: string[], selector: string): void =>
  items.forEach((item, i) => { item.dataset.state = states[i]; put(item.querySelector(selector)!, 'fs.' + states[i]); });
const flow = (states: string): void => mark(stages, states.split(' '), '.flow-state');

/**
 * The header chip and the Diana route report only what the last query in this session actually
 * saw: the route's two links are the network-check and data-read stages of that query.
 */
function showNetwork(outcome: 'ok' | 'partial' | 'error', states: string): void {
  $('.net-chip').dataset.state = outcome;
  put(networkStatus, 'net.' + outcome);
  if (outcome === 'ok') lastRead.textContent = new Date().toLocaleTimeString(lang);
  flow(states);
  mark(links, states.split(' ').slice(3, 5), '.seg-state');
}

function describeFailure(error: ToolError): string {
  if (error.code === 'network_error') return 'fail.network';
  return error.code === 'unexpected_error' ? 'fail.unexpected' : error.message;
}

// Example buttons (English first, then Turkish) only fill the command field; they never submit.
for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-example]')) {
  button.addEventListener('click', () => {
    command.value = button.dataset.example ?? '';
    command.focus();
  });
}

clearContext.addEventListener('click', () => {
  session.clear();
  showContext();
  command.focus();
});

function renderSteps(steps: readonly StepResult[]): void {
  for (const item of planSteps.children) for (const child of item.children) written.delete(child as HTMLElement);
  planSteps.replaceChildren(...steps.map(step => {
    const item = document.createElement('li');
    item.dataset.status = step.status;
    const mark = document.createElement('span');
    mark.className = 'step-mark';
    put(mark, 'step.' + step.status);
    const title = document.createElement('span');
    title.className = 'step-title';
    title.lang = 'en';
    const method = document.createElement('code');
    method.textContent = step.rpcMethod;
    title.append(step.title + ' ', method);
    const detail = document.createElement('span');
    detail.className = 'step-detail';
    detail.lang = 'en';
    detail.textContent = step.detail;
    item.append(mark, title, detail);
    return item;
  }));
}

function showData(data: { readonly chainId: string; readonly evmChainId: string; readonly blockNumber: string }): void {
  blockNumber.textContent = data.blockNumber;
  chainId.textContent = data.chainId;
  evmChainId.textContent = data.evmChainId;
}

/** Renders a query the session ran. The session already recorded the outcome in its context. */
function showAnswer(result: Extract<CommandResult, { kind: 'answered' }>): void {
  const basedOn = result.decision.basedOn;
  const note = basedOn ? 'note.' + basedOn : '';
  // A query ran: its own data replaces the readout (and "—" stays where it returned none).
  blockNumber.textContent = chainId.textContent = evmChainId.textContent = '—';

  if (result.run.kind === 'network_check') {
    const checked = result.run.result;
    put(planTarget, 'plan.target');
    renderSteps(checked.steps);
    put(planSource, 'plan.source', checked.source, 'plan.checked', new Date(checked.checkedAt).toLocaleString(lang));
    plan.hidden = false;
    if (checked.data) showData(checked.data);
    const outcome = checked.status === 'success' ? 'Success' : checked.status === 'partial' ? 'Partial' : 'Error';
    const step = (i: number): string => (s => (s === 'succeeded' ? 'ok' : s ?? 'unknown'))(checked.steps[i]?.status);
    showNetwork(outcome === 'Success' ? 'ok' : outcome === 'Partial' ? 'partial' : 'error', `done pass recognized ${step(0)} ${step(1)} ${outcome.toLowerCase()}`);
    showStatus(outcome, note, checked.summary);
    return;
  }

  const read = result.run.result;
  if (read.ok) {
    showData(read.data as { chainId: string; evmChainId: string; blockNumber: string });
    showNetwork('ok', 'done pass recognized ok ok success');
    showStatus('Success', note, 'msg.blockOk');
  } else {
    // The latest-block tool reports one error, not which of its two reads failed.
    showNetwork('error', 'done pass recognized unknown unknown error');
    showStatus('Error', note, describeFailure(read.error));
  }
}

function showResult(result: CommandResult): void {
  switch (result.kind) {
    case 'answered':
      showAnswer(result);
      return;
    case 'refused':
      // Do not keep secrets on screen.
      if (result.reason === 'key_material') command.value = '';
      flow('done blocked idle idle idle refused');
      showStatus('Refused', 'refused.' + result.reason, 'refused.tail');
      return;
    case 'unsupported':
      flow('done pass unsupported idle idle unsupported');
      showStatus('Unsupported', 'msg.unsupported');
      return;
    case 'clarify': {
      const key = 'clarify.' + result.reason;
      const r = result.reason;
      // These three input checks run before the safety gate (see the order in src/agent/intent.ts).
      const early = r === 'empty_command' || r === 'command_too_long' || (r === 'not_understood' && result.decision.source === 'input_check');
      flow(early ? 'stopped idle idle idle idle clarify' : 'done pass clarify idle idle clarify');
      showStatus('Needs clarification', key in catalog.en ? key : 'clarify.generic');
      return;
    }
    default:
      flow('done unknown unknown idle idle error');
      showStatus('Error', 'msg.failed');
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  // One command at a time: a submit while a query runs is ignored.
  if (run.disabled) return;
  run.disabled = true;

  plan.hidden = true;
  planSteps.replaceChildren();
  flow('done wait wait wait wait wait');
  showStatus('Querying', 'msg.working');

  try {
    showResult(await session.handleCommand(command.value));
  } catch {
    showStatus('Error', 'msg.failed');
  } finally {
    run.disabled = false;
    showContext();
  }
});

put(networkStatus, 'net.unchecked');
mark(links, ['idle', 'idle'], '.seg-state');
flow('idle idle idle idle idle idle');
showStatus('Ready', 'msg.ready');
showContext();

// Post-quantum verification panel. It is closed at first; opening it loads its module and the
// ML-DSA-87 verifier as a separate chunk. It has its own controls and does not use the session.
const pqcToggle = $<HTMLButtonElement>('#pqc-toggle');
const pqcBody = $('#pqc-body');
const pqcLoading = $('#pqc-loading');
let pqcLoad: Promise<void> | undefined;
put(pqcToggle, 'pqc.open');
put(pqcLoading, 'pqc.loading');

pqcToggle.addEventListener('click', () => {
  const open = pqcBody.hidden;
  pqcBody.hidden = !open;
  pqcToggle.setAttribute('aria-expanded', String(open));
  put(pqcToggle, open ? 'pqc.close' : 'pqc.open');
  if (open && !pqcLoad) {
    pqcLoad = import('./pqc/panel.ts')
      .then(panel => panel.mountPanel(pqcBody))
      .catch(() => {
        pqcLoad = undefined;
        put(pqcLoading, 'pqc.loadFail');
      });
  }
});
