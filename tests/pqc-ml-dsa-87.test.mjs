import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, createPublicKey, generateKeyPairSync, sign as opensslSign, verify as opensslVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  MAX_MESSAGE_BYTES,
  ML_DSA_87_PUBLIC_KEY_BYTES,
  ML_DSA_87_SIGNATURE_BYTES,
  verifyMlDsa87,
} from '../src/pqc/verify-ml-dsa-87.ts';
import * as verifierModule from '../src/pqc/verify-ml-dsa-87.ts';

// --- Pinned official vectors (qorechain-pqc v0.2.3, see tests/vectors/qorechain-pqc/SOURCE.md) ---

const VECTOR_URL = new URL('./vectors/qorechain-pqc/ml-dsa-87.json', import.meta.url);
const VECTOR_SHA256 = 'af3a976590100366b8a78bc1d26d1fd23085b3638a7f20e1ac402a43e110cae8';
const vectorBytes = readFileSync(VECTOR_URL);
const vectorFile = JSON.parse(vectorBytes.toString('utf8'));
const hex = text => Uint8Array.from(Buffer.from(text, 'hex'));
// Only the public parts are used. The file's seed and secretKey test values are never read.
const cases = vectorFile.cases.map(({ publicKey, message, signature }) => ({ publicKey: hex(publicKey), message: hex(message), signature: hex(signature) }));

const VALID = { valid: true };
const failed = reason => ({ valid: false, reason });
const flip = (bytes, index, mask = 0x01) => {
  const copy = Uint8Array.from(bytes);
  copy[index] ^= mask;
  return copy;
};

// --- Independent source: Node.js crypto (OpenSSL) ML-DSA-87 ---

const SPKI_PREFIX = Buffer.from('30820a32300b060960864801650304031303820a2100', 'hex'); // id-ml-dsa-87 SubjectPublicKeyInfo
const opensslKey = publicKey => createPublicKey({ key: Buffer.concat([SPKI_PREFIX, publicKey]), format: 'der', type: 'spki' });
const opensslAccepts = ({ publicKey, message, signature }) => {
  try {
    return opensslVerify(null, message, opensslKey(publicKey), signature);
  } catch {
    return false;
  }
};

test('pinned vector file is byte-identical to qorechain-pqc v0.2.3', () => {
  assert.equal(createHash('sha256').update(vectorBytes).digest('hex'), VECTOR_SHA256);
  assert.equal(vectorFile.algorithm, 'ml-dsa-87');
  assert.equal(vectorFile.fips, 'FIPS-204');
  assert.deepEqual(vectorFile.sizes, { publicKey: ML_DSA_87_PUBLIC_KEY_BYTES, signature: ML_DSA_87_SIGNATURE_BYTES });
  assert.equal(cases.length, 5);
  for (const item of cases) {
    assert.equal(item.publicKey.length, ML_DSA_87_PUBLIC_KEY_BYTES);
    assert.equal(item.signature.length, ML_DSA_87_SIGNATURE_BYTES);
  }
});

test('Node.js provides an independent ML-DSA-87 implementation (OpenSSL)', () => {
  const { publicKey } = generateKeyPairSync('ml-dsa-87');
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  assert.deepEqual(spki.subarray(0, SPKI_PREFIX.length), SPKI_PREFIX);
  assert.equal(spki.length, SPKI_PREFIX.length + ML_DSA_87_PUBLIC_KEY_BYTES);
});

