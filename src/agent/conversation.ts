import type { ReadOptions } from '../qorechain/read-client.ts';
import { executePlan } from './executor.ts';
import type { ExecutionResult } from './executor.ts';
import { planCommand } from './planner.ts';
import { DIANA_NETWORK, invokeTool } from './registry.ts';
import type { NetworkId, RuntimeOptions, ToolResult } from './registry.ts';

/** The kinds of successful queries a follow-up may refer to. */
export type QueryKind = 'block_number' | 'network_check';

/**
 * What ELA remembers about the last successful query. It deliberately stores no block height:
 * every follow-up reads fresh data from the RPC.
 */
export interface ConversationContext {
  readonly kind: QueryKind;
  readonly network: NetworkId;
}

export interface Conversation {
  /** The last successful query in this page session, if any. */
  readonly current: ConversationContext | undefined;
  /** Records a query outcome. Only `success` replaces the context; anything else leaves it unchanged. */
  record(kind: QueryKind, outcome: 'success' | 'partial' | 'failed'): void;
  clear(): void;
}

/** Creates an in-memory conversation. Nothing is persisted; a page reload starts with no context. */
export function createConversation(): Conversation {
  let current: ConversationContext | undefined;
  return Object.freeze({
    get current() {
      return current;
    },
    record(kind: QueryKind, outcome: 'success' | 'partial' | 'failed') {
      if (outcome === 'success' && (kind === 'block_number' || kind === 'network_check')) {
        current = Object.freeze({ kind, network: DIANA_NETWORK });
      }
    },
    clear() {
      current = undefined;
    },
  });
}

export type FollowUp =
  | { readonly kind: 'not_follow_up' }
  | { readonly kind: 'needs_clarification'; readonly reason: 'no_context' }
  | { readonly kind: 'follow_up'; readonly question: 'current_value' | 'repeat'; readonly run: QueryKind; readonly basedOn: QueryKind };

// "Peki şimdi kaç oldu?" asks for the current block height again.
const currentValuePattern = /^(?:peki )?(?:şimdi |artık )?kaç oldu$|^(?:peki )?şimdi kaç$/u;
// "Tekrar kontrol et" repeats the last successful query.
const repeatPattern = /^(?:peki )?(?:tekrar|yeniden|bir daha) (?:kontrol et|sorgula)$/u;

function normalize(command: string): string {
  return command.normalize('NFC').toLocaleLowerCase('tr').trim().replace(/\s+/gu, ' ').replace(/[.!?]+$/u, '').trim();
}

/**
 * Resolves a supported follow-up question against the conversation context. Only a fixed set of
 * Turkish follow-ups is recognized; other commands return `not_follow_up`.
 */
export function resolveFollowUp(command: string, context: ConversationContext | undefined): FollowUp {
  if (typeof command !== 'string') return { kind: 'not_follow_up' };
  const text = normalize(command);
  const question = currentValuePattern.test(text) ? 'current_value' : repeatPattern.test(text) ? 'repeat' : undefined;
  if (!question) return { kind: 'not_follow_up' };
  if (!context || context.network !== DIANA_NETWORK) return { kind: 'needs_clarification', reason: 'no_context' };
  // Both earlier query kinds report a block height, so "kaç oldu" reads the latest block again.
  const run = question === 'current_value' ? 'block_number' : context.kind;
  return { kind: 'follow_up', question, run, basedOn: context.kind };
}

/** Reads the latest Diana block through the tool registry (chain ID verified first). */
export function queryLatestBlock(runtime: RuntimeOptions = {}): Promise<ToolResult> {
  return invokeTool(
    { tool: 'get_evm_block_number', network: DIANA_NETWORK, params: {}, rpcMethods: ['eth_chainId', 'eth_blockNumber'] },
    runtime,
  );
}

export type QueryRun =
  | { readonly kind: 'block_number'; readonly result: ToolResult }
  | { readonly kind: 'network_check'; readonly result: ExecutionResult };

/** Runs a query kind with fresh RPC data. Every call sends new requests; nothing is reused. */
export async function runQuery(kind: QueryKind, options: ReadOptions = {}): Promise<QueryRun> {
  if (kind === 'network_check') {
    const plan = planCommand('Diana ağını kontrol et.');
    if (plan.kind !== 'plan') throw new Error('The Diana network check plan is unavailable.');
    return { kind, result: await executePlan(plan, options) };
  }
  return { kind: 'block_number', result: await queryLatestBlock(options) };
}

/** Maps a query run to the outcome used for context recording. */
export function outcomeOf(run: QueryRun): 'success' | 'partial' | 'failed' {
  if (run.kind === 'block_number') return run.result.ok ? 'success' : 'failed';
  return run.result.status;
}
