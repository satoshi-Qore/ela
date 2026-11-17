import { dianaChainHex, evmEndpoint } from './get-evm-block-number.ts';
import { isRecord, QORECHAIN_TESTNET, QoreChainReadError, readJson } from './read-client.ts';
import type { ReadOptions } from './read-client.ts';

/**
 * Status of one EVM transaction on Diana testnet, read from the official Diana EVM JSON-RPC (the
 * Diana endpoint a browser page may read: it allows CORS). Read-only: only `eth_chainId`,
 * `eth_getTransactionByHash`, and `eth_getTransactionReceipt` are sent, to the fixed endpoint.
 *
 * - `not_found`: the node knows no transaction with this hash. Cosmos-native transactions are not
 *   visible through the EVM JSON-RPC, so they are reported as not found too.
 * - `pending`: the node knows the transaction, but it is not in a block yet.
 * - `success` / `failed`: the transaction is in a block; its receipt status is 0x1 / 0x0.
 */

export type TransactionStatus = 'not_found' | 'pending' | 'success' | 'failed';

export interface EvmTransaction {
  readonly chainId: string;
  readonly evmChainId: string;
  readonly hash: string;
  readonly status: TransactionStatus;
  /** Present once the transaction is in a block. */
  readonly blockNumber?: string;
  readonly from?: string;
  /** The recipient; absent for a contract creation (see `contractAddress`). */
  readonly to?: string;
  readonly contractAddress?: string;
  /** The value sent, in QOR (exact, up to 18 decimals). */
  readonly valueQor?: string;
  readonly nonce?: string;
  readonly gasUsed?: string;
}

/** A transaction hash: 0x and exactly 64 hexadecimal digits. */
export const TX_HASH = /^0x[0-9a-f]{64}$/iu;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/u;
const ADDRESS = /^0x[0-9a-f]{40}$/u;

function invalid(what: string): never {
  throw new QoreChainReadError('invalid_response', 'Invalid EVM transaction data: ' + what + '.');
}

const quantity = (value: unknown, what: string): string =>
  typeof value === 'string' && QUANTITY.test(value) ? BigInt(value).toString() : invalid(what);
const address = (value: unknown, what: string): string =>
  typeof value === 'string' && ADDRESS.test(value.toLowerCase()) ? value.toLowerCase() : invalid(what);

function qor(base: string): string {
  const digits = base.padStart(19, '0');
  const fraction = digits.slice(-18).replace(/0+$/u, '');
  return digits.slice(0, -18) + (fraction ? '.' + fraction : '');
}

type Method = 'eth_chainId' | 'eth_getTransactionByHash' | 'eth_getTransactionReceipt';

async function call(id: number, method: Method, params: readonly string[], options: ReadOptions): Promise<unknown> {
  const body = await readJson(new URL(evmEndpoint), options, JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  if (!isRecord(body) || body.jsonrpc !== '2.0' || body.id !== id || !('result' in body)) {
    throw new QoreChainReadError('invalid_response', 'Invalid EVM JSON-RPC response for ' + method + '.');
  }
  return body.result;
}

export async function getEvmTransaction(hash: string, options: ReadOptions = {}): Promise<EvmTransaction> {
  // The hash is checked before any request is sent.
  if (typeof hash !== 'string' || !TX_HASH.test(hash)) {
    throw new QoreChainReadError('invalid_response', 'Expected a transaction hash: 0x and 64 hexadecimal digits.');
  }
  const txHash = hash.toLowerCase();
  const chain = await call(1, 'eth_chainId', [], options);
  if (chain !== dianaChainHex) {
    throw new QoreChainReadError('chain_mismatch', 'EVM JSON-RPC did not report the Diana testnet chain ID (9800).');
  }
  const base = { chainId: QORECHAIN_TESTNET.chainId, evmChainId: BigInt(dianaChainHex).toString(), hash: txHash };

  const tx = await call(2, 'eth_getTransactionByHash', [txHash], options);
  if (tx === null) return { ...base, status: 'not_found' };
  if (!isRecord(tx) || typeof tx.hash !== 'string' || tx.hash.toLowerCase() !== txHash) invalid('transaction hash');
  // A transaction signed for another chain is never reported as a Diana transaction.
  if (tx.chainId !== undefined && tx.chainId !== null && tx.chainId !== dianaChainHex) {
    throw new QoreChainReadError('chain_mismatch', 'The transaction was not signed for the Diana testnet chain ID (9800).');
  }
  const details = {
    from: address(tx.from, 'sender'),
    ...(tx.to === null || tx.to === undefined ? {} : { to: address(tx.to, 'recipient') }),
    valueQor: qor(quantity(tx.value, 'value')),
    nonce: quantity(tx.nonce, 'nonce'),
  };
  if (tx.blockNumber === null || tx.blockNumber === undefined) return { ...base, status: 'pending', ...details };
  const blockNumber = quantity(tx.blockNumber, 'block number');

  const receipt = await call(3, 'eth_getTransactionReceipt', [txHash], options);
  // In a block but without a receipt: the node has not indexed it yet; nothing is guessed.
  if (receipt === null) throw new QoreChainReadError('invalid_response', 'The transaction is in a block, but the node returned no receipt yet.');
  if (!isRecord(receipt) || typeof receipt.transactionHash !== 'string' || receipt.transactionHash.toLowerCase() !== txHash) invalid('receipt hash');
  if (quantity(receipt.blockNumber, 'receipt block number') !== blockNumber) invalid('receipt block number');
  const status = receipt.status === '0x1' ? 'success' : receipt.status === '0x0' ? 'failed' : invalid('receipt status');
  return {
    ...base,
    status,
    blockNumber,
    ...details,
    ...(receipt.contractAddress === null || receipt.contractAddress === undefined ? {} : { contractAddress: address(receipt.contractAddress, 'contract address') }),
    gasUsed: quantity(receipt.gasUsed, 'gas used'),
  };
}
