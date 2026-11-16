import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import { test } from 'node:test';
import { mldsa87 } from '@qorechain/pqc';
import { OFFICIAL_VECTOR } from '../../../src/pqc/demo/official-vector.ts';

// Public verification-only fixture. The original message is not an invoice digest.
const publicKey = Buffer.from(OFFICIAL_VECTOR.publicKey, 'hex');
const message = Buffer.from(OFFICIAL_VECTOR.message, 'hex');
const signature = Buffer.from(OFFICIAL_VECTOR.signature, 'hex');
const spkiPrefix = Buffer.from('30820a32300b060960864801650304031303820a2100', 'hex');
const opensslKey = createPublicKey({
  key: Buffer.concat([spkiPrefix, publicKey]),
  format: 'der',
  type: 'spki',
});

test('QoreChain PQC and OpenSSL verify the existing public ML-DSA-87 vector', () => {
  assert.equal(publicKey.length, 2592);
  assert.equal(signature.length, 4627);
  assert.equal(mldsa87.verify(publicKey, message, signature), true);
  assert.equal(verify(null, message, opensslKey, signature), true);
});

test('both verifiers reject a one-byte change in the message or signature', () => {
  const alteredMessage = Buffer.from(message);
  alteredMessage[0] ^= 1;
  const alteredSignature = Buffer.from(signature);
  alteredSignature[0] ^= 1;
  for (const [input, proof] of [[alteredMessage, signature], [message, alteredSignature]]) {
    assert.equal(mldsa87.verify(publicKey, input, proof), false);
    assert.equal(verify(null, input, opensslKey, proof), false);
  }
});
