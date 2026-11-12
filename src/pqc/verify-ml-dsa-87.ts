import { mldsa87 } from '@qorechain/pqc';

/**
 * Verification-only ML-DSA-87 (FIPS 204, pure mode, empty context) check over a raw message, using
 * QoreChain's official `@qorechain/pqc` binding. It never signs, never creates or accepts a secret
 * key, and never touches the network. It verifies a raw message only: QoreChain hybrid transaction
 * sign-bytes and registered on-chain keys are out of scope.
 *
 * Inputs are byte arrays or hexadecimal text (no prefix, no spaces). Malformed, missing, wrong-size,
 * or oversized input is refused with a reason; the function never throws.
 */

export const ML_DSA_87_PUBLIC_KEY_BYTES = 2592;
export const ML_DSA_87_SIGNATURE_BYTES = 4627;
/** Largest message accepted, in bytes. Larger input is refused before any decoding or hashing. */
export const MAX_MESSAGE_BYTES = 65_536;

export type VerificationFailure =
  | 'invalid_input' // not a plain object with exactly publicKey, message, signature
  | 'invalid_encoding' // a field is neither a Uint8Array nor even-length hexadecimal text
  | 'invalid_public_key_length'
  | 'invalid_signature_length'
  | 'message_too_large'
  | 'signature_mismatch' // well-formed input, but the signature does not verify
  | 'verification_error'; // the verifier failed unexpectedly; treated as not verified

export type VerificationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: VerificationFailure };

export interface MlDsa87VerificationInput {
  readonly publicKey: Uint8Array | string;
  readonly message: Uint8Array | string;
  readonly signature: Uint8Array | string;
}

const VALID: VerificationResult = Object.freeze({ valid: true });
const failures = new Map<VerificationFailure, VerificationResult>();
function fail(reason: VerificationFailure): VerificationResult {
  let result = failures.get(reason);
  if (!result) {
    result = Object.freeze({ valid: false, reason });
    failures.set(reason, result);
  }
  return result;
}

const FIELDS = ['message', 'publicKey', 'signature'];
const HEX = /^(?:[0-9a-fA-F]{2})*$/;

/** Copies bytes or decodes hex text. Undefined for any other type or malformed text. */
function toBytes(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  if (typeof value !== 'string' || !HEX.test(value)) return undefined;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index++) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

/** Byte length of a field before decoding, so oversized text is refused without being parsed. */
function sizeOf(value: unknown): number | undefined {
  if (value instanceof Uint8Array) return value.byteLength;
  return typeof value === 'string' ? Math.ceil(value.length / 2) : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function check(input: unknown): VerificationResult {
  if (!isPlainObject(input)) return fail('invalid_input');
  const keys = Reflect.ownKeys(input);
  if (keys.length !== FIELDS.length || !keys.every(key => typeof key === 'string' && FIELDS.includes(key))) return fail('invalid_input');
  // Each field is read exactly once.
  const { publicKey: rawKey, message: rawMessage, signature: rawSignature } = input;

  const keySize = sizeOf(rawKey);
  const messageSize = sizeOf(rawMessage);
  const signatureSize = sizeOf(rawSignature);
  if (keySize === undefined || messageSize === undefined || signatureSize === undefined) return fail('invalid_encoding');
  if (messageSize > MAX_MESSAGE_BYTES) return fail('message_too_large');
  if (keySize > ML_DSA_87_PUBLIC_KEY_BYTES) return fail('invalid_public_key_length');
  if (signatureSize > ML_DSA_87_SIGNATURE_BYTES) return fail('invalid_signature_length');

  const publicKey = toBytes(rawKey);
  const message = toBytes(rawMessage);
  const signature = toBytes(rawSignature);
  if (!publicKey || !message || !signature) return fail('invalid_encoding');
  if (publicKey.length !== ML_DSA_87_PUBLIC_KEY_BYTES) return fail('invalid_public_key_length');
  if (signature.length !== ML_DSA_87_SIGNATURE_BYTES) return fail('invalid_signature_length');

  return mldsa87.verify(publicKey, message, signature) === true ? VALID : fail('signature_mismatch');
}

/** Verifies one ML-DSA-87 signature. Returns `{ valid: true }` or `{ valid: false, reason }`. */
export function verifyMlDsa87(input: unknown): VerificationResult {
  try {
    return check(input);
  } catch {
    return fail('verification_error');
  }
}
