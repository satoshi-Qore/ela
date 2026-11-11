import { dianaChainHex, evmEndpoint } from '../qorechain/get-evm-block-number.ts';
import { QORECHAIN_TESTNET } from '../qorechain/read-client.ts';

/** Read-only JSON-RPC methods a plan step may depend on. */
export type RpcMethod = 'eth_chainId' | 'eth_blockNumber';

export interface PlanStep {
  readonly id: 'verify_chain_id' | 'read_block_height';
  readonly title: string;
  readonly rpcMethod: RpcMethod;
}

export interface NetworkTarget {
  readonly name: 'Diana testnet';
  readonly chainId: string;
  readonly evmChainId: string;
  readonly evmChainHex: string;
  readonly endpoint: string;
}

export interface NetworkCheckPlan {
  readonly kind: 'plan';
  readonly intent: 'check_network';
  readonly target: NetworkTarget;
  /** The single read-only tool that performs every step, in order. */
  readonly tool: 'get_evm_block_number';
  readonly steps: readonly PlanStep[];
}

export type PlanResult = NetworkCheckPlan | { readonly kind: 'no_plan' };

export const DIANA_TARGET: NetworkTarget = Object.freeze({
  name: 'Diana testnet',
  chainId: QORECHAIN_TESTNET.chainId,
  evmChainId: BigInt(dianaChainHex).toString(),
  evmChainHex: dianaChainHex,
  endpoint: evmEndpoint,
});

const NETWORK_CHECK_PLAN: NetworkCheckPlan = Object.freeze({
  kind: 'plan',
  intent: 'check_network',
  target: DIANA_TARGET,
  tool: 'get_evm_block_number',
  steps: Object.freeze([
    Object.freeze({ id: 'verify_chain_id', title: 'Verify Diana EVM chain ID', rpcMethod: 'eth_chainId' }),
    Object.freeze({ id: 'read_block_height', title: 'Read latest block height', rpcMethod: 'eth_blockNumber' }),
  ] as const),
});

// "Diana" may be typed as DIANA, which Turkish lowercasing turns into "dıana".
const networkCheckPattern = /^(?:qorechain )?d[iı]ana (?:test ağını|ağını|testnet['’]?ini) kontrol et$/u;

function normalize(command: string): string {
  return command.normalize('NFC').toLocaleLowerCase('tr').trim().replace(/\s+/gu, ' ').replace(/[.!]+$/u, '').trim();
}

/**
 * Plans the supported multi-step agent intents. Only "Diana ağını kontrol et" is supported;
 * every other command returns `no_plan` so the existing single-command router stays in charge.
 */
export function planCommand(command: string): PlanResult {
  if (typeof command !== 'string' || !networkCheckPattern.test(normalize(command))) return { kind: 'no_plan' };
  return NETWORK_CHECK_PLAN;
}
