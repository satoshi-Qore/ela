import { dianaChainHex, evmEndpoint } from './get-evm-block-number.ts';
import { checkAddress, keccak256 } from './keccak.ts';
import { isRecord, QoreChainReadError, readJson, rpcResult } from './read-client.ts';
import type { ReadOptions } from './read-client.ts';

const PQC_STATUS = '0x0000000000000000000000000000000000000a02';
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/u;
const selector = (signature: string) => '0x' + keccak256(new TextEncoder().encode(signature)).slice(0, 8);
const GETTERS = Object.freeze({
  executor: selector('executor()'), recipient: selector('recipient()'), invoiceIssuer: selector('invoiceIssuer()'),
  maxPerPayment: selector('maxPerPayment()'), spendingLimit: selector('spendingLimit()'), maxPayments: selector('maxPayments()'),
  startsAt: selector('startsAt()'), endsAt: selector('endsAt()'), totalSpent: selector('totalSpent()'), nextNonce: selector('nextNonce()'),
});
const KEY_STATUS = selector('pqcKeyStatus(address)');
const PAID = selector('paidInvoices(bytes32)');
function invalid(what: string): never { throw new QoreChainReadError('invalid_response', 'Invalid payment-account data: ' + what + '.'); }
function address(value: string): string {
  const checked = typeof value === 'string' ? checkAddress(value) : undefined;
  if (!checked || BigInt(checked) <= 65535n) throw new QoreChainReadError('invalid_address', 'Expected a nonzero public account address outside the precompile range.');
  return checked;
}
function data(value: unknown, maxBytes: number): string {
  if (typeof value !== 'string' || !/^0x(?:[a-fA-F0-9]{2})*$/u.test(value) || value.length > 2 + maxBytes * 2) invalid('hex bytes');
  return value.toLowerCase();
}
function quantity(value: unknown): bigint { return typeof value === 'string' && QUANTITY.test(value) ? BigInt(value) : invalid('quantity'); }
function word(value: unknown): bigint { const hex = data(value, 32); return hex.length === 66 ? BigInt(hex) : invalid('ABI word'); }
function bool(value: bigint): boolean { return value === 0n ? false : value === 1n ? true : invalid('ABI boolean'); }
export async function sha256Data(hex: string): Promise<string> {
  const raw = data(hex, 65536).slice(2);
  const bytes = Uint8Array.from(raw.match(/../g) ?? [], x => parseInt(x, 16));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}
export interface PaymentPolicyState {
  executor: string; recipient: string; invoiceIssuer: string;
  maxPerPayment: string; spendingLimit: string; maxPayments: string; startsAt: string; endsAt: string;
  totalSpent: string; nextNonce: string;
}
export interface PqcReading { registered: boolean; algorithmId: number; possessionProven: boolean; publicKeyBytes: number; keySha256: string; }
export interface PaymentSnapshot { number: string; hash: string; timestamp: string; }
/** Private fixed-shape reads. This is not an RPC client and accepts no method or calldata from callers. */
export async function createDianaPaymentReader(options: ReadOptions = {}) {
  let serial = 0;
  type Method = 'eth_chainId' | 'eth_getBlockByNumber' | 'eth_getCode' | 'eth_getBalance' | 'eth_call';
  const rpc = async (method: Method, params: readonly unknown[]): Promise<unknown> => {
    const id = ++serial;
    const body = await readJson(new URL(evmEndpoint), options, JSON.stringify({jsonrpc:'2.0', id, method, params}));
    return rpcResult(body, id);
  };
  const chain = async () => {
    if (await rpc('eth_chainId', []) !== dianaChainHex) throw new QoreChainReadError('chain_mismatch', 'Expected Diana EVM chain ID 9800.');
  };
  const header = (value: unknown): PaymentSnapshot => {
    if (!isRecord(value) || typeof value.hash !== 'string' || !/^0x[0-9a-f]{64}$/u.test(value.hash)) invalid('block header');
    const timestamp = quantity(value.timestamp);
    if (timestamp > 253402300799n) invalid('block timestamp');
    return {number:quantity(value.number).toString(), hash:value.hash, timestamp:timestamp.toString()};
  };
  await chain();
  const snapshot = Object.freeze(header(await rpc('eth_getBlockByNumber', ['latest', false])));
  const tag = Object.freeze({blockHash:snapshot.hash, requireCanonical:true});
  const numberTag = '0x' + BigInt(snapshot.number).toString(16);
  const call = async (to: string, calldata: string) => rpc('eth_call', [{to, data:calldata}, tag]);
  return Object.freeze({
    snapshot,
    code: async (to: string) => data(await rpc('eth_getCode', [address(to), tag]), 65536),
    balance: async (to: string) => quantity(await rpc('eth_getBalance', [address(to), tag])).toString(),
    policy: async (to: string): Promise<PaymentPolicyState> => {
      const target = address(to);
      const result: Record<string, string> = {};
      for (const [key, selector] of Object.entries(GETTERS)) {
        const value = word(await call(target, selector));
        if (['executor', 'recipient', 'invoiceIssuer'].includes(key)) {
          if (value >= 1n << 160n) invalid('ABI address padding');
          result[key] = '0x' + value.toString(16).padStart(40, '0');
        } else result[key] = value.toString();
      }
      return result as unknown as PaymentPolicyState;
    },
    pqc: async (account: string): Promise<PqcReading> => {
      const target = address(account);
      const hex = data(await call(PQC_STATUS, KEY_STATUS + target.slice(2).padStart(64, '0')), 4256).slice(2);
      if (hex.length < 320 || hex.length % 64 !== 0) invalid('PQC ABI length');
      const words = Array.from({length:5}, (_,i) => BigInt('0x' + hex.slice(i*64, (i+1)*64)));
      const [registered, algorithm, offset, proven, size] = words as [bigint,bigint,bigint,bigint,bigint];
      if (offset !== 128n || algorithm > 255n || size > 4096n) invalid('PQC ABI header');
      const length = Number(size), padded = Math.ceil(length / 32)*64;
      if (hex.length !== 320 + padded || !/^0*$/u.test(hex.slice(320 + length*2))) invalid('PQC ABI tail');
      const isRegistered = bool(registered), possessionProven = bool(proven);
      if (!isRegistered && (algorithm !== 0n || length !== 0 || possessionProven)) invalid('unregistered PQC state');
      return {registered:isRegistered, algorithmId:Number(algorithm), possessionProven, publicKeyBytes:length,
        keySha256:await sha256Data('0x' + hex.slice(320, 320 + length*2))};
    },
    invoicePaid: async (to: string, invoiceId: string) => {
      if (!/^0x[0-9a-f]{64}$/u.test(invoiceId)) throw new QoreChainReadError('invalid_configuration', 'Expected a public invoice identifier.');
      return bool(word(await call(address(to), PAID + invoiceId.slice(2))));
    },
    finish: async () => {
      await chain();
      const final = header(await rpc('eth_getBlockByNumber', [numberTag, false]));
      if (final.number !== snapshot.number || final.hash !== snapshot.hash || final.timestamp !== snapshot.timestamp) invalid('snapshot changed during read');
    },
  });
}
