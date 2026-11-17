import { getEvmTransaction } from '../qorechain/get-evm-transaction.ts';
import type { EvmTransaction } from '../qorechain/get-evm-transaction.ts';
import type { ReadOptions } from '../qorechain/read-client.ts';
import type { QueryRun } from './conversation.ts';
import { assessRisk, foldCommand, mentionsOtherNetwork } from './intent.ts';
import type { IntentDecision } from './intent.ts';
import { DIANA_NETWORK, invokeTool } from './registry.ts';

/**
 * Transaction status queries on Diana testnet: recognizing the request and the read. Loaded on
 * demand (a separate chunk in the web build), only for a command with a long 0x value or when the
 * registry's `get_transaction` tool runs.
 *
 * A transaction hash has the same form as a private key (0x and 64 hex digits), which the safety
 * gate refuses as key material. `recognizeTransactionRequest` only accepts a sentence made of a
 * fixed transaction-lookup vocabulary around exactly one 0x-prefixed value; the gate then still runs
 * on the rest of the sentence (see `interpretCommand`). Anything else, including a bare 64-hex value
 * or one next to words like "key" or "anahtar", stays refused by the gate as before.
 */

// Every 0x value in the command, valid hash or not.
const hexLike = /(?<![0-9a-z])0x[0-9a-z]*(?![0-9a-z])/giu;

// The only words a transaction query may contain (folded: lower case, Turkish letters as ASCII,
// apostrophes dropped). No request verb that sends, signs, approves, cancels, or speeds up anything.
const txWords: ReadonlySet<string> = new Set((
  // Turkish
  'islem islemi islemin isleminin islemini isleme hash hashi hashin hashinin hashini hashli tx txin txi '
  + 'makbuz makbuzu makbuzunu durum durumu durumunu durumda sonuc sonucu sonucunu bilgi bilgisi bilgilerini detay detaylari detaylarini '
  + 'ne nedir hangi blokta blok kac oldu olmus basarili basarisiz beklemede mi mu misin musun '
  + 'goster gosterir gosterebilir sorgula ogren kontrol et getir soyle bak lutfen bana bu su icin in nin un nun '
  + 'diana dianada dianadaki testnet testnette testnetteki test agi aginda agindaki agda agdaki qorechain qorechainde qorechaindeki '
  // English
  + 'transaction transactions hash receipt status of for the a an is was what whats show me check get look up find tell '
  + 'did has been mined included succeed succeeded success fail failed pending details info about which block in on '
  + 'diana testnet network please can could you it'
).split(' '));

export type TransactionRequest =
  | { readonly kind: 'none' }
  /** `rest` is the command without the hash, for the safety gate. */
  | { readonly kind: 'transaction'; readonly hash: string; readonly rest: string }
  | { readonly kind: 'invalid_hash'; readonly rest: string };

/**
 * Recognizes a Turkish or English request for the status of one Diana transaction, such as
 * "0x… işleminin durumu nedir?", "0x… hash'li işlemi sorgula", or "What is the status of
 * transaction 0x…?". The hash must be 0x and exactly 64 hexadecimal digits; it is returned in lower
 * case. A transaction sentence with any other 0x value returns `invalid_hash`.
 */
export function recognizeTransactionRequest(command: unknown): TransactionRequest {
  if (typeof command !== 'string') return { kind: 'none' };
  const text = command.normalize('NFC');
  const values = text.match(hexLike) ?? [];
  if (values.length !== 1) return { kind: 'none' };
  const rest = text.replace(hexLike, ' ');
  const words = foldCommand(rest).split(' ').filter(Boolean);
  const cue = words.some(w => /^(?:islem|hash|tx|makbuz|transaction|receipt)/u.test(w));
  if (!cue || !words.every(w => txWords.has(w))) return { kind: 'none' };
  const value = values[0]!;
  return /^0x[0-9a-f]{64}$/iu.test(value) ? { kind: 'transaction', hash: value.toLowerCase(), rest } : { kind: 'invalid_hash', rest };
}

/**
 * The decision for a recognized transaction query, or `undefined` for any other command (which then
 * goes through the normal pipeline, where the gate refuses a bare 64-hex value as key material).
 * The safety gate and the other-network check run on the sentence without the hash, unchanged.
 */
export function decideTransaction(command: string): IntentDecision | undefined {
  const tx = recognizeTransactionRequest(command);
  if (tx.kind === 'none') return undefined;
  const risk = assessRisk(tx.rest);
  if (risk.risk === 'blocked') return Object.freeze({ kind: 'refuse', reason: risk.category, source: 'safety_gate' });
  if (mentionsOtherNetwork(tx.rest)) return Object.freeze({ kind: 'clarify', reason: 'unsupported_network', source: 'input_check' });
  if (tx.kind === 'invalid_hash') return Object.freeze({ kind: 'clarify', reason: 'invalid_hash', source: 'input_check' });
  return Object.freeze({ kind: 'run', query: 'transaction', intent: 'transaction', source: 'deterministic', hash: tx.hash });
}

/** What the transaction tool returns. */
export type TransactionReading = EvmTransaction;

/** Reads one transaction on the fixed Diana endpoint. Only `fetch` and `timeoutMs` come from the caller. */
export function readTransaction(hash: string, runtime: Pick<ReadOptions, 'fetch' | 'timeoutMs'>): Promise<TransactionReading> {
  return getEvmTransaction(hash, { fetch: runtime.fetch, timeoutMs: runtime.timeoutMs });
}

/** Reads one transaction through the tool registry, with fresh data on every call. */
export async function runTransactionQuery(hash: string, options: Pick<ReadOptions, 'fetch' | 'timeoutMs'> = {}): Promise<QueryRun> {
  const result = await invokeTool({
    tool: 'get_transaction',
    network: DIANA_NETWORK,
    params: { hash },
    rpcMethods: ['eth_chainId', 'eth_getTransactionByHash', 'eth_getTransactionReceipt'],
  }, options);
  return { kind: 'transaction', hash, result };
}
