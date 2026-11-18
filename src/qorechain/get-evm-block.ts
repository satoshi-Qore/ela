import { dianaChainHex, evmEndpoint } from './get-evm-block-number.ts';
import { isRecord, QORECHAIN_TESTNET, QoreChainReadError, readJson } from './read-client.ts';
import type { ReadOptions } from './read-client.ts';

/**
 * One Diana testnet block by number, read from the official Diana EVM JSON-RPC (the Diana endpoint
 * a browser page may read: it allows CORS). Read-only: only `eth_chainId`, `eth_getBlockByNumber`
 * (without full transactions), and, when the block is not returned, `eth_blockNumber` are sent, to
 * the fixed endpoint.
 *
 * The node returns `null` both for a block that does not exist yet and for one older than the
 * history it keeps (it is pruned; `earliest` is its oldest kept block, not genesis). So a `null`
 * is explained, never guessed:
 *
 * - `found`: the block, with its hash, time, transaction count, gas used, and gas limit.
 * - `future`: the number is above the latest block (`latest`).
 * - `pruned`: the number is below the oldest block this node keeps (`earliest`).
 * - `not_found`: the node returned no block for a number in its range.
 */

export type BlockStatus = 'found' | 'future' | 'pruned' | 'not_found';

export interface EvmBlock {
  readonly chainId: string;
  readonly evmChainId: string;
  /** The requested block number, in decimal. */
  readonly requested: string;
  readonly status: BlockStatus;
  /** Present for `found`; all numbers in decimal. */
  readonly blockNumber?: string;
  readonly hash?: string;
  /** Unix seconds. */
  readonly timestamp?: string;
  /** The timestamp as UTC, `YYYY-MM-DD HH:MM:SS UTC`. */
  readonly time?: string;
  readonly transactionCount?: string;
  readonly gasUsed?: string;
  readonly gasLimit?: string;
  /** Present for `future`: the latest block. */
  readonly latest?: string;
  /** Present for `pruned`: the oldest block this node keeps. */
  readonly earliest?: string;
}

/** The largest block number ELA asks for. */
export const MAX_BLOCK_NUMBER = Number.MAX_SAFE_INTEGER;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/u;
const HASH = /^0x[0-9a-f]{64}$/u;
// Timestamps up to the end of year 9999, so the UTC text always has a four-digit year.
const MAX_TIMESTAMP = 253_402_300_799n;

function invalid(what: string): never {
  throw new QoreChainReadError('invalid_response', 'Invalid EVM block data: ' + what + '.');
}

const quantity = (value: unknown, what: string): bigint =>
  typeof value === 'string' && QUANTITY.test(value) ? BigInt(value) : invalid(what);

type Method = 'eth_chainId' | 'eth_getBlockByNumber' | 'eth_blockNumber';

async function call(id: number, method: Method, params: readonly unknown[], options: ReadOptions): Promise<unknown> {
  const body = await readJson(new URL(evmEndpoint), options, JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  if (!isRecord(body) || body.jsonrpc !== '2.0' || body.id !== id || !('result' in body)) {
    throw new QoreChainReadError('invalid_response', 'Invalid EVM JSON-RPC response for ' + method + '.');
  }
  return body.result;
}

/** Checks a block object and returns its number. */
function blockNumberOf(block: unknown, what: string): bigint {
  return isRecord(block) ? quantity(block.number, what) : invalid(what);
}

export async function getEvmBlock(number: number, options: ReadOptions = {}): Promise<EvmBlock> {
  // The number is checked before any request is sent.
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new QoreChainReadError('invalid_response', 'Expected a block number: a whole number from 0 to ' + MAX_BLOCK_NUMBER + '.');
  }
  const wanted = BigInt(number);
  const chain = await call(1, 'eth_chainId', [], options);
  if (chain !== dianaChainHex) {
    throw new QoreChainReadError('chain_mismatch', 'EVM JSON-RPC did not report the Diana testnet chain ID (9800).');
  }
  const base = { chainId: QORECHAIN_TESTNET.chainId, evmChainId: BigInt(dianaChainHex).toString(), requested: wanted.toString() };

  // `false`: transaction hashes only, never full transaction objects.
  const block = await call(2, 'eth_getBlockByNumber', ['0x' + wanted.toString(16), false], options);
  if (block === null) {
    const latest = quantity(await call(3, 'eth_blockNumber', [], options), 'latest block number');
    if (wanted > latest) return { ...base, status: 'future', latest: latest.toString() };
    // The node's oldest kept block; a number below it was pruned.
    const oldest = await call(4, 'eth_getBlockByNumber', ['earliest', false], options);
    const earliest = blockNumberOf(oldest, 'earliest block number');
    return wanted < earliest ? { ...base, status: 'pruned', earliest: earliest.toString() } : { ...base, status: 'not_found' };
  }

  // A block is reported only when every field ELA shows is well formed and it is the one asked for.
  if (blockNumberOf(block, 'block number') !== wanted) invalid('block number');
  const { hash, timestamp, transactions } = block as Record<string, unknown>;
  if (typeof hash !== 'string' || !HASH.test(hash)) invalid('block hash');
  const seconds = quantity(timestamp, 'timestamp');
  if (seconds > MAX_TIMESTAMP) invalid('timestamp');
  if (!Array.isArray(transactions) || !transactions.every(tx => typeof tx === 'string' && HASH.test(tx.toLowerCase()))) invalid('transactions');
  const gasUsed = quantity((block as Record<string, unknown>).gasUsed, 'gas used');
  const gasLimit = quantity((block as Record<string, unknown>).gasLimit, 'gas limit');
  if (gasUsed > gasLimit) invalid('gas used above the gas limit');
  return {
    ...base,
    status: 'found',
    blockNumber: wanted.toString(),
    hash,
    timestamp: seconds.toString(),
    time: new Date(Number(seconds) * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
    transactionCount: transactions.length.toString(),
    gasUsed: gasUsed.toString(),
    gasLimit: gasLimit.toString(),
  };
}
