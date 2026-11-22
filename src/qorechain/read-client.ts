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
  | 'node_syncing'
  | 'rpc_error'
  | 'history_unavailable'
  | 'evidence_mismatch';

export interface ReadFailureDetails {
  httpStatus?: number;
  rpcCode?: number;
  transportCode?: string;
}

// Browsers deliberately hide DNS/TLS/CORS detail behind TypeError. Only classify a cause when
// the transport supplies an explicit recognized code; never infer CORS from a failed fetch.
function transportDetails(error: unknown): ReadFailureDetails {
  const cause = isRecord(error) && isRecord(error.cause) ? error.cause : error;
  return isRecord(cause) && typeof cause.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(cause.code)
    ? {transportCode:cause.code} : {};
}

export class QoreChainReadError extends Error {
  readonly code: ErrorCode;
  readonly details: ReadFailureDetails;

  constructor(code: ErrorCode, message: string, details: ReadFailureDetails = {}) {
    super(message);
    this.name = 'QoreChainReadError';
    this.code = code;
    this.details = Object.freeze({...details});
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
  } catch (error) {
    throw new QoreChainReadError('network_error', 'Could not reach the QoreChain endpoint.', transportDetails(error));
  }
  if (!response.ok) {
    throw new QoreChainReadError('http_error', 'QoreChain endpoint returned HTTP ' + response.status + '.', {httpStatus:response.status});
  }
  try {
    return await response.json();
  } catch {
    throw new QoreChainReadError('invalid_response', 'QoreChain endpoint returned an unreadable JSON body.');
  }
}

/** Separate valid JSON-RPC errors from HTTP failures and malformed protocol responses. */
export function rpcResult(body: unknown, id: number): unknown {
  if (!isRecord(body) || body.jsonrpc !== '2.0' || body.id !== id) {
    throw new QoreChainReadError('invalid_response', 'Invalid JSON-RPC envelope.');
  }
  if ('error' in body) {
    if (!('result' in body) && isRecord(body.error) && Number.isSafeInteger(body.error.code) && typeof body.error.message === 'string') {
      // The upstream message/data may be arbitrary; keep only the numeric error code for display.
      throw new QoreChainReadError('rpc_error', 'Diana returned a JSON-RPC error.', {rpcCode:body.error.code as number});
    }
    throw new QoreChainReadError('invalid_response', 'Invalid JSON-RPC error envelope.');
  }
  if (!('result' in body)) throw new QoreChainReadError('invalid_response', 'Missing JSON-RPC result.');
  return body.result;
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
