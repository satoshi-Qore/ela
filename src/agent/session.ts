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
 * for a balance query only `eth_chainId` and `eth_getBalance`, all on the Diana EVM endpoint of
 * Diana testnet. A balance query never changes the context. Nothing is stored outside this session
 * object.
 *
 * A transaction lookup is the one query that waits: its hash has the form of a private key, so
 * `handleCommand` returns `confirm` and sends nothing. Only `confirmPending`, the user's explicit
 * confirmation, reads it (eth_chainId, eth_getTransactionByHash, eth_getTransactionReceipt); any
 * new command, `cancelPending`, or `clear` drops it.
 */

export interface SessionOptions {
  /** Intent classifier used after the deterministic routes. Defaults to the rule-based lexicon. */
  readonly classifier?: IntentClassifier;
  /** Connect the optional runtime; its separate user opt-in remains disabled by default. */
  readonly optionalLocalModel?: boolean;
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
  /** A read question ELA does not support (fees, your own balance or history, ...). Nothing was sent. */
  | { readonly kind: 'unsupported'; readonly decision: IntentDecision; readonly context: ConversationContext | undefined }
  /**
   * A transaction lookup waits for the user to confirm that the value is a transaction hash and not
   * a private key (both are 0x and 64 hex digits). Nothing was sent. `preview` shows only the first
   * and last four hex digits; the full value is kept in this session until `confirmPending`,
   * `cancelPending`, or the next command, whichever comes first.
   */
  | { readonly kind: 'confirm'; readonly query: 'transaction'; readonly preview: string; readonly context: ConversationContext | undefined }
  /** ELA needs a clearer command. Nothing was sent. */
  | { readonly kind: 'clarify'; readonly reason: ClarifyReason; readonly decision: IntentDecision; readonly context: ConversationContext | undefined }
  /** An unexpected failure (for example invalid thresholds). Nothing is recorded in the context. */
  | { readonly kind: 'error'; readonly message: string; readonly context: ConversationContext | undefined };

export interface AgentSession {
  /** The last successful query kind and its network, or `undefined`. Never a block height. */
  readonly context: ConversationContext | undefined;
  /** Handles one command. Never throws; every outcome is a frozen `CommandResult`. */
  handleCommand(command: unknown): Promise<CommandResult>;
  /** The masked transaction hash waiting for confirmation, or `undefined`. */
  readonly pending: string | undefined;
  /**
   * The user's explicit confirmation of the waiting transaction lookup: only now is the hash read.
   * The confirmation is used once. Without a waiting lookup nothing is sent (`nothing_to_confirm`).
   */
  confirmPending(): Promise<CommandResult>;
  /** Drops the waiting transaction lookup without sending anything. */
  cancelPending(): void;
  /** Forgets the context (and any waiting lookup). */
  clear(): void;
}

const NOTHING_TO_CONFIRM: IntentDecision = Object.freeze({ kind: 'clarify', reason: 'nothing_to_confirm', source: 'input_check' });

/** Creates an in-memory agent session with its own conversation context. */
export function createSession(options: SessionOptions = {}): AgentSession {
  const conversation = createConversation();
  const classifier = options.classifier ?? (options.optionalLocalModel ? {
    async classify(text: string): Promise<unknown> {
      // Only runtime unavailability falls back here. Inference errors reach the intent validator.
      const ai = await import('../ai/controller.ts').catch(() => undefined);
      return ai ? ai.classify(text) : ruleClassifier.classify(text);
    },
  } : ruleClassifier);
  const interpretOptions = { classifier, ...(options.thresholds ? { thresholds: options.thresholds } : {}) };
  const readOptions: ReadOptions = {
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  };

  // The one transaction lookup waiting for the user's confirmation. Never stored anywhere else.
  let pending: { readonly hash: string; readonly preview: string } | undefined;

  async function handle(decide: () => Promise<IntentDecision>): Promise<CommandResult> {
    const decision = await decide();
    if (decision.kind === 'confirm') {
      pending = { hash: decision.hash, preview: decision.hash.slice(0, 6) + '…' + decision.hash.slice(-4) };
      return { kind: 'confirm', query: decision.query, preview: pending.preview, context: conversation.current };
    }
    if (decision.kind === 'refuse') return { kind: 'refused', reason: decision.reason, decision, context: conversation.current };
    if (decision.kind === 'unsupported') return { kind: 'unsupported', decision, context: conversation.current };
    if (decision.kind === 'clarify') return { kind: 'clarify', reason: decision.reason, decision, context: conversation.current };

    const run = await actOnDecision(decision, readOptions);
    if (!run) return { kind: 'error', message: 'The decision could not be run.', context: conversation.current };
    const outcome = outcomeOf(run);
    conversation.record(decision.query, outcome);
    return { kind: 'answered', query: decision.query, outcome, run, decision, context: conversation.current };
  }

  async function guarded(decide: () => Promise<IntentDecision>): Promise<CommandResult> {
    try {
      return Object.freeze(await handle(decide));
    } catch {
      return Object.freeze({ kind: 'error', message: 'The command failed unexpectedly.', context: conversation.current });
    }
  }

  return Object.freeze({
    get context() {
      return conversation.current;
    },
    handleCommand(command: unknown): Promise<CommandResult> {
      // A confirmation applies only to the lookup right before it: any new command drops it.
      pending = undefined;
      return guarded(() => interpretCommand(command, conversation.current, interpretOptions));
    },
    get pending() {
      return pending?.preview;
    },
    confirmPending(): Promise<CommandResult> {
      const hash = pending?.hash;
      pending = undefined;
      return guarded(async () => hash
        ? Object.freeze({ kind: 'run', query: 'transaction', intent: 'transaction', source: 'deterministic', hash })
        : NOTHING_TO_CONFIRM);
    },
    cancelPending() {
      pending = undefined;
    },
    clear() {
      pending = undefined;
      conversation.clear();
    },
  });
}
