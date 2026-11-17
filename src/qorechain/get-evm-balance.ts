import { normalizeAddress } from './get-balance.ts';
import { dianaChainHex, evmEndpoint } from './get-evm-block-number.ts';
import { isRecord, QORECHAIN_TESTNET, QoreChainReadError, readJson } from './read-client.ts';
import type { ReadOptions } from './read-client.ts';

/**
 * Native QOR balance of one 20-byte `qor1` account, read from the official Diana EVM JSON-RPC.
 *
 * Why this endpoint: the Diana REST API and consensus RPC send no CORS headers, so a browser page
 * (GitHub Pages) cannot read them. The official EVM JSON-RPC does (`Access-Control-Allow-Origin: *`).
 * QoreChain keeps one account per 20 bytes: `eth_getBalance` of the same bytes as hex is the native
 * QOR balance in 18-decimal base units, and the REST bank `uqor` balance is that value divided by
 * 10^12, rounded down (checked against the live testnet for several accounts). Read-only: only
 * `eth_chainId` and `eth_getBalance` are sent, to the fixed Diana endpoint.
 */

const ALPHABET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const QOR_DECIMALS = 18;
const UQOR_SCALE = 10n ** BigInt(QOR_DECIMALS - QORECHAIN_TESTNET.decimals);

export interface EvmBalance {
  readonly chainId: string;
  readonly evmChainId: string;
  readonly address: string;
  readonly evmAddress: string;
  readonly denom: 'uqor';
  /** Whole uqor, as the REST bank module reports it. */
  readonly amountUqor: string;
  /** The exact balance in QOR (up to 18 decimals). */
  readonly amountQor: string;
  /** True when the balance has a part below 1 uqor (shown in `amountQor`, not in `amountUqor`). */
  readonly belowUqor: boolean;
}

/** The 20 account bytes of a checksum-valid `qor1` address, as 0x hex. Other lengths are refused. */
export function evmAddressOf(address: string): string {
  const account = normalizeAddress(address);
  const words = [...account.slice(4, -6)].map(char => ALPHABET.indexOf(char));
  let hex = '';
  let acc = 0;
  let bits = 0;
  for (const word of words) {
    acc = (acc << 5) | word;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      hex += ((acc >> bits) & 255).toString(16).padStart(2, '0');
      acc &= (1 << bits) - 1;
    }
  }
  if (hex.length !== 40) {
    throw new QoreChainReadError('invalid_address', 'Only 20-byte qor1 account addresses have an EVM balance.');
  }
  return '0x' + hex;
}

async function call(id: number, method: 'eth_chainId' | 'eth_getBalance', params: readonly string[], options: ReadOptions): Promise<string> {
  const body = await readJson(new URL(evmEndpoint), options, JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  if (!isRecord(body) || body.jsonrpc !== '2.0' || body.id !== id || 'error' in body || typeof body.result !== 'string') {
    throw new QoreChainReadError('invalid_response', 'Invalid EVM JSON-RPC response for ' + method + '.');
  }
  return body.result;
}

export async function getEvmBalance(address: string, options: ReadOptions = {}): Promise<EvmBalance> {
  // The address is validated (checksum, 20 bytes) before any request is sent.
  const account = normalizeAddress(address);
  const evmAddress = evmAddressOf(account);
  const chain = await call(1, 'eth_chainId', [], options);
  if (chain !== dianaChainHex) {
    throw new QoreChainReadError('chain_mismatch', 'EVM JSON-RPC did not report the Diana testnet chain ID (9800).');
  }
  const result = await call(2, 'eth_getBalance', [evmAddress, 'latest'], options);
  // At most 256 bits, no leading zeros.
  if (!/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/u.test(result)) {
    throw new QoreChainReadError('invalid_response', 'Invalid EVM balance.');
  }
  const base = BigInt(result);
  const digits = base.toString().padStart(QOR_DECIMALS + 1, '0');
  const fraction = digits.slice(-QOR_DECIMALS).replace(/0+$/u, '');
  return {
    chainId: QORECHAIN_TESTNET.chainId,
    evmChainId: BigInt(chain).toString(),
    address: account,
    evmAddress,
    denom: 'uqor',
    amountUqor: (base / UQOR_SCALE).toString(),
    amountQor: digits.slice(0, -QOR_DECIMALS) + (fraction ? '.' + fraction : ''),
    belowUqor: base % UQOR_SCALE !== 0n,
  };
}
