import { getBalance, normalizeAddress } from '../qorechain/get-balance.ts';
import type { NativeBalance } from '../qorechain/get-balance.ts';
import { getBlockNumber } from '../qorechain/get-block-number.ts';
import type { ReadOptions } from '../qorechain/read-client.ts';
import { foldCommand } from './intent.ts';

/**
 * Native QOR balance queries on Diana testnet: recognizing the request and the read itself. It is
 * loaded on demand (a separate chunk in the web build), only for a command that mentions `qor1`
 * or when the registry's `get_balance` tool runs, so the main bundle stays small.
 *
 * It adds no new way to reach the network: `readBalance` runs only inside the tool registry, whose
 * guarded fetch allows just the two fixed Diana GETs below. The existing `get-balance.ts` module
 * performs the balance read and the Bech32 checksum check unchanged.
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
  try {
    return { kind: 'balance', address: normalizeAddress(address!) };
  } catch {
    return { kind: 'invalid_address' };
  }
}

/** What the balance tool returns: the chain the consensus RPC reported, and the native balance. */
export interface BalanceReading extends NativeBalance {
  readonly chainId: string;
}

/**
 * Verifies the Diana chain ID (`qorechain-diana`, not catching up) with the consensus RPC status,
 * then reads the native uqor balance from the Diana REST bank module. The endpoints are the fixed
 * Diana testnet ones; only `fetch` and `timeoutMs` are taken from the caller.
 */
export async function readBalance(address: string, runtime: Pick<ReadOptions, 'fetch' | 'timeoutMs'>): Promise<BalanceReading> {
  const read = { fetch: runtime.fetch, timeoutMs: runtime.timeoutMs };
  // An invalid address (checksum included) is refused before any request is sent.
  const account = normalizeAddress(address);
  const { chainId } = await getBlockNumber(read);
  const balance = await getBalance(account, read);
  return { chainId, ...balance };
}
