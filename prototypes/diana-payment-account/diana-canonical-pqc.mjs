import { createHash, timingSafeEqual } from 'node:crypto';
import { deriveUnifiedAccount, derivePqcCanonical, qoreAddresses, validateRegisteredPqcKey } from '@qorechain/sdk';

const ML_DSA_87_PUBLIC_KEY_BYTES = 2592;

// Compares two byte arrays in place. No copy of a secret is made, so nothing is left to zero.
function sameBytes(a, b) {
  return a instanceof Uint8Array && b instanceof Uint8Array && a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Checks that a unified account's ML-DSA-87 key is the SDK's canonical, address-bound key
 * (`derivePqcCanonical(qor1, mnemonic)`) and that the chain would accept it for a hybrid
 * registration. Returns only public values: the algorithm id and the public key's SHA-256.
 * The recomputed secret key is zeroed before returning; the caller zeroes the account's own copy.
 * `deps.canonical` replaces the SDK derivation in tests only.
 */
export function canonicalPqcSummary(account, mnemonic, deps = {}) {
  const canonical = (deps.canonical ?? derivePqcCanonical)(account.cosmos, mnemonic);
  try {
    const publicKey = account.pqc.publicKey;
    if (!(publicKey instanceof Uint8Array) || publicKey.length !== ML_DSA_87_PUBLIC_KEY_BYTES) throw new Error('Unexpected PQC public key size');
    if (!sameBytes(publicKey, canonical.publicKey) || !sameBytes(account.pqc.secretKey, canonical.secretKey)) {
      throw new Error('PQC key is not the canonical address-bound key');
    }
    validateRegisteredPqcKey('hybrid', publicKey);
    return { algorithmId: 1, pqcPublicKeySha256: createHash('sha256').update(publicKey).digest('hex') };
  } finally {
    canonical.secretKey.fill(0);
  }
}

/**
 * Checks an existing recovery record against the account's known PUBLIC addresses, without
 * creating or changing anything. It accepts the original format (`mnemonic`, `password`,
 * `index`, `sdkVersion`) and the 7C-5 format with the extra public `pqc` field; the `pqc` field
 * is never required. Returns only public values and never logs or writes. Reading the record
 * from the vault is the caller's job, in the user's own session.
 *
 * Every derived secret byte array (the account's and the recomputed ML-DSA-87 secret keys) is
 * zeroed before this returns or throws. JavaScript strings (the mnemonic, the hex private key
 * the SDK returns) cannot be wiped; their references are dropped and the process should exit.
 * `deps.derive` / `deps.canonical` replace the SDK derivations in tests only.
 */
export async function verifyRecoveryRecord(record, expected, deps = {}) {
  if (record === null || typeof record !== 'object' || typeof record.mnemonic !== 'string') throw new Error('Unreadable recovery record');
  const index = record.index ?? 0;
  if (!Number.isInteger(index) || index < 0) throw new Error('Invalid derivation index');
  if (record.pqc !== undefined && (record.pqc === null || typeof record.pqc !== 'object')) throw new Error('Unreadable recovery record');
  const known = qoreAddresses({ evm: expected.evm });
  if (known.cosmos !== expected.native) throw new Error('Expected addresses do not belong to one account');
  let account = await (deps.derive ?? deriveUnifiedAccount)(record.mnemonic, index);
  try {
    if (account.cosmos !== expected.native || account.evm.toLowerCase() !== expected.evm.toLowerCase()) {
      throw new Error('Recovery record does not derive the expected account');
    }
    const summary = canonicalPqcSummary(account, record.mnemonic, deps);
    if (record.pqc !== undefined && record.pqc.pqcPublicKeySha256 !== summary.pqcPublicKeySha256) {
      throw new Error('Recorded PQC fingerprint does not match the derived key');
    }
    return { native: account.cosmos, evm: account.evm, index, ...summary };
  } finally {
    account.pqc.secretKey.fill(0);
    account = undefined;
  }
}

/** The only messages a verifier may show; anything else is reported as a generic failure. */
export const SAFE_FAILURES = Object.freeze([
  'Unreadable recovery record',
  'Invalid derivation index',
  'Expected addresses do not belong to one account',
  'Recovery record does not derive the expected account',
  'PQC key is not the canonical address-bound key',
  'Recorded PQC fingerprint does not match the derived key',
  'Unexpected PQC public key size',
]);