cases.forEach((item, index) => {
  test(`vector ${index}: valid as bytes, lower-case hex, and upper-case hex`, () => {
    assert.deepEqual(verifyMlDsa87(item), VALID);
    const text = { publicKey: Buffer.from(item.publicKey).toString('hex'), message: Buffer.from(item.message).toString('hex'), signature: Buffer.from(item.signature).toString('hex') };
    assert.deepEqual(verifyMlDsa87(text), VALID);
    assert.deepEqual(verifyMlDsa87({ publicKey: text.publicKey.toUpperCase(), message: text.message.toUpperCase(), signature: text.signature.toUpperCase() }), VALID);
    assert.deepEqual(verifyMlDsa87({ ...item, message: Buffer.from(item.message) }), VALID, 'Buffer is a Uint8Array');
  });

  test(`vector ${index}: independent OpenSSL verification agrees`, () => {
    assert.equal(opensslAccepts(item), true);
  });

  test(`vector ${index}: altered message, signature, or public key is rejected`, () => {
    const last = array => array.length - 1;
    for (const position of [0, item.message.length >> 1, last(item.message)]) {
      for (const mask of [0x01, 0x80]) {
        const altered = { ...item, message: flip(item.message, position, mask) };
        assert.deepEqual(verifyMlDsa87(altered), failed('signature_mismatch'), 'message byte ' + position);
        assert.equal(opensslAccepts(altered), false);
      }
    }
    for (const position of [0, 1, 1000, item.signature.length >> 1, last(item.signature) - 1, last(item.signature)]) {
      const altered = { ...item, signature: flip(item.signature, position) };
      assert.deepEqual(verifyMlDsa87(altered), failed('signature_mismatch'), 'signature byte ' + position);
      assert.equal(opensslAccepts(altered), false);
    }
    for (const position of [0, 31, 32, item.publicKey.length >> 1, last(item.publicKey)]) {
      const altered = { ...item, publicKey: flip(item.publicKey, position) };
      assert.deepEqual(verifyMlDsa87(altered), failed('signature_mismatch'), 'public key byte ' + position);
      assert.equal(opensslAccepts(altered), false);
    }
    const extended = { ...item, message: Uint8Array.from([...item.message, 0]) };
    assert.deepEqual(verifyMlDsa87(extended), failed('signature_mismatch'));
    const truncated = { ...item, message: item.message.subarray(0, last(item.message)) };
    assert.deepEqual(verifyMlDsa87(truncated), failed('signature_mismatch'));
    assert.deepEqual(verifyMlDsa87({ ...item, message: new Uint8Array(0) }), failed('signature_mismatch'));
    assert.deepEqual(verifyMlDsa87({ ...item, signature: new Uint8Array(ML_DSA_87_SIGNATURE_BYTES) }), failed('signature_mismatch'));
  });
});

test('a signature never verifies under another vector key or for another vector message', () => {
  for (let i = 0; i < cases.length; i++) {
    for (let j = 0; j < cases.length; j++) {
      if (i === j) continue;
      assert.deepEqual(verifyMlDsa87({ ...cases[i], publicKey: cases[j].publicKey }), failed('signature_mismatch'), `key ${j} / signature ${i}`);
      assert.equal(opensslAccepts({ ...cases[i], publicKey: cases[j].publicKey }), false);
      if (Buffer.compare(cases[i].message, cases[j].message) !== 0) {
        assert.deepEqual(verifyMlDsa87({ ...cases[i], message: cases[j].message }), failed('signature_mismatch'));
      }
    }
  }
});

test('signatures made by OpenSSL verify with the module, and altered ones do not', () => {
  for (const size of [0, 1, 32, 1000, MAX_MESSAGE_BYTES]) {
    const { publicKey, privateKey } = generateKeyPairSync('ml-dsa-87');
    const rawKey = publicKey.export({ format: 'der', type: 'spki' }).subarray(SPKI_PREFIX.length);
    const message = Uint8Array.from({ length: size }, (_, index) => (index * 31 + size) & 0xff);
    const signature = opensslSign(null, message, privateKey);
    const item = { publicKey: Uint8Array.from(rawKey), message, signature: Uint8Array.from(signature) };
    assert.deepEqual(verifyMlDsa87(item), VALID, 'size ' + size);
    assert.deepEqual(verifyMlDsa87({ ...item, signature: flip(item.signature, 7) }), failed('signature_mismatch'));
    if (size > 0) assert.deepEqual(verifyMlDsa87({ ...item, message: flip(message, size - 1) }), failed('signature_mismatch'));
  }
});

test('wrong public key and signature lengths are refused', () => {
  const [item] = cases;
  for (const length of [0, 1, 1312, 1952, ML_DSA_87_PUBLIC_KEY_BYTES - 1]) {
    assert.deepEqual(verifyMlDsa87({ ...item, publicKey: item.publicKey.subarray(0, length) }), failed('invalid_public_key_length'), 'key ' + length);
  }
  assert.deepEqual(verifyMlDsa87({ ...item, publicKey: Uint8Array.from([...item.publicKey, 0]) }), failed('invalid_public_key_length'));
  for (const length of [0, 1, 2420, 3309, ML_DSA_87_SIGNATURE_BYTES - 1]) {
    assert.deepEqual(verifyMlDsa87({ ...item, signature: item.signature.subarray(0, length) }), failed('invalid_signature_length'), 'signature ' + length);
  }
  assert.deepEqual(verifyMlDsa87({ ...item, signature: Uint8Array.from([...item.signature, 0]) }), failed('invalid_signature_length'));
  const keyHex = Buffer.from(item.publicKey).toString('hex');
  assert.deepEqual(verifyMlDsa87({ ...item, publicKey: keyHex.slice(0, -2) }), failed('invalid_public_key_length'));
  assert.deepEqual(verifyMlDsa87({ ...item, publicKey: keyHex + '00' }), failed('invalid_public_key_length'));
});

