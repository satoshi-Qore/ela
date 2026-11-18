import { getEvmGas } from '../qorechain/get-evm-gas.ts';
import type { EvmGas } from '../qorechain/get-evm-gas.ts';
import type { ReadOptions } from '../qorechain/read-client.ts';
import type { QueryRun } from './conversation.ts';
import { foldCommand } from './intent.ts';
import type { IntentDecision } from './intent.ts';
import { DIANA_NETWORK, invokeTool } from './registry.ts';

/**
 * Gas price and fee queries on Diana testnet: recognizing the question and the read. Loaded on
 * demand (a separate chunk in the web build), only for a command with a fee word, or when the
 * registry's `get_gas_fees` tool runs.
 *
 * `interpretCommand` calls `decideGas` after the safety gate and the other-network check have run
 * on the whole command, so "Transfer 5 QOR and tell me the fee" is still refused, and a mainnet
 * fee question still gets the network answer. The sentence must contain a fee word and be made only
 * of a fixed vocabulary: no number, address, other topic (swap, stake, validator, balance, ...), or
 * request verb that sends or signs. Anything else falls through to the existing rules, which answer
 * that it is not supported.
 */

const feeWord = /^(?:gas|gaz|gwei|fee|fees|cost|costs|ucret[a-z]*|maliyet[a-z]*)$/u;

// The only words a fee question may contain (folded: lower case, Turkish letters as ASCII,
// apostrophes dropped). "transfer" is here only as the subject of a question ("transfer ücreti ne
// kadar"); a transfer request is refused by the safety gate before this runs.
const gasWords: ReadonlySet<string> = new Set((
  // Turkish
  'gas gaz gwei ucret ucreti ucretleri ucretler ucretini ucretlerini ucretinin ucretlerinin maliyet maliyeti maliyetini '
  + 'fiyat fiyati fiyatini fiyatlari fiyatlarini taban baz temel oncelik oncelikli oncelik base priority tip '
  + 'islem islemi islemin islemler islemleri islemlerin transfer transferi transferin gonderim gonderimi '
  + 'ne kadar kac nedir neler nasil su an anki suan simdi simdiki guncel mevcut bugun bugunku tahmini ortalama yaklasik standart basit '
  + 'goster gosterir gosterebilir gosterin soyle soyler ogren getir bak kontrol et sorgula bilgi bilgisi bilgileri '
  + 'bana lutfen mi mu misin musun acaba peki ve ile icin bir olur tutar eder '
  + 'diana dianada dianadaki dianadan testnet testnette testnetteki test agi aginda agindaki agda agdaki agin qorechain qorechainde qorechaindeki '
  // English
  + 'gas gwei fee fees price prices cost costs base priority tip max per unit network transaction transactions transfer transfers '
  + 'what whats is are the a an how much does do it would will be on of for in at to and right now current currently latest today '
  + 'show me tell get check fetch give read please can could you estimate estimated typical standard simple plain diana testnet qorechain'
).split(' '));

/**
 * Recognizes a Turkish or English question about the current gas price or network fee on Diana,
 * such as "Diana'da gas ücreti ne kadar?", "Transfer ücreti ne kadar?", "What is the gas price?",
 * or "How much does a transfer cost on Diana?".
 */
export function isGasQuestion(command: unknown): boolean {
  if (typeof command !== 'string' || /\d/u.test(command)) return false;
  const words = foldCommand(command).split(' ').filter(Boolean);
  return words.some(w => feeWord.test(w)) && words.every(w => gasWords.has(w));
}

/** The decision for a recognized fee question, or `undefined` for any other command. */
export function decideGas(command: string): IntentDecision | undefined {
  return isGasQuestion(command) ? Object.freeze({ kind: 'run', query: 'gas', intent: 'gas', source: 'deterministic' }) : undefined;
}

/** What the gas tool returns. */
export type GasReading = EvmGas;

/** Reads fee data on the fixed Diana endpoint. Only `fetch` and `timeoutMs` come from the caller. */
export function readGas(runtime: Pick<ReadOptions, 'fetch' | 'timeoutMs'>): Promise<GasReading> {
  return getEvmGas({ fetch: runtime.fetch, timeoutMs: runtime.timeoutMs });
}

/** Reads fee data through the tool registry, with fresh data on every call. */
export async function runGasQuery(options: Pick<ReadOptions, 'fetch' | 'timeoutMs'> = {}): Promise<QueryRun> {
  const result = await invokeTool({
    tool: 'get_gas_fees',
    network: DIANA_NETWORK,
    params: {},
    rpcMethods: ['eth_chainId', 'eth_gasPrice', 'eth_feeHistory', 'eth_maxPriorityFeePerGas'],
  }, options);
  return { kind: 'gas', result };
}
