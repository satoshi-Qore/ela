import { getEvmBlockNumber } from '../qorechain/get-evm-block-number.ts';
import { isRecord, QoreChainReadError } from '../qorechain/read-client.ts';
import type { ReadOptions } from '../qorechain/read-client.ts';
import type { NetworkCheckPlan, PlanStep, RpcMethod } from './planner.ts';

/** The only tools the executor may run. Each one is read-only and limited to the listed RPC methods. */
const READ_ONLY_TOOLS = Object.freeze({
  get_evm_block_number: Object.freeze({
    run: getEvmBlockNumber,
    methods: Object.freeze(['eth_chainId', 'eth_blockNumber'] as const),
  }),
});

export type StepStatus = 'succeeded' | 'failed' | 'skipped';

export interface StepResult {
  readonly id: PlanStep['id'];
  readonly title: string;
  readonly rpcMethod: RpcMethod;
  readonly status: StepStatus;
  readonly detail: string;
}

export interface ExecutionResult {
  /** `partial`: at least one step succeeded before a later step failed. */
  readonly status: 'success' | 'partial' | 'failed';
  readonly steps: readonly StepResult[];
  readonly source: string;
  readonly checkedAt: string;
  readonly data?: { readonly chainId: string; readonly evmChainId: string; readonly blockNumber: string };
  readonly error?: { readonly code: string; readonly message: string };
  readonly summary: string;
}

const SCOPE_NOTE = 'This confirms that one public EVM JSON-RPC endpoint answered; it is not a full network health check.';

function rpcMethodOf(body: unknown): string | undefined {
  if (typeof body !== 'string') return undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    return isRecord(parsed) && typeof parsed.method === 'string' ? parsed.method : undefined;
  } catch {
    return undefined;
  }
}

function describeReported(value: unknown): string {
  if (typeof value === 'string' && /^0x[0-9a-f]+$/iu.test(value) && value.length <= 18) {
    return BigInt(value).toString() + ' (' + value + ')';
  }
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 40 ? text.slice(0, 40) + '…' : text;
}

function refused(plan: NetworkCheckPlan, message: string): ExecutionResult {
  return {
    status: 'failed',
    steps: plan.steps.map(step => ({ ...step, status: 'skipped', detail: 'Not run: the plan was refused.' })),
    source: plan.target.endpoint,
    checkedAt: new Date().toISOString(),
    error: { code: 'tool_not_allowed', message },
    summary: 'The plan was refused before any request was sent: ' + message,
  };
}

/**
 * Runs a network-check plan with an allow-listed read-only tool. Step outcomes come from the
 * JSON-RPC requests the tool actually sent, observed through a wrapped `fetch`.
 */
export async function executePlan(plan: NetworkCheckPlan, options: ReadOptions = {}): Promise<ExecutionResult> {
  const tool = Object.hasOwn(READ_ONLY_TOOLS, plan.tool) ? READ_ONLY_TOOLS[plan.tool] : undefined;
  if (!tool) return refused(plan, 'Tool "' + String(plan.tool) + '" is not an allowed read-only tool.');
  const allowed: readonly string[] = tool.methods;
  const disallowed = plan.steps.find(step => !allowed.includes(step.rpcMethod));
  if (disallowed) return refused(plan, 'RPC method "' + String(disallowed.rpcMethod) + '" is not allowed for this tool.');

  const base = options.fetch ?? globalThis.fetch;
  const sent: string[] = [];
  const reported = new Map<string, unknown>();
  const observedFetch: typeof globalThis.fetch = async (input, init) => {
    const method = rpcMethodOf(init?.body);
    if (!method || !allowed.includes(method)) throw new TypeError('Blocked a request outside the read-only allow list.');
    sent.push(method);
    const response = await base(input, init);
    try {
      const body: unknown = await response.clone().json();
      if (isRecord(body) && 'result' in body) reported.set(method, body.result);
    } catch {
      // The tool reports unreadable bodies itself.
    }
    return response;
  };

  try {
    const data = await tool.run({ ...options, fetch: observedFetch });
    const details: Record<PlanStep['id'], string> = {
      verify_chain_id: 'Endpoint reported ' + data.evmChainId + ' (' + plan.target.evmChainHex + '), matching ' + plan.target.name + '.',
      read_block_height: 'Latest block height: ' + data.blockNumber + '.',
    };
    const checkedAt = new Date().toISOString();
    return {
      status: 'success',
      steps: plan.steps.map(step => ({ ...step, status: 'succeeded', detail: details[step.id] })),
      source: plan.target.endpoint,
      checkedAt,
      data,
      summary: plan.target.name + ' EVM JSON-RPC answered: chain ID ' + data.evmChainId + ' verified, latest block '
        + data.blockNumber + '. ' + SCOPE_NOTE,
    };
  } catch (error) {
    const code = error instanceof QoreChainReadError ? error.code : 'unexpected_error';
    const message = error instanceof QoreChainReadError ? error.message : 'The check failed unexpectedly.';
    const last = sent.at(-1);
    const failedIndex = Math.max(0, plan.steps.findIndex(step => step.rpcMethod === last));
    const steps = plan.steps.map((step, index): StepResult => {
      if (index < failedIndex) {
        return { ...step, status: 'succeeded', detail: step.id === 'verify_chain_id'
          ? 'Endpoint reported ' + describeReported(reported.get(step.rpcMethod)) + ', matching ' + plan.target.name + '.'
          : 'Completed.' };
      }
      if (index > failedIndex) return { ...step, status: 'skipped', detail: 'Not run because an earlier step failed.' };
      const detail = code === 'chain_mismatch'
        ? 'Endpoint reported ' + describeReported(reported.get(step.rpcMethod)) + '; expected ' + plan.target.evmChainId
          + ' (' + plan.target.evmChainHex + ').'
        : message;
      return { ...step, status: 'failed', detail };
    });
    const partial = failedIndex > 0;
    const summary = code === 'chain_mismatch'
      ? 'The endpoint did not identify as ' + plan.target.name + ', so no block height was read.'
      : partial
        ? 'Chain ID ' + plan.target.evmChainId + ' was verified, but reading the latest block failed: ' + message + ' No block height is reported.'
        : 'The ' + plan.target.name + ' check could not be completed: ' + message;
    return {
      status: partial ? 'partial' : 'failed',
      steps,
      source: plan.target.endpoint,
      checkedAt: new Date().toISOString(),
      error: { code, message },
      summary,
    };
  }
}