test('malformed encodings are refused', () => {
  const [item] = cases;
  const keyHex = Buffer.from(item.publicKey).toString('hex');
  const signatureHex = Buffer.from(item.signature).toString('hex');
  const messageHex = Buffer.from(item.message).toString('hex');
  const encodings = [
    { publicKey: keyHex.slice(0, -1) }, // odd length
    { publicKey: '0x' + keyHex.slice(2) },
    { publicKey: 'zz' + keyHex.slice(2) },
    { publicKey: keyHex.slice(0, -2) + ' 0' },
    { publicKey: Buffer.from(item.publicKey).toString('base64') },
    { signature: signatureHex.slice(0, -2) + 'g0' },
    { signature: '٠' + signatureHex.slice(1) }, // non-ASCII digit
    { message: messageHex + '0' },
    { message: 'hello' },
    { message: messageHex.slice(0, 4) + '\n' + messageHex.slice(4) },
    { message: 42 },
    { publicKey: Array.from(item.publicKey) },
    { publicKey: item.publicKey.buffer },
    { signature: new Uint16Array(item.signature.buffer, item.signature.byteOffset, 4) },
    { signature: new DataView(item.signature.buffer) },
    { message: null },
    { message: undefined },
    { message: { length: 3 } },
  ];
  for (const change of encodings) {
    const result = verifyMlDsa87({ ...item, ...change });
    assert.deepEqual(result, failed('invalid_encoding'), JSON.stringify(Object.keys(change)) + ' ' + String(Object.values(change)[0]).slice(0, 12));
  }
});

test('missing, extra, and non-object inputs are refused', () => {
  const [item] = cases;
  for (const input of [undefined, null, 0, 'text', true, [], [item.publicKey, item.message, item.signature], new Map(Object.entries(item)), new Uint8Array(4)]) {
    assert.deepEqual(verifyMlDsa87(input), failed('invalid_input'));
  }
  assert.deepEqual(verifyMlDsa87(), failed('invalid_input'));
  for (const field of ['publicKey', 'message', 'signature']) {
    const partial = { ...item };
    delete partial[field];
    assert.deepEqual(verifyMlDsa87(partial), failed('invalid_input'), 'missing ' + field);
  }
  assert.deepEqual(verifyMlDsa87({ ...item, secretKey: new Uint8Array(32) }), failed('invalid_input'));
  assert.deepEqual(verifyMlDsa87({ ...item, seed: new Uint8Array(32) }), failed('invalid_input'));
  assert.deepEqual(verifyMlDsa87({ ...item, [Symbol('extra')]: 1 }), failed('invalid_input'));
  class Input { constructor() { Object.assign(this, item); } }
  assert.deepEqual(verifyMlDsa87(new Input()), failed('invalid_input'));
  assert.deepEqual(verifyMlDsa87(Object.assign(Object.create(null), item)), VALID);
});

test('oversized input is refused before decoding', () => {
  const [item] = cases;
  assert.deepEqual(verifyMlDsa87({ ...item, message: new Uint8Array(MAX_MESSAGE_BYTES + 1) }), failed('message_too_large'));
  const huge = 'a'.repeat(20_000_000);
  const started = performance.now();
  assert.deepEqual(verifyMlDsa87({ ...item, message: huge }), failed('message_too_large'));
  assert.deepEqual(verifyMlDsa87({ ...item, publicKey: huge }), failed('invalid_public_key_length'));
  assert.deepEqual(verifyMlDsa87({ ...item, signature: huge }), failed('invalid_signature_length'));
  assert.deepEqual(verifyMlDsa87({ ...item, signature: new Uint8Array(1 << 20) }), failed('invalid_signature_length'));
  assert.ok(performance.now() - started < 500, 'oversized text is not parsed');
  assert.deepEqual(verifyMlDsa87({ ...item, message: new Uint8Array(MAX_MESSAGE_BYTES) }), failed('signature_mismatch'), 'the limit itself is accepted');
});

