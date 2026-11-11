import { endpoint, isRecord, QORECHAIN_TESTNET, QoreChainReadError, readJson } from './read-client.ts';
import type { ReadOptions } from './read-client.ts';

export interface BalanceOptions extends ReadOptions {
  restUrl?: string;
}

export interface NativeBalance {
  address: string;
  denom: 'uqor';
  amountUqor: string;
  amountQor: string;
}

const alphabet = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function normalizeAddress(address: string): string {
  const lower = address.toLowerCase();
  if (!/^qor1[a-z0-9]+$/.test(lower) || (address !== lower && address !== address.toUpperCase())) {
    throw new QoreChainReadError('invalid_address', 'Expected a native QoreChain Bech32 address.');
  }

  const words = [...lower.slice(4)].map(char => alphabet.indexOf(char));
  const payloadLength = words.length - 6;
  const padding = (payloadLength * 5) % 8;
  if ((payloadLength !== 32 && payloadLength !== 52) || words.includes(-1)
    || (words[payloadLength - 1] & ((1 << padding) - 1)) !== 0) {
    throw new QoreChainReadError('invalid_address', 'Invalid QoreChain Bech32 address payload.');
  }

  // Expand the "qor" prefix and validate the original Bech32 checksum (BIP 173).
  const prefix = [...'qor'].map(char => char.charCodeAt(0));
  const values = [...prefix.map(char => char >> 5), 0, ...prefix.map(char => char & 31), ...words];
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (const [index, generator] of generators.entries()) {
      if ((top >>> index) & 1) checksum ^= generator;
    }
  }
  if (checksum !== 1) {
    throw new QoreChainReadError('invalid_address', 'Invalid QoreChain Bech32 checksum.');
  }
  return lower;
}

export async function getBalance(address: string, options: BalanceOptions = {}): Promise<NativeBalance> {
  const account = normalizeAddress(address);
  const { denom, decimals } = QORECHAIN_TESTNET;
  const url = endpoint(options.restUrl ?? QORECHAIN_TESTNET.restUrl, 'cosmos/bank/v1beta1/balances/' + account + '/by_denom');
  url.searchParams.set('denom', denom);
  const body = await readJson(url, options);
  if (!isRecord(body) || !isRecord(body.balance) || body.balance.denom !== denom
    || typeof body.balance.amount !== 'string' || !/^(?:0|[1-9]\d*)$/.test(body.balance.amount)) {
    throw new QoreChainReadError('invalid_response', 'Invalid native QOR balance response.');
  }

  const amountUqor = body.balance.amount;
  const padded = amountUqor.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  return { address: account, denom, amountUqor, amountQor: fraction ? whole + '.' + fraction : whole };
}
