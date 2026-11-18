import { dianaChainHex, evmEndpoint } from './get-evm-block-number.ts';
import { isRecord, QORECHAIN_TESTNET, QoreChainReadError, readJson } from './read-client.ts';
import type { ReadOptions } from './read-client.ts';

/**
 * ERC-20 token metadata of one contract on Diana testnet, read from the official Diana EVM JSON-RPC
 * (the Diana endpoint a browser page may read: it allows CORS). Read-only: only `eth_chainId`,
 * `eth_getCode`, and `eth_call` are sent, to the fixed endpoint, and `eth_call` only with the
 * four fixed selectors below, no arguments, to the one address being inspected, at "latest". No
 * transaction is built, signed, or sent.
 *
 * - `no_contract`: the address has no code; nothing else is read.
 * - `not_token`: the contract does not answer `totalSupply()`, which every ERC-20 token has.
 * - `found`: `totalSupply()` answered. `name()`, `symbol()`, and `decimals()` are optional in
 *   ERC-20: a function the contract does not answer (it reverts or returns nothing) is listed in
 *   `missing` and its value is left out. Nothing is guessed in its place.
 *
 * A malformed ABI answer fails the whole read (`invalid_response`); it is never shown.
 */

/** The only calls ELA makes: the ERC-20 read functions without arguments. */
export const ERC20_CALLS = Object.freeze({
  totalSupply: '0x18160ddd',
  name: '0x06fdde03',
  symbol: '0x95d89b41',
  decimals: '0x313ce567',
} as const);

export type TokenStatus = 'found' | 'no_contract' | 'not_token';

export interface EvmToken {
  readonly chainId: string;
  readonly evmChainId: string;
  /** The contract address in lower case. */
  readonly address: string;
  readonly status: TokenStatus;
  /** Present for `found` when the contract answered them. */
  readonly name?: string;
  readonly symbol?: string;
  readonly decimals?: string;
  /** Present for `found`: the raw total supply, and scaled by `decimals` when that is known. */
  readonly totalSupplyRaw?: string;
  readonly totalSupply?: string;
  /** Present for `found` when some optional function was not answered, e.g. "name(), decimals()". */
  readonly missing?: string;
}

const WORD = /^[0-9a-f]{64}$/u;
// Text a token may not show: control characters and bidirectional overrides, which can disguise
// what is displayed.
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/u;
const MAX_TEXT_BYTES = 256;

function invalid(what: string): never {
  throw new QoreChainReadError('invalid_response', 'Invalid token data: ' + what + '.');
}

type Method = 'eth_chainId' | 'eth_getCode' | 'eth_call';

/**
 * Sends one request. With `call`, a revert (JSON-RPC error code 3, or -32000 "execution reverted")
 * returns `undefined`: the contract does not answer that function. Any other error is a failure.
 */
