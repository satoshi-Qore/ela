import type { ReadOptions } from '../qorechain/read-client.ts';
import { routeCommand } from '../router.ts';
import { resolveFollowUp, runQuery } from './conversation.ts';
import type { ConversationContext, QueryKind, QueryRun } from './conversation.ts';
import { planCommand } from './planner.ts';
import { DIANA_NETWORK } from './registry.ts';

/**
 * Intent understanding foundation. A future local classifier may only pick one label from this
 * closed set and report confidence scores. It never chooses an RPC method, address, amount,
 * network, tool, or tool parameter: a fixed mapping in this module turns an accepted label into one
 * of the existing read-only query kinds, and those still run through the tool registry and RPC guard.
 *
 * This module is not wired into the web interface yet.
 */
export const INTENT_LABELS = Object.freeze([
  'network_check',
  'block_number',
  'follow_up_repeat',
  'follow_up_current',
  'unsupported',
  'unknown',
] as const);

export type IntentLabel = (typeof INTENT_LABELS)[number];
export type ActionIntent = Extract<IntentLabel, 'network_check' | 'block_number' | 'follow_up_repeat' | 'follow_up_current'>;

/** One candidate as a classifier reports it. Anything else in the output makes it invalid. */
export interface IntentCandidate {
  readonly label: IntentLabel;
  /** Normalized confidence in [0, 1]. The scores of all candidates sum to at most 1. */
  readonly score: number;
}

/**
 * A classifier receives only the user's text and returns scored candidates. Its output is
 * untrusted: `decideIntent` validates it and ignores nothing silently.
 */
export interface IntentClassifier {
  classify(text: string): Promise<unknown> | unknown;
}

export interface DecisionThresholds {
  readonly minConfidence: number;
  readonly minMargin: number;
}

/**
 * Placeholder thresholds. They have NOT been measured against a real model and are no evidence of
 * production accuracy; they must be calibrated on device before a classifier is enabled.
 */
export const PROVISIONAL_THRESHOLDS: DecisionThresholds & { readonly calibrated: false } = Object.freeze({
  minConfidence: 0.75,
  minMargin: 0.2,
  calibrated: false,
});

// Thresholds below these floors would let low-confidence guesses through.
const MIN_CONFIDENCE_FLOOR = 0.5;
const MIN_MARGIN_FLOOR = 0.05;
const MAX_COMMAND_LENGTH = 500;

export type RiskCategory = 'transfer' | 'signing' | 'key_material' | 'wallet_control' | 'state_change';

export type ClarifyReason =
  | 'empty_command'
  | 'command_too_long'
  | 'unsupported_network'
  | 'unsupported_parameters'
  | 'no_context'
  | 'not_understood'
  | 'classifier_unavailable'
  | 'invalid_classifier_output'
  | 'unknown_intent'
  | 'low_confidence'
  | 'ambiguous_intent';

export type DecisionSource = 'safety_gate' | 'input_check' | 'deterministic' | 'classifier';

export type IntentDecision =
  | {
      readonly kind: 'run';
      readonly query: QueryKind;
      readonly intent: ActionIntent;
      readonly source: 'deterministic' | 'classifier';
      readonly basedOn?: QueryKind;
      readonly confidence?: number;
      readonly margin?: number;
    }
  | { readonly kind: 'refuse'; readonly reason: RiskCategory; readonly source: 'safety_gate' }
  | { readonly kind: 'unsupported'; readonly source: 'classifier'; readonly confidence: number; readonly margin: number }
  | { readonly kind: 'clarify'; readonly reason: ClarifyReason; readonly source: DecisionSource };

// --- Normalization -------------------------------------------------------------------------------

const folding: Readonly<Record<string, string>> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };

/** Lower-cases with Turkish rules and collapses whitespace. Keeps punctuation. */
function normalize(command: string): string {
  return command.normalize('NFC').toLocaleLowerCase('tr').replace(/\s+/gu, ' ').trim();
}

/**
 * Folds Turkish letters to ASCII and turns punctuation into spaces, so "Cüzdanımı bağla" and
 * "cuzdanimi bagla" are checked alike. Apostrophes are dropped: "mainnet'e" becomes "mainnete".
 */
