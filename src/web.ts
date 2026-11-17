import './web.css';
import { createSession } from './agent/session.ts';
import type { CommandResult } from './agent/session.ts';
import type { ExecutionResult, StepResult } from './agent/executor.ts';
import type { ToolError } from './agent/registry.ts';

// Every command goes through one agent session: input checks and the safety gate first, then the
// deterministic routes and the rule-based classifier, then only the registry's read-only tool
// (eth_chainId, eth_blockNumber on Diana testnet). This file only renders the session's results.
//
// Interface text lives in the #ela-i18n catalog in index.html (English and Turkish), so switching
// the language costs the main chunk almost nothing. Text the agent itself writes (step titles and
// details, summaries, error messages) is shown as written in English; in Turkish it is rebuilt from
// the structured result (step id and status, error code, data). An error code without a Turkish
// text gets a generic one instead of a guess. Technical values (numbers, URLs, RPC method names,
// error codes) are inserted unchanged.

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
type Vars = Readonly<Record<string, string | number>>;
/** A catalog text with its {name} slots filled. */
const F = (key: string, vars: Vars = {}): string => L(key).replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name]));
/** A catalog key, raw text, or a function that builds the text in the current language. */
export type Part = string | (() => string);
/** Agent text: as the agent wrote it in English; in Turkish, the catalog text built from the same result. */
const A = (english: string, key: string, vars?: Vars): Part => () => lang === 'en' || !catalog.tr[key] ? english : F(key, vars);
/** An error code as [catalog key, slots]. A code without a Turkish text gets the generic one. */
function errorKey(code: string, english: string): [string, Vars] {
  const status = /HTTP (\d{3})\.$/.exec(english)?.[1];
  return catalog.tr['err.' + code] && (code !== 'http_error' || status) ? ['err.' + code, { status: status! }] : ['err.generic', {}];
}

// Elements whose text was written at run time, as the parts they were built from. A language switch
// rebuilds the text from these parts; nothing is queried again.
const written = new Map<HTMLElement, readonly Part[]>();
const render = (parts: readonly Part[]): string => parts.map(part => typeof part === 'string' ? L(part) : part()).join('');
function put(element: HTMLElement, ...parts: Part[]): void {
  written.set(element, parts);
  element.textContent = render(parts);
}
export type Put = typeof put;
export type Format = typeof F;

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
  for (const [element, parts] of written) element.textContent = render(parts);
  for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-lang]')) button.setAttribute('aria-pressed', String(button.dataset.lang === next));
}

for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-lang]')) {
  button.addEventListener('click', () => setLanguage(button.dataset.lang as Lang));
}

// --- Agent session ----------------------------------------------------------------------------

// In-memory only: a page reload starts a new session with no context.
const session = createSession();

function showStatus(next: QueryState, ...detail: Part[]): void {
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
  const read = new Date();
  if (outcome === 'ok') put(lastRead, () => read.toLocaleTimeString(lang));
  flow(states);
  mark(links, states.split(' ').slice(3, 5), '.seg-state');
}

function describeFailure(error: ToolError): Part {
  if (error.code === 'network_error') return 'fail.network';
  return error.code === 'unexpected_error' ? 'fail.unexpected' : A(error.message, ...errorKey(error.code, error.message));
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

/**
 * A step's detail in the current language, from the step's id and status and the check's result.
 * Diana's fixed chain identity (9800, 0x2648) is part of the catalog text, like "plan.target".
 */
function stepDetail(step: StepResult, checked: ExecutionResult): Part {
  const code = checked.error?.code ?? '';
  if (step.status === 'skipped') return A(step.detail, code === 'tool_not_allowed' ? 'det.refused' : 'det.skipped');
  if (step.status === 'succeeded') {
    // The chain-ID step only succeeds when the endpoint reported Diana's chain ID.
    return step.id === 'verify_chain_id' ? A(step.detail, 'det.chain')
      : checked.data ? A(step.detail, 'det.block', { block: checked.data.blockNumber }) : A(step.detail, 'det.done');
  }
  // The reported value is shown exactly as the agent quoted it.
  const reported = code === 'chain_mismatch' && /^Endpoint reported (.+); expected /.exec(step.detail)?.[1];
  return reported ? A(step.detail, 'det.mismatch', { reported }) : A(step.detail, ...errorKey(code, step.detail));
}

function checkSummary(checked: ExecutionResult): Part {
  const { code = '', message = '' } = checked.error ?? {};
  return () => lang === 'en' ? checked.summary
    : checked.data ? F('sum.ok', { evm: checked.data.evmChainId, block: checked.data.blockNumber })
    : code === 'chain_mismatch' || code === 'tool_not_allowed' ? L('sum.' + code)
    : F('sum.' + checked.status, { reason: F(...errorKey(code, message)) });
}

function renderSteps(checked: ExecutionResult): void {
  for (const item of planSteps.children) for (const child of item.querySelectorAll('span')) written.delete(child);
  const span = (name: string, ...parts: Part[]): HTMLElement => {
    const element = document.createElement('span');
    element.className = name;
    put(element, ...parts);
    return element;
  };
  planSteps.replaceChildren(...checked.steps.map(step => {
    const item = document.createElement('li');
    item.dataset.status = step.status;
    // The title text has its own span, so a language switch rewrites it and keeps the method name.
    const title = document.createElement('span');
    title.className = 'step-title';
    const method = document.createElement('code');
    method.textContent = step.rpcMethod;
    title.append(span('', A(step.title, 'stepT.' + step.id)), ' ', method);
    item.append(span('step-mark', 'step.' + step.status), title, span('step-detail', stepDetail(step, checked)));
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
    renderSteps(checked);
    put(planSource, 'plan.source', checked.source, 'plan.checked', () => new Date(checked.checkedAt).toLocaleString(lang));
    plan.hidden = false;
    if (checked.data) showData(checked.data);
    const outcome = checked.status === 'success' ? 'Success' : checked.status === 'partial' ? 'Partial' : 'Error';
    const step = (i: number): string => (s => (s === 'succeeded' ? 'ok' : s ?? 'unknown'))(checked.steps[i]?.status);
    showNetwork(outcome === 'Success' ? 'ok' : outcome === 'Partial' ? 'partial' : 'error', `done pass recognized ${step(0)} ${step(1)} ${outcome.toLowerCase()}`);
    showStatus(outcome, note, checkSummary(checked));
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
      .then(panel => panel.mountPanel(pqcBody, put, F))
      .catch(() => {
        pqcLoad = undefined;
        put(pqcLoading, 'pqc.loadFail');
      });
  }
});
