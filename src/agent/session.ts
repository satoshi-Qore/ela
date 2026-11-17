import type { ReadOptions } from '../qorechain/read-client.ts';
import { createConversation, outcomeOf } from './conversation.ts';
import type { ConversationContext, QueryKind, QueryRun } from './conversation.ts';
import { actOnDecision, interpretCommand } from './intent.ts';
import type { ClarifyReason, DecisionThresholds, IntentClassifier, IntentDecision, RiskCategory } from './intent.ts';
import { ruleClassifier } from './lexicon.ts';

/**
 * The single entry point for an ELA agent conversation. It composes the existing pieces and adds no
 * decision logic of its own:
 *
 *   command → interpretCommand (input checks, safety gate, network and parameter checks,
 *             deterministic routes, then the classifier, validated by decideIntent)
 *           → actOnDecision (only a `run` decision; runQuery → tool registry → guarded fetch)
 *           → conversation.record (only a successful query replaces the context)
 *
 * The session takes only a command string. There is no way to hand it a decision, a label, a tool,
 * or an RPC method, so a classifier (rule-based today, a model later) can only influence the outcome
 * through `interpretCommand`, which runs the safety gate first and never shows the classifier a
 * command the gate refused. The tool registry allows only `eth_chainId` and `eth_blockNumber`, and
 * for a balance query only the fixed Diana consensus `/status` and REST bank-balance GETs, all on
 * Diana testnet. A balance query never changes the context. Nothing is stored outside this session
 * object.
 */

export interface SessionOptions {
  /** Intent classifier used after the deterministic routes. Defaults to the rule-based lexicon. */
  readonly classifier?: IntentClassifier;
  readonly thresholds?: DecisionThresholds;
  /** Transport and timeout for the read-only tools (tests pass a fake fetch). */
  readonly fetch?: ReadOptions['fetch'];
  readonly timeoutMs?: ReadOptions['timeoutMs'];
}

export type CommandResult =
  /** A read-only query ran. `outcome` is `success`, `partial`, or `failed`; only `success` updates the context. */
  | {
      readonly kind: 'answered';
      readonly query: QueryKind;
      readonly outcome: 'success' | 'partial' | 'failed';
      readonly run: QueryRun;
      readonly decision: Extract<IntentDecision, { kind: 'run' }>;
      readonly context: ConversationContext | undefined;
    }
  /** The safety gate refused the command before any classifier call or request. */
  | { readonly kind: 'refused'; readonly reason: RiskCategory; readonly decision: IntentDecision; readonly context: ConversationContext | undefined }
  /** A read question ELA does not support (fees, balances, transactions, ...). Nothing was sent. */
  | { readonly kind: 'unsupported'; readonly decision: IntentDecision; readonly context: ConversationContext | undefined }
  /** ELA needs a clearer command. Nothing was sent. */
  | { readonly kind: 'clarify'; readonly reason: ClarifyReason; readonly decision: IntentDecision; readonly context: ConversationContext | undefined }
  /** An unexpected failure (for example invalid thresholds). Nothing is recorded in the context. */
  | { readonly kind: 'error'; readonly message: string; readonly context: ConversationContext | undefined };

export interface AgentSession {
  /** The last successful query kind and its network, or `undefined`. Never a block height. */
  readonly context: ConversationContext | undefined;
  /** Handles one command. Never throws; every outcome is a frozen `CommandResult`. */
  handleCommand(command: unknown): Promise<CommandResult>;
  /** Forgets the context. */
  clear(): void;
}

/** Creates an in-memory agent session with its own conversation context. */
export function createSession(options: SessionOptions = {}): AgentSession {
  const conversation = createConversation();
  const classifier = options.classifier ?? ruleClassifier;
  const interpretOptions = { classifier, ...(options.thresholds ? { thresholds: options.thresholds } : {}) };
  const readOptions: ReadOptions = {
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  };

  async function handle(command: unknown): Promise<CommandResult> {
    const decision = await interpretCommand(command, conversation.current, interpretOptions);
    if (decision.kind === 'refuse') return { kind: 'refused', reason: decision.reason, decision, context: conversation.current };
    if (decision.kind === 'unsupported') return { kind: 'unsupported', decision, context: conversation.current };
    if (decision.kind === 'clarify') return { kind: 'clarify', reason: decision.reason, decision, context: conversation.current };

    const run = await actOnDecision(decision, readOptions);
    if (!run) return { kind: 'error', message: 'The decision could not be run.', context: conversation.current };
    const outcome = outcomeOf(run);
    conversation.record(decision.query, outcome);
    return { kind: 'answered', query: decision.query, outcome, run, decision, context: conversation.current };
  }

  return Object.freeze({
    get context() {
      return conversation.current;
    },
    async handleCommand(command: unknown): Promise<CommandResult> {
      try {
        return Object.freeze(await handle(command));
      } catch {
        return Object.freeze({ kind: 'error', message: 'The command failed unexpectedly.', context: conversation.current });
      }
    },
    clear() {
      conversation.clear();
    },
  });
}