async function rpc(id: number, method: Method, params: readonly unknown[], options: ReadOptions): Promise<unknown> {
  const body = await readJson(new URL(evmEndpoint), options, JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  if (isRecord(body) && body.jsonrpc === '2.0' && body.id === id) {
    if ('result' in body && !('error' in body)) return body.result;
    const error = body.error;
    if (method === 'eth_call' && !('result' in body) && isRecord(error)
      && (error.code === 3 || (error.code === -32000 && typeof error.message === 'string' && /execution reverted/iu.test(error.message)))) return undefined;
  }
  throw new QoreChainReadError('invalid_response', 'Invalid EVM JSON-RPC response for ' + method + '.');
}

/** The answer of one ERC-20 call as hex without 0x, or `undefined` when the contract did not answer. */
async function call(id: number, address: string, selector: string, what: string, options: ReadOptions): Promise<string | undefined> {
  const result = await rpc(id, 'eth_call', [{ to: address, data: selector }, 'latest'], options);
  if (result === undefined || result === '0x') return undefined;
  if (typeof result !== 'string' || !/^0x(?:[0-9a-f]{2})*$/u.test(result)) invalid(what);
  return result.slice(2);
}

function uint(data: string, what: string): bigint {
  return data.length === 64 ? BigInt('0x' + data) : invalid(what);
}

/** An ABI `string` (or a legacy `bytes32`) as safe display text. */
function text(data: string, what: string): string {
  let hex: string;
  if (data.length === 64) {
    // Legacy tokens return bytes32: the text, padded with zero bytes on the right.
    hex = data.replace(/(?:00)+$/u, '');
  } else {
    if (data.length < 128 || data.length % 64 !== 0 || BigInt('0x' + data.slice(0, 64)) !== 32n) invalid(what);
    const length = BigInt('0x' + data.slice(64, 128));
    if (length > BigInt(MAX_TEXT_BYTES)) invalid(what);
    const size = Number(length) * 2;
    // Exactly the words the text needs, with zero padding after it.
    if (data.length !== 128 + Math.ceil(size / 64) * 64 || !/^0*$/u.test(data.slice(128 + size))) invalid(what);
    hex = data.slice(128, 128 + size);
  }
  const bytes = new Uint8Array(hex.length / 2).map((_, i) => parseInt(hex.slice(2 * i, 2 * i + 2), 16));
  let value: string;
  try {
    value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    invalid(what);
  }
  if (UNSAFE_TEXT.test(value)) invalid(what);
  return value.trim();
}

/** `value / 10^decimals` as an exact decimal, without trailing zeros. */
function scale(value: bigint, decimals: number): string {
  if (decimals === 0) return value.toString();
  const digits = value.toString().padStart(decimals + 1, '0');
  const fraction = digits.slice(-decimals).replace(/0+$/u, '');
  return digits.slice(0, -decimals) + (fraction ? '.' + fraction : '');
}

/** Reads one token. `address` must be 0x and 40 lower-case hex digits (checked again here). */
export async function getEvmToken(address: string, options: ReadOptions = {}): Promise<EvmToken> {
  if (typeof address !== 'string' || !/^0x[0-9a-f]{40}$/u.test(address)) {
    throw new QoreChainReadError('invalid_address', 'Expected a contract address: 0x and 40 lower-case hexadecimal digits.');
  }
  const chain = await rpc(1, 'eth_chainId', [], options);
  if (chain !== dianaChainHex) {
    throw new QoreChainReadError('chain_mismatch', 'EVM JSON-RPC did not report the Diana testnet chain ID (9800).');
  }
  const base = { chainId: QORECHAIN_TESTNET.chainId, evmChainId: BigInt(dianaChainHex).toString(), address };

  const code = await rpc(2, 'eth_getCode', [address, 'latest'], options);
  if (typeof code !== 'string' || !/^0x(?:[0-9a-f]{2})*$/u.test(code)) invalid('contract code');
  if (code === '0x') return { ...base, status: 'no_contract' };

  const supplyData = await call(3, address, ERC20_CALLS.totalSupply, 'total supply', options);
  if (supplyData === undefined) return { ...base, status: 'not_token' };
  const supply = uint(supplyData, 'total supply');

  // Each answer is checked before the next call: a malformed one stops the read.
  const nameData = await call(4, address, ERC20_CALLS.name, 'name', options);
  const name = nameData === undefined ? undefined : text(nameData, 'name');
  const symbolData = await call(5, address, ERC20_CALLS.symbol, 'symbol', options);
  const symbol = symbolData === undefined ? undefined : text(symbolData, 'symbol');
  const decimalsData = await call(6, address, ERC20_CALLS.decimals, 'decimals', options);
  let decimals: number | undefined;
  if (decimalsData !== undefined) {
    // decimals() is a uint8.
    const value = uint(decimalsData, 'decimals');
    decimals = value <= 255n ? Number(value) : invalid('decimals');
  }

  const missing = [name ? '' : 'name()', symbol ? '' : 'symbol()', decimals === undefined ? 'decimals()' : ''].filter(Boolean).join(', ');
  return {
    ...base,
    status: 'found',
    ...(name ? { name } : {}),
    ...(symbol ? { symbol } : {}),
    ...(decimals === undefined ? {} : { decimals: String(decimals) }),
    totalSupplyRaw: supply.toString(),
    totalSupply: decimals === undefined ? supply.toString() : scale(supply, decimals),
    ...(missing ? { missing } : {}),
  };
}
