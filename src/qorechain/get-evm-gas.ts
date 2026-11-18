import { dianaChainHex, evmEndpoint } from './get-evm-block-number.ts';
import { isRecord, QORECHAIN_TESTNET, QoreChainReadError, readJson } from './read-client.ts';
import type { ReadOptions } from './read-client.ts';

/**
 * Current gas price and fee data on Diana testnet, read from the official Diana EVM JSON-RPC (the
 * Diana endpoint a browser page may read: it allows CORS). Read-only: only `eth_chainId`,
 * `eth_gasPrice`, `eth_feeHistory` (one block, no reward percentiles), and
 * `eth_maxPriorityFeePerGas` are sent, to the fixed endpoint. Nothing is built, signed, or sent.
 *
 * `eth_gasPrice` is required. The other two are reported only when the node answers them: a
 * JSON-RPC error for either (for example "method not found") leaves that value out, and the status
 * says which values are present. Nothing is derived or guessed in their place.
 *
 * - `full`: gas price, base fee of the latest block, and the node's suggested priority fee.
 * - `base`: gas price and base fee; the node gave no priority fee.
 * - `priority`: gas price and priority fee; the node gave no fee history.
 * - `price`: gas price only.
 *
 * The transfer fee is `21000 × gas price`: what a plain QOR transfer, which uses exactly 21,000
 * gas, would cost at this price. Other transactions use more gas, and the price can change.
 */

export type GasStatus = 'full' | 'base' | 'priority' | 'price';

export interface EvmGas {
  readonly chainId: string;
  readonly evmChainId: string;
  readonly status: GasStatus;
  /** All amounts as exact decimals: wei as an integer, gwei and QOR with the digits they need. */
  readonly gasPriceWei: string;
  readonly gasPriceGwei: string;
  /** Present for `full` and `base`: the latest block and its base fee per gas. */
  readonly blockNumber?: string;
  readonly baseFeeWei?: string;
  readonly baseFeeGwei?: string;
  /** Present for `full` and `priority`: the node's suggested priority fee per gas. */
  readonly priorityFeeWei?: string;
  readonly priorityFeeGwei?: string;
  /** The gas a standard QOR transfer uses, and its fee at `gasPriceWei`. */
  readonly transferGas: string;
  readonly transferFeeWei: string;
  readonly transferFeeGwei: string;
  readonly transferFeeQor: string;
}

/** The gas a plain native transfer uses on an EVM chain. */
export const TRANSFER_GAS = 21_000n;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/u;

function invalid(what: string): never {
  throw new QoreChainReadError('invalid_response', 'Invalid EVM fee data: ' + what + '.');
}

const quantity = (value: unknown, what: string): bigint =>
  typeof value === 'string' && QUANTITY.test(value) ? BigInt(value) : invalid(what);

/** `value / 10^decimals` as an exact decimal, without trailing zeros. */
export function formatUnits(value: bigint, decimals: number): string {
  const digits = value.toString().padStart(decimals + 1, '0');
  const fraction = digits.slice(-decimals).replace(/0+$/u, '');
  return digits.slice(0, -decimals) + (fraction ? '.' + fraction : '');
}

type Method = 'eth_chainId' | 'eth_gasPrice' | 'eth_feeHistory' | 'eth_maxPriorityFeePerGas';

/**
 * Sends one request. With `optional`, a well-formed JSON-RPC error answer returns `undefined` (the
 * node does not provide that value); anything else that is not a result is a broken response.
 */
async function call(id: number, method: Method, params: readonly unknown[], options: ReadOptions, optional = false): Promise<unknown> {
  const body = await readJson(new URL(evmEndpoint), options, JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  if (isRecord(body) && body.jsonrpc === '2.0' && body.id === id) {
    if ('result' in body && !('error' in body)) return body.result;
    if (optional && !('result' in body) && isRecord(body.error) && Number.isInteger(body.error.code)) return undefined;
  }
  throw new QoreChainReadError('invalid_response', 'Invalid EVM JSON-RPC response for ' + method + '.');
}

export async function getEvmGas(options: ReadOptions = {}): Promise<EvmGas> {
  const chain = await call(1, 'eth_chainId', [], options);
  if (chain !== dianaChainHex) {
    throw new QoreChainReadError('chain_mismatch', 'EVM JSON-RPC did not report the Diana testnet chain ID (9800).');
  }
  const gasPrice = quantity(await call(2, 'eth_gasPrice', [], options), 'gas price');

  // One block, the latest, without reward percentiles: its number and base fee.
  const history = await call(3, 'eth_feeHistory', ['0x1', 'latest', []], options, true);
  let base: { blockNumber: string; baseFeeWei: string; baseFeeGwei: string } | undefined;
  if (history !== undefined) {
    if (!isRecord(history)) invalid('fee history');
    const { baseFeePerGas: fees, gasUsedRatio: ratios } = history;
    // `baseFeePerGas` has one entry per block plus the next block's; `gasUsedRatio` one per block.
    if (!Array.isArray(fees) || fees.length !== 2 || !Array.isArray(ratios) || ratios.length !== 1
      || typeof ratios[0] !== 'number' || !(ratios[0] >= 0 && ratios[0] <= 1)) invalid('fee history');
    const fee = quantity(fees[0], 'base fee');
    quantity(fees[1], 'next base fee');
    base = { blockNumber: quantity(history.oldestBlock, 'fee history block').toString(), baseFeeWei: fee.toString(), baseFeeGwei: formatUnits(fee, 9) };
  }

  const tip = await call(4, 'eth_maxPriorityFeePerGas', [], options, true);
  const priority = tip === undefined ? undefined : quantity(tip, 'priority fee');

  const transferFee = TRANSFER_GAS * gasPrice;
  return {
    chainId: QORECHAIN_TESTNET.chainId,
    evmChainId: BigInt(dianaChainHex).toString(),
    status: base ? (priority === undefined ? 'base' : 'full') : (priority === undefined ? 'price' : 'priority'),
    gasPriceWei: gasPrice.toString(),
    gasPriceGwei: formatUnits(gasPrice, 9),
    ...base,
    ...(priority === undefined ? {} : { priorityFeeWei: priority.toString(), priorityFeeGwei: formatUnits(priority, 9) }),
    transferGas: TRANSFER_GAS.toString(),
    transferFeeWei: transferFee.toString(),
    transferFeeGwei: formatUnits(transferFee, 9),
    transferFeeQor: formatUnits(transferFee, 18),
  };
}
