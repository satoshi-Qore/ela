import { getEvmToken } from '../qorechain/get-evm-token.ts';
import type { EvmToken } from '../qorechain/get-evm-token.ts';
import { checkAddress } from '../qorechain/keccak.ts';
import type { ReadOptions } from '../qorechain/read-client.ts';
import type { QueryRun } from './conversation.ts';
import { foldCommand } from './intent.ts';
import type { IntentDecision } from './intent.ts';
import { DIANA_NETWORK, invokeTool } from './registry.ts';

/**
 * ERC-20 token inspection on Diana testnet: recognizing the request and the read. Loaded on demand
 * (a separate chunk in the web build), only for a command with a 0x value and a token word, or when
 * the registry's `get_token` tool runs.
 *
 * `interpretCommand` calls `decideToken` after the safety gate and the other-network check have run
 * on the whole command. So a 64-hex value (which may be a private key) is still refused by the gate
 * or handled by the transaction rules before this runs; "send", "approve", or "transfer" requests
 * are still refused. The sentence must name a token, be made only of a fixed vocabulary (no
 * function such as balanceOf, approve, or transfer), and hold exactly one 0x value, which must be
 * an address of 40 hexadecimal digits with a valid EIP-55 checksum when it uses mixed case.
 */

const hexLike = /(?<![0-9a-z])0x[0-9a-z]*(?![0-9a-z])/giu;

// The only words a token query may contain (folded: lower case, Turkish letters as ASCII,
// apostrophes dropped).
const tokenWords: ReadonlySet<string> = new Set((
  // Turkish
  'token tokeni tokenin tokenini tokeninin tokena tokenda tokendaki tokenler tokenleri tokenlerini erc erc20 20 '
  + 'sozlesme sozlesmesi sozlesmesini sozlesmesinin sozlesmedeki kontrat kontrati kontratin kontratini kontratinin '
  + 'adres adresi adresindeki adresteki adresli adi adini ismi ismini sembol sembolu sembolunu ondalik ondaligi basamak '
  + 'toplam arz arzi arzini bilgi bilgisi bilgileri bilgilerini detay detaylari detaylarini '
  + 'incele inceler inceleyebilir misin incelesene goster gosterir gosterebilir gosterin sorgula ogren getir soyle bak kontrol et oku '
  + 'ne nedir neler hangi kac mi mu musun lutfen bana bu su icin in nin un nun ve sayisi '
  + 'diana dianada dianadaki testnet testnette testnetteki test agi aginda agindaki agda agdaki qorechain qorechainde qorechaindeki '
  // English
  + 'token tokens contract smart at address the a an of for on in show me get check inspect read look up tell '
  + 'what whats is are name symbol decimals total supply info information details about and which please can could you '
  + 'diana testnet network'
).split(' '));

export type TokenRequest =
  | { readonly kind: 'none' }
  | { readonly kind: 'token'; readonly address: string }
  | { readonly kind: 'invalid_token_address' };

/**
 * Recognizes a Turkish or English request to inspect one ERC-20 token, such as "0x… tokenini
 * incele", "0x… adresindeki tokenin adı ve sembolü nedir?", "Inspect token 0x…", or "What is the
 * total supply of token 0x… on Diana?". The address is returned in lower case.
 */
export function recognizeTokenRequest(command: unknown): TokenRequest {
  if (typeof command !== 'string') return { kind: 'none' };
  const text = command.normalize('NFC');
  const values = text.match(hexLike) ?? [];
  if (values.length === 0) return { kind: 'none' };
  const words = foldCommand(text.replace(hexLike, ' ')).split(' ').filter(Boolean);
  if (!words.some(w => /^(?:token|erc)/u.test(w)) || !words.every(w => tokenWords.has(w))) return { kind: 'none' };
  const address = values.length === 1 ? checkAddress(values[0]!) : undefined;
  return address ? { kind: 'token', address } : { kind: 'invalid_token_address' };
}

/** The decision for a recognized token query, or `undefined` for any other command. */
export function decideToken(command: string): IntentDecision | undefined {
  const token = recognizeTokenRequest(command);
  if (token.kind === 'none') return undefined;
  if (token.kind === 'invalid_token_address') return Object.freeze({ kind: 'clarify', reason: 'invalid_token_address', source: 'input_check' });
  return Object.freeze({ kind: 'run', query: 'token', intent: 'token', source: 'deterministic', address: token.address });
}

/** What the token tool returns. */
export type TokenReading = EvmToken;

/** Reads one token on the fixed Diana endpoint. Only `fetch` and `timeoutMs` come from the caller. */
export function readToken(address: string, runtime: Pick<ReadOptions, 'fetch' | 'timeoutMs'>): Promise<TokenReading> {
  return getEvmToken(address, { fetch: runtime.fetch, timeoutMs: runtime.timeoutMs });
}

/** Reads one token through the tool registry, with fresh data on every call. */
export async function runTokenQuery(address: string, options: Pick<ReadOptions, 'fetch' | 'timeoutMs'> = {}): Promise<QueryRun> {
  const result = await invokeTool({
    tool: 'get_token',
    network: DIANA_NETWORK,
    params: { address },
    rpcMethods: ['eth_chainId', 'eth_getCode', 'eth_call'],
  }, options);
  return { kind: 'token', address, result };
}
