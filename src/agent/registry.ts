import { getEvmBlockNumber } from '../qorechain/get-evm-block-number.ts';
import { isRecord, QORECHAIN_TESTNET, QoreChainReadError } from '../qorechain/read-client.ts';
import type { ReadOptions } from '../qorechain/read-client.ts';
import type { BalanceReading } from './balance.ts';
import type { BlockReading } from './block.ts';
import type { GasReading } from './gas.ts';
import type { TokenReading } from './token.ts';
import type { TransactionReading } from './transaction.ts';
import type { RpcMethod } from './planner.ts';

/** The only network any registered tool may target. */
export const DIANA_NETWORK = QORECHAIN_TESTNET.chainId;
export type NetworkId = typeof DIANA_NETWORK;

export interface ParamRule {
  readonly type: 'string' | 'integer' | 'boolean';
  readonly required: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly pattern?: RegExp;
}

export type ParamSpec = Readonly<Record<string, ParamRule>>;

/** Trusted runtime hooks supplied by the application, never by a user command. */
export type RuntimeOptions = Pick<ReadOptions, 'fetch' | 'timeoutMs'>;

export interface ToolDefinition<Data = unknown> {
  readonly id: string;
  readonly description: string;
  readonly network: NetworkId;
  readonly readOnly: true;
  /** Every JSON-RPC method the tool may send. Requests outside this list are blocked at runtime. */
  readonly rpcMethods: readonly RpcMethod[];
  /**
   * The only `eth_call` data the tool may send: fixed function selectors without arguments, to the
   * address in its `address` parameter. A tool without it can never send `eth_call`.
   */
  readonly callSelectors?: readonly string[];
  readonly params: ParamSpec;
  readonly run: (params: Readonly<Record<string, unknown>>, runtime: RuntimeOptions) => Promise<Data>;
}

export type ValidationErrorCode =
  | 'unknown_tool'
  | 'not_read_only'
  | 'network_not_allowed'
  | 'method_not_allowed'
  | 'invalid_params';

export interface ToolError {
  /** `validation`: refused before any request was sent. `execution`: the tool ran and failed. */
  readonly stage: 'validation' | 'execution';
  readonly code: ValidationErrorCode | QoreChainReadError['code'] | 'unexpected_error';
  readonly message: string;
}

export type ToolResult<Data = unknown> =
  | { readonly ok: true; readonly tool: string; readonly network: NetworkId; readonly data: Data }
  | { readonly ok: false; readonly tool: string; readonly network?: NetworkId; readonly error: ToolError };

export interface ToolRequest {
  readonly tool: unknown;
  readonly network: unknown;
  readonly params?: unknown;
  /** RPC methods the caller's plan expects the tool to use. Each must be allowed by the tool. */
  readonly rpcMethods?: readonly unknown[];
}

function defineTool<Data>(definition: ToolDefinition<Data>): ToolDefinition<Data> {
  return Object.freeze({
    ...definition,
    rpcMethods: Object.freeze([...definition.rpcMethods]),
    params: Object.freeze({ ...definition.params }),
  });
}

const getEvmBlockNumberTool = defineTool({
  id: 'get_evm_block_number',
  description: 'Verify the Diana EVM chain ID (9800) with eth_chainId, then read the latest block with eth_blockNumber.',
  network: DIANA_NETWORK,
  readOnly: true,
  rpcMethods: ['eth_chainId', 'eth_blockNumber'],
  params: {},
  run: (_params, runtime) => getEvmBlockNumber(runtime),
});

export type { BalanceReading };

/** A 20-byte native QoreChain account address in lower case. */
export const QOR_ADDRESS_PATTERN = /^qor1[02-9ac-hj-np-z]{38}$/u;

/** The balance rules and reader, loaded on demand (a separate chunk in the web build). */
export const loadBalance = () => import('./balance.ts');

const getBalanceTool = defineTool<BalanceReading>({
  id: 'get_balance',
  description: 'Verify the Diana EVM chain ID (9800), then read the native QOR balance of one qor1 account with eth_getBalance.',
  network: DIANA_NETWORK,
  readOnly: true,
  rpcMethods: ['eth_chainId', 'eth_getBalance'],
  params: { address: { type: 'string', required: true, pattern: QOR_ADDRESS_PATTERN } },
  // The endpoint is fixed; the runtime supplies only fetch and timeoutMs, never a URL.
  run: async (params, runtime) => (await loadBalance()).readBalance(params.address as string, runtime),
});

export type { TransactionReading };

/** The transaction rules and reader, loaded on demand (a separate chunk in the web build). */
export const loadTransaction = () => import('./transaction.ts');

