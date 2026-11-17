import { normalizeAddress } from '../qorechain/get-balance.ts';
import { evmAddressOf, getEvmBalance } from '../qorechain/get-evm-balance.ts';
import type { EvmBalance } from '../qorechain/get-evm-balance.ts';
import type { ReadOptions } from '../qorechain/read-client.ts';
import type { QueryRun } from './conversation.ts';
import { foldCommand } from './intent.ts';
import { DIANA_NETWORK, invokeTool } from './registry.ts';

/**
 * Native QOR balance queries on Diana testnet: recognizing the request and the read itself. It is
 * loaded on demand (a separate chunk in the web build), only for a command that mentions `qor1`
 * or when the registry's `get_balance` tool runs, so the main bundle stays small.
 *
 * It adds no new way to reach the network: `readBalance` runs only inside the tool registry, whose
 * guarded fetch allows just `eth_chainId` and `eth_getBalance` for this tool. The browser reads the
 * official Diana EVM JSON-RPC, the only Diana endpoint that allows cross-origin reads; see
 * `get-evm-balance.ts`. The Bech32 checksum check is the one in `get-balance.ts`, unchanged.
 */

// Anything that looks like a native address, valid or not. Bech32 has no "i", so the Turkish
// lower-casing of "I" cannot turn an invalid address into a valid one.
const addressLike = /(?<![0-9a-z])qor1[0-9a-z]*(?![0-9a-z])/giu;

// Every other word of a balance query must be one of these (folded: lower case, Turkish letters as
// ASCII, apostrophes dropped). Numbers, amounts, names, a second request, or any unknown word make
// the command fall through to the existing checks, which do not run anything for it.
const balanceWords: ReadonlySet<string> = new Set((
  // Turkish
  'bakiye bakiyesi bakiyesini bakiyeyi bakiyesinde qor qoru uqor '
  + 'adres adresi adresin adresinin adresinde adresindeki adreste adresteki '
  + 'in nin un nun bu su anki simdi simdiki guncel mevcut ne nedir kadar kac var '
  + 'goster gosterir gosterebilir gosterin sorgula sorgular sorgulayin ogren kontrol et '
  + 'getir soyle bak lutfen bana mi mu misin musun acaba peki ela '
  + 'diana dianada dianadaki testnet testnette testnetteki test agi aginda agindaki agda agdaki '
  + 'qorechain qorechainde qorechaindeki uzerinde uzerindeki icin '
  // English
  + 'balance balances of for at on the a show me get check what whats is how much does have has hold holds '
  + 'address network please tell display fetch read look up can could you current native query now'
).split(' '));

export type BalanceRequest =
  | { readonly kind: 'none' }
  | { readonly kind: 'balance'; readonly address: string }
  | { readonly kind: 'invalid_address' }
  /** A valid address that is not a 20-byte account (for example a 32-byte module address). */
  | { readonly kind: 'unsupported_address' }
  | { readonly kind: 'multiple_addresses' };

/**
 * Recognizes a Turkish or English request for the QOR balance of one `qor1` address, such as
 * "qor1… adresinin bakiyesini göster", "qor1… adresinde ne kadar QOR var?", "What is the balance
 * of qor1…?", or "How much QOR does qor1… have?". The address is validated with its Bech32
 * checksum and returned in lower case. Anything else returns `none`.
 */
export function recognizeBalanceRequest(command: unknown): BalanceRequest {
  if (typeof command !== 'string') return { kind: 'none' };
  const text = command.normalize('NFC');
  const addresses = text.match(addressLike) ?? [];
  if (addresses.length === 0) return { kind: 'none' };
  const words = foldCommand(text.replace(addressLike, ' ')).split(' ').filter(Boolean);
  const cue = words.some(w => w.startsWith('bakiye') || w.startsWith('balance'))
    || (words.includes('qor') && (words.includes('kadar') || words.includes('much')));
  if (!cue || !words.every(w => balanceWords.has(w))) return { kind: 'none' };
  const [address, ...others] = addresses;
  if (others.length > 0) return { kind: 'multiple_addresses' };
  let account: string;
  try {
    account = normalizeAddress(address!);
  } catch {
    return { kind: 'invalid_address' };
  }
  try {
    evmAddressOf(account);
  } catch {
    return { kind: 'unsupported_address' };
  }
  return { kind: 'balance', address: account };
}

/**
 * Reads the native QOR balance of one validated `qor1` address through the tool registry, with
 * fresh data on every call: eth_chainId (Diana, 9800) first, then eth_getBalance.
 */
export async function runBalanceQuery(address: string, options: Pick<ReadOptions, 'fetch' | 'timeoutMs'> = {}): Promise<QueryRun> {
  const result = await invokeTool({ tool: 'get_balance', network: DIANA_NETWORK, params: { address }, rpcMethods: ['eth_chainId', 'eth_getBalance'] }, options);
  return { kind: 'balance', address, result };
}

/** What the balance tool returns. */
export type BalanceReading = EvmBalance;

/**
 * Verifies the Diana EVM chain ID (9800) with `eth_chainId`, then reads the native QOR balance
 * with `eth_getBalance`, on the fixed Diana endpoint. Only `fetch` and `timeoutMs` are taken from
 * the caller. An invalid or non-account address is refused before any request is sent.
 */
export function readBalance(address: string, runtime: Pick<ReadOptions, 'fetch' | 'timeoutMs'>): Promise<BalanceReading> {
  return getEvmBalance(address, { fetch: runtime.fetch, timeoutMs: runtime.timeoutMs });
}
