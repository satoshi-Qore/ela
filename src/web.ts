import './web.css';
import { createSession } from './agent/session.ts';
import type { CommandResult } from './agent/session.ts';
import type { QueryKind } from './agent/conversation.ts';
import type { StepResult } from './agent/executor.ts';
import type { ClarifyReason, RiskCategory } from './agent/intent.ts';
import type { ToolError } from './agent/registry.ts';

// Every command goes through one agent session: input checks and the safety gate first, then the
// deterministic routes and the rule-based classifier, then only the registry's read-only tool
// (eth_chainId, eth_blockNumber on Diana testnet). This file only renders the session's results.

type QueryState = 'Ready' | 'Querying' | 'Success' | 'Partial' | 'Needs clarification' | 'Refused' | 'Unsupported' | 'Error';

const TARGET = 'Target: Diana testnet · EVM chain 9800';
const form = document.querySelector<HTMLFormElement>('#command-form')!;
const command = document.querySelector<HTMLTextAreaElement>('#command')!;
const run = document.querySelector<HTMLButtonElement>('#run')!;
const state = document.querySelector<HTMLElement>('#query-state')!;
const message = document.querySelector<HTMLElement>('#query-message')!;
const blockNumber = document.querySelector<HTMLElement>('#block-number')!;
const chainId = document.querySelector<HTMLElement>('#chain-id')!;
const evmChainId = document.querySelector<HTMLElement>('#evm-chain-id')!;
const plan = document.querySelector<HTMLElement>('#plan')!;
const planTarget = document.querySelector<HTMLElement>('#plan-target')!;
const planSteps = document.querySelector<HTMLOListElement>('#plan-steps')!;
const planSource = document.querySelector<HTMLElement>('#plan-source')!;
const contextStatus = document.querySelector<HTMLElement>('#context-status')!;
const clearContext = document.querySelector<HTMLButtonElement>('#clear-context')!;

// In-memory only: a page reload starts a new session with no context.
const session = createSession();
const kindLabels: Record<QueryKind, string> = { block_number: 'latest block query', network_check: 'Diana network check' };

const GENERIC_CLARIFICATION = 'Ask for the latest block number on Diana testnet, ask ELA to check the Diana network, or use an example command.';
const REFUSALS: Record<RiskCategory, string> = {
  transfer: 'ELA is read-only and cannot send, transfer, or withdraw funds.',
  signing: 'ELA does not sign or approve messages or transactions.',
  key_material: 'ELA never asks for or handles private keys, seed phrases, recovery phrases, or passwords. Do not share them. The command field was cleared.',
  wallet_control: 'ELA does not connect to, create, or control wallets.',
  state_change: 'ELA cannot deploy, stake, swap, mint, or otherwise change chain state; it only reads Diana testnet.',
};
const CLARIFICATIONS: Partial<Record<ClarifyReason, string>> = {
  empty_command: 'Type a command, for example "Check Diana network." or "Diana ağını kontrol et."',
  command_too_long: 'That command is too long. Keep it under 500 characters.',
  unsupported_network: 'This interface only reads Diana testnet. Other networks, such as mainnet, are not supported.',
  unsupported_parameters: 'ELA does not take addresses, hashes, or amounts yet. Ask for the latest block or a Diana network check.',
  no_context: 'There is no earlier successful query in this page session to follow up on. Ask for the latest block number on Diana testnet or ask ELA to check the Diana network first.',
};

function showStatus(next: QueryState, detail: string): void {
  state.dataset.state = next.toLowerCase();
  state.textContent = next;
  message.textContent = detail;
}

function showContext(): void {
  const current = session.context;
  contextStatus.textContent = current
    ? 'Context: last successful ' + kindLabels[current.kind] + ' · Diana testnet'
    : 'Context: none';
  clearContext.disabled = !current;
}

function describeFailure(error: ToolError): string {
  if (error.code === 'network_error') {
    return 'The browser could not read the testnet EVM JSON-RPC. Check your connection. The endpoint may restrict cross-origin requests (CORS).';
  }
  return error.code === 'unexpected_error' ? 'The query failed unexpectedly.' : error.message;
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
  planSteps.replaceChildren(...steps.map(step => {
    const item = document.createElement('li');
    item.dataset.status = step.status;
    const mark = document.createElement('span');
    mark.className = 'step-mark';
    mark.textContent = step.status;
    const title = document.createElement('span');
    title.className = 'step-title';
    const method = document.createElement('code');
    method.textContent = step.rpcMethod;
    title.append(step.title + ' ', method);
    const detail = document.createElement('span');
    detail.className = 'step-detail';
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
  const note = basedOn ? 'Follow-up to your last successful ' + kindLabels[basedOn] + '; fresh data requested. ' : '';

  if (result.run.kind === 'network_check') {
    const checked = result.run.result;
    planTarget.textContent = TARGET;
    renderSteps(checked.steps);
    planSource.textContent = 'Source: ' + checked.source + ' · checked ' + new Date(checked.checkedAt).toLocaleString();
    plan.hidden = false;
    if (checked.data) showData(checked.data);
    showStatus(checked.status === 'success' ? 'Success' : checked.status === 'partial' ? 'Partial' : 'Error', note + checked.summary);
    return;
  }

  const read = result.run.result;
  if (read.ok) {
    showData(read.data as { chainId: string; evmChainId: string; blockNumber: string });
    showStatus('Success', note + 'Latest block received from Diana testnet via EVM JSON-RPC.');
  } else {
    showStatus('Error', note + describeFailure(read.error));
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
      showStatus('Refused', REFUSALS[result.reason] + ' Nothing was sent. Ask for the latest block or a Diana network check instead.');
      return;
    case 'unsupported':
      showStatus('Unsupported', 'ELA can only check the Diana network and read its latest block. Balances, fees, transactions, and other data are not supported yet.');
      return;
    case 'clarify':
      showStatus('Needs clarification', CLARIFICATIONS[result.reason] ?? GENERIC_CLARIFICATION);
      return;
    default:
      showStatus('Error', 'The command failed unexpectedly. Nothing was changed.');
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  // One command at a time: a submit while a query runs is ignored.
  if (run.disabled) return;
  run.disabled = true;

  blockNumber.textContent = '—';
  chainId.textContent = '—';
  evmChainId.textContent = '—';
  plan.hidden = true;
  planSteps.replaceChildren();
  showStatus('Querying', 'Working on your command…');

  try {
    showResult(await session.handleCommand(command.value));
  } catch {
    showStatus('Error', 'The command failed unexpectedly. Nothing was changed.');
  } finally {
    run.disabled = false;
    showContext();
  }
});

showContext();

// Post-quantum verification panel. It is closed at first; opening it loads its module and the
// ML-DSA-87 verifier as a separate chunk. It has its own controls and does not use the session.
const pqcToggle = document.querySelector<HTMLButtonElement>('#pqc-toggle')!;
const pqcBody = document.querySelector<HTMLElement>('#pqc-body')!;
let pqcLoad: Promise<void> | undefined;

pqcToggle.addEventListener('click', () => {
  const open = pqcBody.hidden;
  pqcBody.hidden = !open;
  pqcToggle.setAttribute('aria-expanded', String(open));
  pqcToggle.textContent = open ? 'Close verifier' : 'Open verifier';
  if (open && !pqcLoad) {
    pqcLoad = import('./pqc/panel.ts')
      .then(panel => panel.mountPanel(pqcBody))
      .catch(() => {
        pqcLoad = undefined;
        document.querySelector<HTMLElement>('#pqc-loading')!.textContent = 'The verifier could not be loaded. Close and open the panel to try again.';
      });
  }
});
