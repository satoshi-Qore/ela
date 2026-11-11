import './web.css';
import { routeCommand } from './router.ts';
import { planCommand } from './agent/planner.ts';
import type { NetworkCheckPlan } from './agent/planner.ts';
import type { StepResult } from './agent/executor.ts';
import type { ToolError } from './agent/registry.ts';
import { createConversation, outcomeOf, resolveFollowUp, runQuery } from './agent/conversation.ts';
import type { FollowUp, QueryKind } from './agent/conversation.ts';

type QueryState = 'Ready' | 'Querying' | 'Success' | 'Partial' | 'Needs clarification' | 'Error';

const example = 'QoreChain son blok numarasını öğren.';
const networkExample = 'Diana ağını kontrol et.';
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

// In-memory only: a page reload starts a new conversation with no context.
const conversation = createConversation();
const kindLabels: Record<QueryKind, string> = { block_number: 'latest block query', network_check: 'Diana network check' };

function showStatus(next: QueryState, detail: string): void {
  state.dataset.state = next.toLowerCase();
  state.textContent = next;
  message.textContent = detail;
}

function showContext(): void {
  const current = conversation.current;
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

document.querySelector<HTMLButtonElement>('#example')!.addEventListener('click', () => {
  command.value = example;
  command.focus();
});

document.querySelector<HTMLButtonElement>('#example-network')!.addEventListener('click', () => {
  command.value = networkExample;
  command.focus();
});

clearContext.addEventListener('click', () => {
  conversation.clear();
  showContext();
  command.focus();
});

type StepView = Pick<StepResult, 'title' | 'rpcMethod' | 'detail'> & { status: StepResult['status'] | 'pending' };

function renderSteps(steps: readonly StepView[]): void {
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

function showPendingPlan(selected: NetworkCheckPlan): void {
  planTarget.textContent = 'Target: ' + selected.target.name + ' · EVM chain ' + selected.target.evmChainId;
  planSource.textContent = 'Source: ' + selected.target.endpoint;
  renderSteps(selected.steps.map(step => ({ ...step, status: 'pending', detail: 'Waiting to run.' })));
  plan.hidden = false;
  showStatus('Querying', 'Running ' + selected.steps.length + ' read-only steps against ' + selected.target.name + '…');
}

/** Runs a query with fresh RPC data, renders it, and records the outcome in the conversation. */
async function execute(kind: QueryKind, note = ''): Promise<void> {
  if (kind === 'network_check') {
    const selected = planCommand(networkExample);
    if (selected.kind === 'plan') showPendingPlan(selected);
  } else {
    showStatus('Querying', note + 'Reading the latest block from Diana testnet…');
  }

  const outcome = await runQuery(kind);
  conversation.record(kind, outcomeOf(outcome));

  if (outcome.kind === 'network_check') {
    const result = outcome.result;
    renderSteps(result.steps);
    planSource.textContent = 'Source: ' + result.source + ' · checked ' + new Date(result.checkedAt).toLocaleString();
    if (result.data) {
      blockNumber.textContent = result.data.blockNumber;
      chainId.textContent = result.data.chainId;
      evmChainId.textContent = result.data.evmChainId;
    }
    showStatus(result.status === 'success' ? 'Success' : result.status === 'partial' ? 'Partial' : 'Error', note + result.summary);
    return;
  }

  const result = outcome.result;
  if (result.ok) {
    const data = result.data as { chainId: string; evmChainId: string; blockNumber: string };
    blockNumber.textContent = data.blockNumber;
    chainId.textContent = data.chainId;
    evmChainId.textContent = data.evmChainId;
    showStatus('Success', note + 'Latest block received from Diana testnet via EVM JSON-RPC.');
  } else {
    showStatus('Error', note + describeFailure(result.error));
  }
}

function followUpNote(followUp: Extract<FollowUp, { kind: 'follow_up' }>): string {
  return 'Follow-up to your last successful ' + kindLabels[followUp.basedOn] + '; fresh data requested. ';
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (run.disabled) return;

  blockNumber.textContent = '—';
  chainId.textContent = '—';
  evmChainId.textContent = '—';
  plan.hidden = true;
  planSteps.replaceChildren();

  let kind: QueryKind;
  let note = '';
  const followUp = resolveFollowUp(command.value, conversation.current);
  if (planCommand(command.value).kind === 'plan') {
    kind = 'network_check';
  } else if (followUp.kind === 'follow_up') {
    kind = followUp.run;
    note = followUpNote(followUp);
  } else if (followUp.kind === 'needs_clarification') {
    showStatus('Needs clarification', 'There is no earlier successful query in this page session to follow up on. Ask for the latest block number on Diana testnet or ask ELA to check the Diana network first.');
    return;
  } else {
    const route = routeCommand(command.value);
    if (route.kind !== 'route' || route.tool !== 'get_block_number') {
      showStatus('Needs clarification', 'Ask for the latest block number on Diana testnet, ask ELA to check the Diana network, or use an example command.');
      return;
    }
    if (route.network === 'mainnet') {
      showStatus('Needs clarification', 'This interface queries Diana testnet. Please ask for the testnet block number.');
      return;
    }
    kind = 'block_number';
  }

  run.disabled = true;
  try {
    await execute(kind, note);
  } catch {
    showStatus('Error', kind === 'network_check' ? 'The network check failed unexpectedly.' : 'The query failed unexpectedly.');
  } finally {
    run.disabled = false;
    showContext();
  }
});

showContext();