function fold(text: string): string {
  return text
    .replace(/[çğıöşüâîû]/gu, letter => folding[letter] ?? letter)
    .replace(/['’`]/gu, '')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

/** Folded form of a command, shared with the rule-based lexicon (`lexicon.ts`). */
export function foldCommand(command: string): string {
  return fold(normalize(command));
}

const word = (body: string): RegExp => new RegExp('(?<![a-z0-9])(?:' + body + ')(?![a-z0-9])', 'u');

/**
 * Request forms of a verb stem (on folded text): imperative ("gönder", "gönderin"), polite questions
 * ("gönderir misin", "gönderebilir misin"), and wishes or needs ("göndermek istiyorum",
 * "göndermem lazım", "göndereyim", "göndermeliyim", "göndereceğim"). Descriptive forms such as
 * "gönderdiğim", "gönderildi mi", or "göndermeden önce" are not requests and do not match.
 */
function requestOf(stem: string): string {
  const s = '(?:' + stem + ')';
  return [
    s + '(?:y?in|y?iniz|y?un|y?unuz|sene|sana|y?eyim|y?ayim|y?elim|y?alim)?',
    s + '(?:ir|ur|er|ar|r) m[iu]s[iu]n(?:[iu]z)?',
    s + '(?:y?e|y?a)bil(?:ir|ecek) m[iu]s[iu]n(?:[iu]z)?',
    s + '(?:mek|mak) (?:ist[a-z]*|lazim|gerek[a-z]*)',
    s + '(?:mem|mam|memiz|mamiz|men|man|meniz|maniz) (?:lazim|gerek[a-z]*)',
    s + '(?:meli|mali)(?:yim|yiz|sin|siniz)?',
    s + '(?:y?ecegim|y?acagim|y?ecegiz|y?acagiz)',
  ].join('|');
}

// --- Safety gate ---------------------------------------------------------------------------------

// Words that place money or an asset in the sentence.
const assetContext = word(
  'para[a-z]*|qor(?:u|a|un|lar[a-z]*)?|token[a-z]*|coin[a-z]*|jeton[a-z]*|bakiye[a-z]*|varlik[a-z]*|nft[a-z]*'
    + '|fon(?:u|um|umu|unu|lar|lari|larimi|larini)?|usdt|usdc|eth|btc|adres[a-z]*|hesab[a-z]*|hesap[a-z]*'
    + '|[0-9]+(?: [0-9]+)? ?(?:qor|token|coin|eth|usdt|tl|lira|dolar)'
    + '|money|funds?|assets?|balance[a-z]*|crypto',
);
// Words that make "gönder", "aktar", or "onayla" plausibly about reading data rather than funds.
const readContext = word('blo[kg][a-z]*|durum[a-z]*|sonuc[a-z]*|rapor[a-z]*|bilgi[a-z]*|veri[a-z]*|numara[a-z]*|yukseklig[a-z]*|yukseklik[a-z]*|ozet[a-z]*|chain id[a-z]*|zincir kimli[a-z]*'
  + '|block[a-z]*|status|result[a-z]*|report[a-z]*|info[a-z]*|data|height|number');
const transactionContext = word('islem[a-z]*|transfer[a-z]*|tx|izin[a-z]*|harcama[a-z]*|sozlesme[a-z]*|odeme[a-z]*|approve[a-z]*|allowance|transactions?|contracts?|spending');

interface RiskRule {
  readonly category: RiskCategory;
  readonly pattern: RegExp;
  /** Extra condition on the folded text. */
  readonly when?: (text: string) => boolean;
}

// English request openers on folded text: "please", "can you", "could you please", "i want to",
// "i'd like to", "let's", "go ahead and". A question such as "how do i send qor" is not a request.
const englishLead = '(?:(?:hey|ok|okay|ela|now|so|then|and) )*(?:(?:please|kindly|pls|just) )*'
  + '(?:(?:(?:can|could|would|will) you|i (?:want|need|would like|wanna)(?: you)? to|id like(?: you)? to|lets|let us|go ahead and|help me) (?:(?:please|kindly|just) )*)?';
const englishObject = 'my|all|the|this|these|that|those|it|to|[0-9]|tokens?|qor|coins?|funds?|nfts?|contracts?|transactions?|txs?|money|some|any|everything|a|an|our|your|out';

/**
 * English imperatives with an object ("send 5 qor", "please sign this", "can you transfer my
 * tokens"). With `indirect`, a pronoun may come first ("send me 5 qor").
 */
function englishRequest(verbs: string, indirect = false): RegExp {
  const pronoun = indirect ? '(?:(?:me|us|him|her|them) )?' : '';
  return new RegExp('^' + englishLead + '(?:' + verbs + ') ' + pronoun + '(?:' + englishObject + ')(?![a-z])', 'u');
}

const fundsOrNoRead =(text: string): boolean => assetContext.test(text) || !readContext.test(text);
const assetOnly = (text: string): boolean => assetContext.test(text);

const riskRules: readonly RiskRule[] = [
  // Secrets are never handled, whatever the phrasing.
  { category: 'key_material', pattern: word('ozel anahtar[a-z]*|gizli anahtar[a-z]*|private key[a-z]*|seed[a-z]*|mnemonic[a-z]*|kurtarma (?:ifade|cumle|kelime|anahtar)[a-z]*|gizli (?:ifade|cumle|kelime)[a-z]*|(?:12|24) kelime[a-z]*|sifre[a-z]*|parola[a-z]*'
    + '|privatekey[a-z]*|secret (?:key|phrase|recovery phrase)[a-z]*|recovery (?:phrase|words?)|password[a-z]*|passphrase[a-z]*|keystore|(?:12|24) words?') },
  { category: 'transfer', pattern: word(requestOf('transfer (?:et|ed|yap)|havale (?:et|ed|yap)|odeme (?:yap)|ode')) },
  { category: 'transfer', pattern: word('(?:transfer|gonderim|odeme|islem|tx)[a-z]* (?:taslagi |taslak )?(?:' + requestOf('hazirla') + ')') },
  { category: 'transfer', pattern: word(requestOf('gonder|yolla')), when: fundsOrNoRead },
  { category: 'transfer', pattern: word(requestOf('aktar|cek')), when: assetOnly },
  // English requests; "swap ücreti nedir" or "what is the transfer fee" are questions, not requests.
  // "Send me the latest block" reads data, so "send" and "move" need funds or no read context.
  { category: 'transfer', pattern: englishRequest('send|move', true), when: fundsOrNoRead },
  { category: 'transfer', pattern: englishRequest('withdraw|transfer|pay|wire', true) },
  { category: 'signing', pattern: englishRequest('sign|approve|authori[sz]e') },
  { category: 'signing', pattern: englishRequest('confirm'), when: text => transactionContext.test(text) || assetContext.test(text) || !readContext.test(text) },
  { category: 'wallet_control', pattern: new RegExp('^' + englishLead + '(?:connect|link|import|create|open|reset|unlock|drain|empty|delete|restore|recover|export) (?:(?:my|a|an|the|new|your|this|our) )*(?:wallet|account)s?(?![a-z])', 'u') },
  { category: 'state_change', pattern: englishRequest('swap|bridge|mint|deploy|stake|unstake|delegate|undelegate|redelegate|buy|sell|burn|trade|exchange|lend|borrow|claim|vote', true) },
  { category: 'signing', pattern: word(requestOf('imzala|imza at')) },
  { category: 'signing', pattern: word(requestOf('onayla')), when: text => transactionContext.test(text) || assetContext.test(text) || !readContext.test(text) },
  { category: 'wallet_control', pattern: word('(?:cuzdan|wallet)[a-z]* (?:' + requestOf('bagla|ac|olustur|kur|ice aktar|sil|bosalt|sifirla|import et|import ed') + ')') },
  { category: 'state_change', pattern: word(requestOf('stake (?:et|ed|yap)|stakele|unstake (?:et|ed|yap)?|delege (?:et|ed)|swap (?:et|ed|yap)|swapla|takas (?:et|ed|yap)|koprule|mint (?:et|ed|le)|nft bas|deploy (?:et|ed)|satin al')) },
  { category: 'state_change', pattern: word('sozlesme[a-z]* (?:' + requestOf('dagit|yayinla|deploy et|deploy ed') + ')') },
  { category: 'state_change', pattern: word(requestOf('sat|yak|bas')), when: assetOnly },
];

// 64 hexadecimal characters may be a private key; they are treated as secret material.
const rawSecret = /(?<![0-9a-f])(?:0x)?[0-9a-f]{64}(?![0-9a-f])/u;

export type RiskAssessment = { readonly risk: 'none' } | { readonly risk: 'blocked'; readonly category: RiskCategory };

/**
 * Deterministic safety gate. It looks for *requests* to move funds, sign, handle secrets, control a
 * wallet, or change chain state, and refuses them before any classifier or RPC call. Mentioning
 * such a word in a read question ("Transfer ücreti ne kadar?", "Gönderdiğim işlem onaylandı mı?",
 * "Para gönderme, sadece ağı kontrol et.") is not a request and is not blocked here.
 */
export function assessRisk(command: string): RiskAssessment {
  if (typeof command !== 'string') return { risk: 'none' };
  const normalized = normalize(command);
  if (rawSecret.test(normalized)) return Object.freeze({ risk: 'blocked', category: 'key_material' });
  const text = fold(normalized);
  for (const rule of riskRules) {
    if (rule.pattern.test(text) && (!rule.when || rule.when(text))) return Object.freeze({ risk: 'blocked', category: rule.category });
  }
  return { risk: 'none' };
}

// Networks other than Diana testnet. ELA never lets a classifier or a phrase select a network.
const otherNetwork = word('ana ?ag[a-z]*|mainnet[a-z]*|ethereum[a-z]*|bitcoin[a-z]*|solana[a-z]*|bsc|binance[a-z]*|polygon[a-z]*|avalanche[a-z]*|arbitrum[a-z]*|optimism[a-z]*|devnet[a-z]*'
  + '|main ?net(?:work)?[a-z]*|sepolia|goerli|holesky|tron|cardano|polkadot|litecoin|dogecoin|avax|bnb chain');
// Addresses and hashes are parameters; no supported intent accepts one.
const parameterPattern = /(?<![0-9a-z])(?:0x[0-9a-f]{40}|qor1[0-9a-z]{20,})(?![0-9a-z])/u;

export function mentionsOtherNetwork(command: string): boolean {
  return typeof command === 'string' && otherNetwork.test(fold(normalize(command)));
}

// --- Decision ------------------------------------------------------------------------------------

const labelSet: ReadonlySet<string> = new Set(INTENT_LABELS);
const candidateKeys = ['label', 'score'];

function clarify(reason: ClarifyReason, source: DecisionSource): IntentDecision {
  return Object.freeze({ kind: 'clarify', reason, source });
}

function checkThresholds(thresholds: DecisionThresholds): void {
  const { minConfidence, minMargin } = thresholds;
  if (!(typeof minConfidence === 'number' && minConfidence >= MIN_CONFIDENCE_FLOOR && minConfidence <= 1)) {
    throw new RangeError('minConfidence must be between ' + MIN_CONFIDENCE_FLOOR + ' and 1.');
  }
  if (!(typeof minMargin === 'number' && minMargin >= MIN_MARGIN_FLOOR && minMargin <= 1)) {
    throw new RangeError('minMargin must be between ' + MIN_MARGIN_FLOOR + ' and 1.');
  }
}

/** Validates raw classifier output. Returns sorted candidates, or undefined if anything is off. */
function readCandidates(output: unknown): IntentCandidate[] | undefined {
  if (!Array.isArray(output) || output.length === 0 || output.length > INTENT_LABELS.length) return undefined;
  const seen = new Set<string>();
  const candidates: IntentCandidate[] = [];
  let total = 0;
  for (const item of output) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return undefined;
    const prototype = Object.getPrototypeOf(item);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    // Extra fields (an RPC method, address, amount, network, tool, params, ...) invalidate the output.
    const keys = Reflect.ownKeys(item);
    if (keys.length !== candidateKeys.length || !candidateKeys.every(key => keys.includes(key))) return undefined;
    const { label, score } = item as { label: unknown; score: unknown };
    if (typeof label !== 'string' || !labelSet.has(label) || seen.has(label)) return undefined;
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) return undefined;
    seen.add(label);
    total += score;
    candidates.push({ label: label as IntentLabel, score });
  }
  if (total > 1 + 1e-6) return undefined;
  return candidates.sort((a, b) => b.score - a.score);
}

/** Maps an accepted action label to a fixed query kind. Nothing from the classifier is passed on. */
function mapIntent(intent: ActionIntent, context: ConversationContext | undefined): { query: QueryKind; basedOn?: QueryKind } | undefined {
  if (intent === 'network_check' || intent === 'block_number') return { query: intent };
  if (!context || context.network !== DIANA_NETWORK) return undefined;
  // Both earlier query kinds report a block height, so "how much now" reads the latest block.
  return { query: intent === 'follow_up_current' ? 'block_number' : context.kind, basedOn: context.kind };
}

/**
 * Turns classifier output into a decision. The top label must be a known action with confidence at
 * or above `minConfidence` and a lead of at least `minMargin` over the runner-up; otherwise ELA asks
 * for clarification. Follow-ups need a successful Diana query in the conversation context.
 */
export function decideIntent(
  output: unknown,
  context: ConversationContext | undefined,
  thresholds: DecisionThresholds = PROVISIONAL_THRESHOLDS,
): IntentDecision {
  checkThresholds(thresholds);
  const candidates = readCandidates(output);
  if (!candidates) return clarify('invalid_classifier_output', 'classifier');
  const [top, second] = candidates;
  const confidence = top.score;
  const margin = top.score - (second?.score ?? 0);
  if (top.label === 'unknown') return clarify('unknown_intent', 'classifier');
  if (confidence < thresholds.minConfidence) return clarify('low_confidence', 'classifier');
  if (margin < thresholds.minMargin) return clarify('ambiguous_intent', 'classifier');
  if (top.label === 'unsupported') return Object.freeze({ kind: 'unsupported', source: 'classifier', confidence, margin });
  const mapped = mapIntent(top.label, context);
  if (!mapped) return clarify('no_context', 'classifier');
  return Object.freeze({ kind: 'run', intent: top.label, source: 'classifier', confidence, margin, ...mapped });
}

// --- Pipeline ------------------------------------------------------------------------------------

export interface InterpretOptions {
  readonly classifier?: IntentClassifier;
  readonly thresholds?: DecisionThresholds;
}

/**
 * Interprets a command in a fixed order: input checks, the safety gate, network and parameter
 * checks, the existing deterministic planner, follow-up resolver, and router, and only then the
 * optional classifier. Without a classifier, or if it fails, the deterministic paths still work.
 */
export async function interpretCommand(
  command: unknown,
  context: ConversationContext | undefined,
  options: InterpretOptions = {},
): Promise<IntentDecision> {
  const thresholds = options.thresholds ?? PROVISIONAL_THRESHOLDS;
  checkThresholds(thresholds);
  if (typeof command !== 'string' || normalize(command) === '') return clarify('empty_command', 'input_check');
  if (command.length > MAX_COMMAND_LENGTH) return clarify('command_too_long', 'input_check');

  const risk = assessRisk(command);
  if (risk.risk === 'blocked') return Object.freeze({ kind: 'refuse', reason: risk.category, source: 'safety_gate' });
  if (mentionsOtherNetwork(command)) return clarify('unsupported_network', 'input_check');
  if (parameterPattern.test(normalize(command))) return clarify('unsupported_parameters', 'input_check');

  if (planCommand(command).kind === 'plan') {
    return Object.freeze({ kind: 'run', query: 'network_check', intent: 'network_check', source: 'deterministic' });
  }
  const followUp = resolveFollowUp(command, context);
  if (followUp.kind === 'needs_clarification') return clarify('no_context', 'deterministic');
  if (followUp.kind === 'follow_up') {
    return Object.freeze({
      kind: 'run',
      query: followUp.run,
      intent: followUp.question === 'current_value' ? 'follow_up_current' : 'follow_up_repeat',
      source: 'deterministic',
      basedOn: followUp.basedOn,
    });
  }
  const route = routeCommand(command);
  if (route.kind === 'route' && route.tool === 'get_block_number' && route.network !== 'mainnet') {
    return Object.freeze({ kind: 'run', query: 'block_number', intent: 'block_number', source: 'deterministic' });
  }

  if (!options.classifier) return clarify('not_understood', 'deterministic');
  let output: unknown;
  try {
    // The classifier sees only the normalized text, never the context or any runtime hooks.
    output = await options.classifier.classify(normalize(command));
  } catch {
    return clarify('classifier_unavailable', 'classifier');
  }
  return decideIntent(output, context, thresholds);
}

/**
 * Acts on a decision. Only `run` sends requests, and only through the existing `runQuery`, which
 * goes through the tool registry and RPC guard. Every other decision sends nothing.
 */
export async function actOnDecision(decision: IntentDecision, options: ReadOptions = {}): Promise<QueryRun | undefined> {
  if (decision.kind !== 'run') return undefined;
  if (decision.query !== 'network_check' && decision.query !== 'block_number') return undefined;
  return runQuery(decision.query, options);
}