test('the verifier never throws, never mutates input, and returns frozen results', () => {
  const [item] = cases;
  const before = [Uint8Array.from(item.publicKey), Uint8Array.from(item.message), Uint8Array.from(item.signature)];
  verifyMlDsa87(item);
  verifyMlDsa87({ ...item, message: flip(item.message, 0) });
  assert.deepEqual([item.publicKey, item.message, item.signature], before);

  const throwing = { ...item };
  Object.defineProperty(throwing, 'message', { enumerable: true, get() { throw new Error('boom'); } });
  assert.deepEqual(verifyMlDsa87(throwing), failed('verification_error'));
  const proxy = new Proxy({}, { ownKeys() { throw new Error('boom'); } });
  assert.deepEqual(verifyMlDsa87(proxy), failed('verification_error'));

  let reads = 0;
  const counting = { publicKey: item.publicKey, signature: item.signature };
  Object.defineProperty(counting, 'message', { enumerable: true, get() { reads++; return reads === 1 ? item.message : flip(item.message, 0); } });
  assert.deepEqual(verifyMlDsa87(counting), VALID);
  assert.equal(reads, 1, 'each field is read once');

  for (const result of [verifyMlDsa87(item), verifyMlDsa87(null), verifyMlDsa87({ ...item, message: flip(item.message, 0) })]) {
    assert.ok(Object.isFrozen(result));
    assert.ok(result.valid === true || typeof result.reason === 'string');
  }

  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
  const values = [undefined, null, 0, -1, NaN, '', '00', 'zz', {}, [], new Uint8Array(0), new Uint8Array(2592), new Uint8Array(4627), item.publicKey, item.signature, item.message, Symbol('s'), () => 1, 10n];
  for (let round = 0; round < 500; round++) {
    const input = { publicKey: values[random() % values.length], message: values[random() % values.length], signature: values[random() % values.length] };
    const result = verifyMlDsa87(input);
    assert.ok(result.valid === false || (input.publicKey === item.publicKey && input.signature === item.signature && input.message === item.message));
  }
});

test('the verifier makes no network request', () => {
  const original = { fetch: globalThis.fetch, XMLHttpRequest: globalThis.XMLHttpRequest, WebSocket: globalThis.WebSocket };
  let calls = 0;
  const trap = () => { calls++; throw new Error('network access'); };
  globalThis.fetch = trap;
  globalThis.XMLHttpRequest = trap;
  globalThis.WebSocket = trap;
  try {
    for (const item of cases) assert.deepEqual(verifyMlDsa87(item), VALID);
    assert.deepEqual(verifyMlDsa87({ ...cases[0], message: flip(cases[0].message, 0) }), failed('signature_mismatch'));
  } finally {
    Object.assign(globalThis, original);
  }
  assert.equal(calls, 0);
});

test('the module is verification-only and isolated from the agent and the interface', () => {
  assert.deepEqual(Object.keys(verifierModule).sort(), ['MAX_MESSAGE_BYTES', 'ML_DSA_87_PUBLIC_KEY_BYTES', 'ML_DSA_87_SIGNATURE_BYTES', 'verifyMlDsa87']);
  const source = readFileSync(new URL('../src/pqc/verify-ml-dsa-87.ts', import.meta.url), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.deepEqual([...code.matchAll(/from\s+'([^']+)'/g)].map(match => match[1]), ['@qorechain/pqc']);
  assert.deepEqual([...code.matchAll(/mldsa87\.(\w+)/g)].map(match => match[1]), ['verify']);
  for (const forbidden of ['fetch', 'XMLHttpRequest', 'WebSocket', 'import(', 'keygen', 'secretKey', 'privateKey', '.sign(', 'localStorage', 'indexedDB']) {
    assert.equal(code.includes(forbidden), false, forbidden);
  }
  for (const file of ['web.ts', 'router.ts', 'agent/registry.ts', 'agent/planner.ts', 'agent/conversation.ts', 'agent/executor.ts', 'agent/intent.ts', 'agent/lexicon.ts']) {
    const text = readFileSync(new URL('../src/' + file, import.meta.url), 'utf8');
    assert.equal(/pqc|ml-?dsa|verifyMlDsa87/i.test(text), false, file);
  }
});
