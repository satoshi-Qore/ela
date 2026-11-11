import './web.css';
import { routeCommand } from './router.ts';
import { getEvmBlockNumber } from './qorechain/get-evm-block-number.ts';
import { QoreChainReadError } from './qorechain/read-client.ts';

type QueryState = 'Ready' | 'Querying' | 'Success' | 'Needs clarification' | 'Error';

const example = 'QoreChain son blok numarasını öğren.';
const form = document.querySelector<HTMLFormElement>('#command-form')!;
const command = document.querySelector<HTMLTextAreaElement>('#command')!;
const run = document.querySelector<HTMLButtonElement>('#run')!;
const state = document.querySelector<HTMLElement>('#query-state')!;
const message = document.querySelector<HTMLElement>('#query-message')!;
const blockNumber = document.querySelector<HTMLElement>('#block-number')!;
const chainId = document.querySelector<HTMLElement>('#chain-id')!;
const evmChainId = document.querySelector<HTMLElement>('#evm-chain-id')!;

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

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (run.disabled) return;

  blockNumber.textContent = '—';
  chainId.textContent = '—';
  evmChainId.textContent = '—';
  const route = routeCommand(command.value);
  if (route.kind !== 'route' || route.tool !== 'get_block_number') {
    showStatus('Needs clarification', 'Ask for the latest block number on Diana testnet, or use the example command.');
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