const getTransactionTool = defineTool<TransactionReading>({
  id: 'get_transaction',
  description: 'Verify the Diana EVM chain ID (9800), then read one transaction and its receipt by hash.',
  network: DIANA_NETWORK,
  readOnly: true,
  rpcMethods: ['eth_chainId', 'eth_getTransactionByHash', 'eth_getTransactionReceipt'],
  params: { hash: { type: 'string', required: true, pattern: /^0x[0-9a-f]{64}$/u } },
  // The endpoint is fixed; the runtime supplies only fetch and timeoutMs, never a URL.
  run: async (params, runtime) => (await loadTransaction()).readTransaction(params.hash as string, runtime),
});

export type { BlockReading };

/** The block-by-number rules and reader, loaded on demand (a separate chunk in the web build). */
export const loadBlock = () => import('./block.ts');

const getBlockTool = defineTool<BlockReading>({
  id: 'get_block',
  description: 'Verify the Diana EVM chain ID (9800), then read one block by number.',
  network: DIANA_NETWORK,
  readOnly: true,
  rpcMethods: ['eth_chainId', 'eth_getBlockByNumber', 'eth_blockNumber'],
  params: { number: { type: 'integer', required: true, min: 0, max: Number.MAX_SAFE_INTEGER } },
  // The endpoint is fixed; the runtime supplies only fetch and timeoutMs, never a URL.
  run: async (params, runtime) => (await loadBlock()).readBlock(params.number as number, runtime),
});

export type { GasReading };

/** The fee-question rules and reader, loaded on demand (a separate chunk in the web build). */
export const loadGas = () => import('./gas.ts');

const getGasFeesTool = defineTool<GasReading>({
  id: 'get_gas_fees',
  description: 'Verify the Diana EVM chain ID (9800), then read gas fees.',
  network: DIANA_NETWORK,
  readOnly: true,
  rpcMethods: ['eth_chainId', 'eth_gasPrice', 'eth_feeHistory', 'eth_maxPriorityFeePerGas'],
  params: {},
  // The endpoint is fixed; the runtime supplies only fetch and timeoutMs, never a URL.
  run: async (_params, runtime) => (await loadGas()).readGas(runtime),
});

export type { TokenReading };

/** The token rules and reader, loaded on demand (a separate chunk in the web build). */
export const loadToken = () => import('./token.ts');

const getTokenTool = defineTool<TokenReading>({
  id: 'get_token',
  description: 'Verify the Diana EVM chain ID (9800), then read ERC-20 token metadata.',
  network: DIANA_NETWORK,
  readOnly: true,
  rpcMethods: ['eth_chainId', 'eth_getCode', 'eth_call'],
  // name(), symbol(), decimals(), totalSupply(): no approve, transfer, transferFrom, or any argument.
  callSelectors: Object.freeze(['0x06fdde03', '0x95d89b41', '0x313ce567', '0x18160ddd']),
  params: { address: { type: 'string', required: true, pattern: /^0x[0-9a-f]{40}$/u } },
  // The endpoint is fixed; the runtime supplies only fetch and timeoutMs, never a URL.
  run: async (params, runtime) => (await loadToken()).readToken(params.address as string, runtime),
});

const TOOLS: Readonly<Record<string, ToolDefinition>> = Object.freeze(Object.assign(Object.create(null), {
  [getEvmBlockNumberTool.id]: getEvmBlockNumberTool,
  [getBalanceTool.id]: getBalanceTool,
  [getTransactionTool.id]: getTransactionTool,
  [getBlockTool.id]: getBlockTool,
  [getGasFeesTool.id]: getGasFeesTool,
  [getTokenTool.id]: getTokenTool,
}));

export type ToolId = 'get_evm_block_number' | 'get_balance' | 'get_transaction' | 'get_block' | 'get_gas_fees' | 'get_token';

/** Returns the registered tool, or `undefined` for any id that is not an own registry entry. */
export function getTool(id: unknown): ToolDefinition | undefined {
  return typeof id === 'string' && Object.hasOwn(TOOLS, id) ? TOOLS[id] : undefined;
}

export function listTools(): readonly ToolDefinition[] {
  return Object.freeze(Object.values(TOOLS));
}

/** Checks `params` against `spec`. Returns an error message, or `undefined` when the params are valid. */
export function validateParams(spec: ParamSpec, params: unknown): string | undefined {
  if (params === undefined) params = {};
  if (!isRecord(params) || Object.getPrototypeOf(params) !== Object.prototype && Object.getPrototypeOf(params) !== null) {
    return 'Parameters must be a plain object.';
  }
  for (const key of Object.keys(params)) {
    if (!Object.hasOwn(spec, key)) return 'Unknown parameter "' + key + '".';
  }
  for (const [name, rule] of Object.entries(spec)) {
    const value = params[name];
    if (value === undefined) {
      if (rule.required) return 'Missing required parameter "' + name + '".';
      continue;
    }
    if (rule.type === 'integer' ? !Number.isSafeInteger(value) : typeof value !== rule.type) {
      return 'Parameter "' + name + '" must be a ' + rule.type + '.';
    }
    if (typeof value === 'number' && ((rule.min !== undefined && value < rule.min) || (rule.max !== undefined && value > rule.max))) {
      return 'Parameter "' + name + '" is out of range.';
    }
    if (typeof value === 'string' && rule.pattern && !rule.pattern.test(value)) {
      return 'Parameter "' + name + '" has an invalid format.';
    }
  }
  return undefined;
}

