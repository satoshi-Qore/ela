import { getNetwork, postJsonRpc, QoreHttpError } from '@qorechain/sdk';
import type { FetchLike } from '@qorechain/sdk';
import { dianaChainHex, evmEndpoint } from './get-evm-block-number.ts';
import { isRecord, QORECHAIN_TESTNET, QoreChainReadError } from './read-client.ts';
import type { ReadOptions } from './read-client.ts';

/**
 * Standalone, read-only Diana EVM reader built on QoreChain's official TypeScript SDK
 * (`@qorechain/sdk`). It takes the endpoint and chain identity from the SDK's `testnet` preset,
 * sends requests through the SDK's `postJsonRpc` transport, and returns the same result and error
 * codes as `getEvmBlockNumber` (src/qorechain/get-evm-block-number.ts), which stays the reader the
 * tool registry and the interface use.
 *
 * Read-only guarantees:
 * - Only `eth_chainId` and then `eth_blockNumber`; the block height is never requested unless the
 *   chain ID is Diana's (0x2648 = 9800).
 * - A guard around the SDK's fetch refuses any request that is not a POST of one of those two
 *   methods to the Diana EVM endpoint, and forces `credentials: 'omit'` and `redirect: 'error'`.
 * - SDK retries are off, so each method is sent at most once.
 * - No signing, wallet, account, or transaction code from the SDK is imported.
 */

type ReadMethod = 'eth_chainId' | 'eth_blockNumber';
const READ_METHODS: readonly ReadMethod[] = ['eth_chainId', 'eth_blockNumber'];
const DIANA_EVM_CHAIN_ID = 9800;

/** The SDK's testnet preset, accepted only if it matches ELA's own Diana configuration. */
function dianaEndpoint(): string {
  const network = getNetwork('testnet');
  const endpoint = network.endpoints.evmRpc;
  let matches = false;
  try {
    matches = network.chainId === QORECHAIN_TESTNET.chainId && network.evmChainId === DIANA_EVM_CHAIN_ID
      && new URL(endpoint).href === new URL(evmEndpoint).href;
  } catch {
    matches = false;
  }
  if (!matches) throw new QoreChainReadError('invalid_configuration', 'The QoreChain SDK testnet preset does not match the Diana EVM configuration.');
  return endpoint;
}

function requestedMethod(body: unknown): string | undefined {
  if (typeof body !== 'string') return undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    return isRecord(parsed) && typeof parsed.method === 'string' ? parsed.method : undefined;
  } catch {
    return undefined;
  }
}

async function request(endpoint: string, method: ReadMethod, id: number, fetcher: typeof globalThis.fetch, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new QoreChainReadError('timeout', 'QoreChain request timed out.'));
      controller.abort();
    }, timeoutMs);
  });

  // Every request the SDK makes passes through this guard.
  const guardedFetch: FetchLike = async (input, init = {}) => {
    const sent = requestedMethod(init.body);
    if (input !== endpoint || init.method !== 'POST' || sent !== method || !(READ_METHODS as readonly string[]).includes(sent)) {
      throw new QoreChainReadError('invalid_configuration', 'Refused a QoreChain SDK request outside the read-only Diana EVM allowlist.');
    }
    try {
      return await fetcher(new URL(endpoint), {
        method: 'POST',
        headers: init.headers,
        body: init.body,
        credentials: 'omit',
        redirect: 'error',
        signal: controller.signal,
      });
    } catch {
      throw new QoreChainReadError('network_error', 'Could not reach the QoreChain endpoint.');
    }
  };

  let body: unknown;
  try {
    const call = postJsonRpc<unknown>(endpoint, { jsonrpc: '2.0', id, method, params: [] }, { fetch: guardedFetch, retries: 0, retryDelayMs: 0, timeoutMs: 0 });
    body = await Promise.race([call, timeout]);
  } catch (error) {
    if (error instanceof QoreChainReadError) throw error;
    if (error instanceof QoreHttpError) throw new QoreChainReadError('http_error', 'QoreChain endpoint returned HTTP ' + error.status + '.');
    throw new QoreChainReadError('invalid_response', 'QoreChain endpoint returned an unreadable JSON body.');
  } finally {
    clearTimeout(timer);
  }
  if (!isRecord(body) || body.jsonrpc !== '2.0' || body.id !== id || 'error' in body || typeof body.result !== 'string') {
    throw new QoreChainReadError('invalid_response', 'Invalid EVM JSON-RPC response for ' + method + '.');
  }
  return body.result;
}

/** Reads the latest Diana EVM block through the official SDK, after verifying the chain ID. */
export async function getEvmBlockNumberWithSdk(options: ReadOptions = {}): Promise<{
  chainId: string;
  evmChainId: string;
  blockNumber: string;
}> {
  const { timeoutMs = 8000, fetch: fetcher = globalThis.fetch } = options;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647 || typeof fetcher !== 'function') {
    throw new QoreChainReadError('invalid_configuration', 'Expected a valid request timeout and fetch implementation.');
  }
  const endpoint = dianaEndpoint();

  const chain = await request(endpoint, 'eth_chainId', 1, fetcher, timeoutMs);
  if (chain !== dianaChainHex) {
    throw new QoreChainReadError('chain_mismatch', 'EVM JSON-RPC did not report the Diana testnet chain ID (9800).');
  }

  const height = await request(endpoint, 'eth_blockNumber', 2, fetcher, timeoutMs);
  if (!/^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(height)) {
    throw new QoreChainReadError('invalid_response', 'Invalid EVM block height.');
  }
  return {
    chainId: QORECHAIN_TESTNET.chainId,
    evmChainId: BigInt(chain).toString(),
    blockNumber: BigInt(height).toString(),
  };
}
