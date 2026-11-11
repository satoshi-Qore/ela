import './web.css';
import { routeCommand } from './router.ts';
import { getEvmBlockNumber } from './qorechain/get-evm-block-number.ts';
import { QoreChainReadError } from './qorechain/read-client.ts';
import { planCommand } from './agent/planner.ts';
import type { NetworkCheckPlan } from './agent/planner.ts';
import { executePlan } from './agent/executor.ts';
import type { StepResult } from './agent/executor.ts';

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

function showStatus(next: QueryState, detail: string): void {
  state.dataset.state = next.toLowerCase();
  state.textContent = next;
  message.textContent = detail;
}

function describeFailure(error: unknown): string {
  if (!(error instanceof QoreChainReadError)) return 'The query failed unexpectedly.';
  if (error.code === 'network_error') {
    return 'The browser could not read the testnet EVM JSON-RPC. Check your connection. The endpoint may restrict cross-origin requests (CORS).';
  }
  return error.message;
}

document.querySelector<HTMLButtonElement>('#example')!.addEventListener('click', () => {
  command.value = example;
  command.focus();
});

document.querySelector<HTMLButtonElement>('#example-network')!.addEventListener('click', () => {
  command.value = networkExample;
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

async function runPlan(selected: NetworkCheckPlan): Promise<void> {
  planTarget.textContent = 'Target: ' + selected.target.name + ' · EVM chain ' + selected.target.evmChainId;
  planSource.textContent = 'Source: ' + selected.target.endpoint;
  renderSteps(selected.steps.map(step => ({ ...step, status: 'pending', detail: 'Waiting to run.' })));
  plan.hidden = false;
  showStatus('Querying', 'Running ' + selected.steps.length + ' read-only steps against ' + selected.target.name + '…');

  const result = await executePlan(selected);
  renderSteps(result.steps);
  planSource.textContent = 'Source: ' + result.source + ' · checked ' + new Date(result.checkedAt).toLocaleString();
  if (result.data) {
    blockNumber.textContent = result.data.blockNumber;
    chainId.textContent = result.data.chainId;
    evmChainId.textContent = result.data.evmChainId;
  }
  showStatus(result.status === 'success' ? 'Success' : result.status === 'partial' ? 'Partial' : 'Error', result.summary);
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (run.disabled) return;

  blockNumber.textContent = '—';
  chainId.textContent = '—';
  evmChainId.textContent = '—';
  plan.hidden = true;
  planSteps.replaceChildren();

  const selected = planCommand(command.value);
  if (selected.kind === 'plan') {
    run.disabled = true;
    try {
      await runPlan(selected);
    } catch {
      showStatus('Error', 'The network check failed unexpectedly.');
    } finally {
      run.disabled = false;
    }
    return;
  }

  const route = routeCommand(command.value);
  if (route.kind !== 'route' || route.tool !== 'get_block_number') {
    showStatus('Needs clarification', 'Ask for the latest block number on Diana testnet, ask ELA to check the Diana network, or use an example command.');
    return;
  }
  if (route.network === 'mainnet') {
    showStatus('Needs clarification', 'This interface queries Diana testnet. Please ask for the testnet block number.');
    return;
  }

  run.disabled = true;
  showStatus('Querying', 'Reading the latest block from Diana testnet…');
  try {
    const result = await getEvmBlockNumber();
    blockNumber.textContent = result.blockNumber;
    chainId.textContent = result.chainId;
    evmChainId.textContent = result.evmChainId;
    showStatus('Success', 'Latest block received from Diana testnet via EVM JSON-RPC.');
  } catch (error) {
    showStatus('Error', describeFailure(error));
  } finally {
    run.disabled = false;
  }
});
