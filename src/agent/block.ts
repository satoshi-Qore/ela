import { getEvmBlock, MAX_BLOCK_NUMBER } from '../qorechain/get-evm-block.ts';
import type { EvmBlock } from '../qorechain/get-evm-block.ts';
import type { ReadOptions } from '../qorechain/read-client.ts';
import type { QueryRun } from './conversation.ts';
import { foldCommand } from './intent.ts';
import type { IntentDecision } from './intent.ts';
import { DIANA_NETWORK, invokeTool } from './registry.ts';

/**
 * Block-by-number queries on Diana testnet: recognizing the request and the read. Loaded on demand
 * (a separate chunk in the web build), only for a command with a digit and a block word, or when
 * the registry's `get_block` tool runs.
 *
 * `interpretCommand` calls `decideBlock` after the safety gate and the other-network check have
 * run on the whole command, so nothing here can let a refused or other-network command through.
 * The sentence must be made only of a fixed lookup vocabulary around exactly one number; the number
 * must be plain decimal digits without a sign, decimals, separators, or leading zeros, and at most
 * 2^53 − 1. Anything else that looks like a block query sends nothing (`invalid_block_number`).
 *
 * A bare "Block 100." stays ambiguous (block 100, or 100 blocks?), as the evaluation sets label it:
 * the sentence needs one more word, such as "numaralı", "number", "show", or "details".
 */

// Every run of digits with the characters that could make it a different number: a sign, a
// decimal point or comma, or a separator. "-5", "1.5", "10.275.626", and "1_000" are one run each.
const numberLike = /[-+−]?\d(?:[\d.,_]*\d)?/gu;

// The only words a block query may contain (folded: lower case, Turkish letters as ASCII,
// apostrophes dropped). No request verb that sends, signs, or changes anything; no "son" or "last"
// (the latest block is its own query), no other network.
const blockWords: ReadonlySet<string> = new Set((
  // Turkish
  'blok bloku blogu blogun blogunu blogunun bloga blokta bloktaki blogundaki '
  + 'numara numarali numarasi numarasini no nci inci uncu ncu yukseklik yuksekligi yuksekligindeki '
  + 'goster gosterir gosterebilir gosterin sorgula ogren getir soyle bak kontrol et '
  + 'bilgi bilgisi bilgileri bilgilerini detay detaylari detaylarini ne nedir neler hangi kac var ve '
  + 'icinde icindeki hash hashi zaman zamani damgasi islem islemi islemler islemleri sayisi gas limit limiti kullanimi kullanilan '
  + 'hakkinda bana lutfen mi mu misin musun acaba peki bu su icin in nin un nun '
  + 'diana dianada dianadaki dianadan testnet testnette testnetteki test agi aginda agindaki agda agdaki qorechain qorechainde qorechaindeki '
  // English
  + 'block blocks number height at of for the a an show me get check what whats is was in on display fetch read find look up tell '
  + 'details detail info information about data hash timestamp time transactions transaction count how many gas used limit when which give and '
  + 'are there diana testnet network please can could you'
).split(' '));

export type BlockRequest =
  | { readonly kind: 'none' }
  | { readonly kind: 'block'; readonly number: number }
  | { readonly kind: 'invalid_block_number' };

/**
 * Recognizes a Turkish or English request for one Diana block by number, such as "10275626
 * numaralı bloğu göster", "Diana'da 10275626. blok", "Show block 10275626", or "What is in block
 * 10275626 on Diana?". The number is returned as a safe integer. A block sentence with any other
 * number, or with more than one, returns `invalid_block_number`.
 */
export function recognizeBlockRequest(command: unknown): BlockRequest {
  if (typeof command !== 'string') return { kind: 'none' };
  const text = command.normalize('NFC');
  const numbers = text.match(numberLike) ?? [];
  if (numbers.length === 0) return { kind: 'none' };
  const words = foldCommand(text.replace(numberLike, ' ')).split(' ').filter(Boolean);
  if (!words.some(w => w.startsWith('blo')) || !words.some(w => !w.startsWith('blo')) || !words.every(w => blockWords.has(w))) return { kind: 'none' };
  const [digits, ...others] = numbers;
  if (others.length > 0 || !/^(?:0|[1-9]\d{0,15})$/u.test(digits!)) return { kind: 'invalid_block_number' };
  const number = Number(digits);
  return number <= MAX_BLOCK_NUMBER ? { kind: 'block', number } : { kind: 'invalid_block_number' };
}

/** The decision for a recognized block query, or `undefined` for any other command. */
export function decideBlock(command: string): IntentDecision | undefined {
  const block = recognizeBlockRequest(command);
  if (block.kind === 'none') return undefined;
  if (block.kind === 'invalid_block_number') return Object.freeze({ kind: 'clarify', reason: 'invalid_block_number', source: 'input_check' });
  return Object.freeze({ kind: 'run', query: 'block', intent: 'block', source: 'deterministic', blockNumber: block.number });
}

/** What the block tool returns. */
export type BlockReading = EvmBlock;

/** Reads one block on the fixed Diana endpoint. Only `fetch` and `timeoutMs` come from the caller. */
export function readBlock(number: number, runtime: Pick<ReadOptions, 'fetch' | 'timeoutMs'>): Promise<BlockReading> {
  return getEvmBlock(number, { fetch: runtime.fetch, timeoutMs: runtime.timeoutMs });
}

/** Reads one block through the tool registry, with fresh data on every call. */
export async function runBlockQuery(blockNumber: number, options: Pick<ReadOptions, 'fetch' | 'timeoutMs'> = {}): Promise<QueryRun> {
  const result = await invokeTool({
    tool: 'get_block',
    network: DIANA_NETWORK,
    params: { number: blockNumber },
    rpcMethods: ['eth_chainId', 'eth_getBlockByNumber', 'eth_blockNumber'],
  }, options);
  return { kind: 'block', blockNumber, result };
}
