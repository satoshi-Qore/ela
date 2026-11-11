export const QORECHAIN_TESTNET = Object.freeze({
  chainId: 'qorechain-diana',
  rpcUrl: 'https://rpc-testnet.qore.host',
  restUrl: 'https://api-testnet.qore.host',
  denom: 'uqor',
  decimals: 6,
});

export interface ReadOptions {
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

type ErrorCode =
  | 'invalid_configuration'
  | 'invalid_address'
  | 'timeout'
  | 'network_error'
  | 'http_error'
  | 'invalid_response'
  | 'chain_mismatch'
  | 'node_syncing';

export class QoreChainReadError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'QoreChainReadError';
    this.code = code;
  }
}

export function endpoint(base: string, path: string): URL {
  try {
    const url = new URL(base);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error();
    }
    url.pathname = url.pathname.replace(/\/+$/, '') + '/' + path;
    return url;
  } catch {
    throw new QoreChainReadError('invalid_configuration', 'Expected an HTTP(S) endpoint without credentials, query, or fragment.');
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function fetchJson(url: URL, fetcher: typeof globalThis.fetch, signal: AbortSignal, jsonBody?: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, {
      method: jsonBody === undefined ? 'GET' : 'POST',
      headers: jsonBody === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: jsonBody,
      credentials: 'omit',
      redirect: 'error',
      signal,
    });
  } catch {
    throw new QoreChainReadError('network_error', 'Could not reach the QoreChain endpoint.');
  }
  if (!response.ok) {
    throw new QoreChainReadError('http_error', 'QoreChain endpoint returned HTTP ' + response.status + '.');
  }
  try {
    return await response.json();
  } catch {
    throw new QoreChainReadError('invalid_response', 'QoreChain endpoint returned an unreadable JSON body.');
  }
}

export async function readJson(url: URL, options: ReadOptions, jsonBody?: string): Promise<unknown> {
  const { timeoutMs = 8000, fetch: fetcher = globalThis.fetch } = options;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647 || typeof fetcher !== 'function') {
    throw new QoreChainReadError('invalid_configuration', 'Expected a valid request timeout and fetch implementation.');
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new QoreChainReadError('timeout', 'QoreChain request timed out.'));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([fetchJson(url, fetcher, controller.signal, jsonBody), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