/** The one contract and the fixed selectors an `eth_call` may use. */
export interface CallScope {
  readonly to: string;
  readonly selectors: readonly string[];
}

function parseRequest(body: unknown): Record<string, unknown> | undefined {
  if (typeof body !== 'string') return undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Pure check: true only when `body` is a JSON-RPC request whose method is in `allowed`. An
 * `eth_call` must also match `scope` exactly: `[{ to, data }, "latest"]` with `to` the scope's
 * contract and `data` one of its selectors, nothing else (no from, value, gas, arguments, or block
 * overrides). Without a scope, `eth_call` is never allowed.
 */
export function isAllowedRpcRequest(body: unknown, allowed: readonly string[], scope?: CallScope): boolean {
  const request = parseRequest(body);
  const method = request?.method;
  if (typeof method !== 'string' || !allowed.includes(method)) return false;
  if (method !== 'eth_call') return true;
  const params = request!.params;
  if (!scope || !Array.isArray(params) || params.length !== 2 || params[1] !== 'latest' || !isRecord(params[0])) return false;
  const { to, data } = params[0];
  return Object.keys(params[0]).length === 2 && to === scope.to && typeof data === 'string' && scope.selectors.includes(data);
}

/**
 * Wraps `base` so that only requests for `allowed` RPC methods (and, for `eth_call`, only calls in
 * `scope`) reach the network. Any other request is rejected before `base` is called.
 */
export function guardFetch(base: typeof globalThis.fetch, allowed: readonly string[], scope?: CallScope): typeof globalThis.fetch {
  const methods = Object.freeze([...allowed]);
  return (input, init) => isAllowedRpcRequest(init?.body, methods, scope)
    ? base(input, init)
    : Promise.reject(new TypeError('Blocked a request outside the tool\'s read-only methods.'));
}

/**
 * The single entry point for running a tool. Everything is validated before any request is sent:
 * the tool must be registered and read-only, the network must be Diana testnet, requested RPC
 * methods must be allowed, and params must match the tool's spec.
 */
export async function invokeTool(request: ToolRequest, runtime: RuntimeOptions = {}): Promise<ToolResult> {
  const id = typeof request?.tool === 'string' ? request.tool : String(request?.tool);
  const refuse = (code: ValidationErrorCode, message: string): ToolResult =>
    ({ ok: false, tool: id, error: { stage: 'validation', code, message } });

  const tool = getTool(request?.tool);
  if (!tool) return refuse('unknown_tool', 'Tool "' + id + '" is not registered.');
  if (tool.readOnly !== true) return refuse('not_read_only', 'Tool "' + id + '" is not read-only.');
  if (request.network !== tool.network) {
    return refuse('network_not_allowed', 'Tool "' + id + '" only supports ' + tool.network + '.');
  }
  const allowed: readonly string[] = tool.rpcMethods;
  const requested: readonly unknown[] = request.rpcMethods ?? [];
  if (!Array.isArray(requested)) return refuse('method_not_allowed', 'RPC methods must be listed as an array.');
  const disallowed = requested.findIndex(method => typeof method !== 'string' || !allowed.includes(method));
  if (disallowed !== -1) {
    return refuse('method_not_allowed', 'RPC method "' + String(requested[disallowed]) + '" is not allowed for tool "' + id + '".');
  }
  const invalid = validateParams(tool.params, request.params);
  if (invalid) return refuse('invalid_params', invalid);

  // A tool with call selectors may call only the contract in its validated `address` parameter.
  const scope = tool.callSelectors && { to: (request.params as Record<string, unknown>).address as string, selectors: tool.callSelectors };
  const guardedFetch = guardFetch(runtime.fetch ?? globalThis.fetch, allowed, scope);

  try {
    const data = await tool.run(Object.freeze({ ...(request.params as Record<string, unknown> | undefined) }), {
      ...runtime,
      fetch: guardedFetch,
    });
    return { ok: true, tool: tool.id, network: tool.network, data };
  } catch (error) {
    return {
      ok: false,
      tool: tool.id,
      network: tool.network,
      error: error instanceof QoreChainReadError
        ? { stage: 'execution', code: error.code, message: error.message }
        : { stage: 'execution', code: 'unexpected_error', message: 'The tool failed unexpectedly.' },
    };
  }
}
