import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { makeKeystore } from './diana-keystore.mjs';

// Public fixture from ethereum.org, Web3 Secret Storage Definition, PBKDF2-SHA-256.
test('matches the published Ethereum address and V3 keystore', () => {
  const fixture = Buffer.from('7a28b5ba57c53603b0b07b56bba752f7784bf506fa95edc395f5cf6c7514fe9d', 'hex');
  assert.deepEqual(makeKeystore(fixture, 'testpassword', {
    salt: Buffer.from('ae3cd4e7013836a3df6bd7241b12db061dbe2c6785853cce422d148a624ce0bd', 'hex'),
    iv: Buffer.from('6087dab2f9fdbbfaddc31a909735c1e6', 'hex'),
    id: '3198bc9c-6672-5ab3-d995-4942343ae5b6',
    iterations: 262144,
  }), {
    address: '008aeeda4d805471df9b2a5b0f38a0c3bcba786b',
    version: 3,
    id: '3198bc9c-6672-5ab3-d995-4942343ae5b6',
    crypto: {
      cipher: 'aes-128-ctr',
      cipherparams: { iv: '6087dab2f9fdbbfaddc31a909735c1e6' },
      ciphertext: '5318b4d5bcd28de64ee5559e671353e16f075ecae9f99c7a79a38af5f869aa46',
      kdf: 'pbkdf2',
      kdfparams: {
        c: 262144, dklen: 32, prf: 'hmac-sha256',
        salt: 'ae3cd4e7013836a3df6bd7241b12db061dbe2c6785853cce422d148a624ce0bd',
      },
      mac: '517ead924a9d0dc3124507e3393d175ce3ff7c1e96529c6c555ce9e51205e9b2',
    },
  });
});

test('rejects redirected input and prints no account data', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./diana-create-accounts.mjs', import.meta.url))], {
    input: 'GENERATE DIANA TEST ACCOUNTS\n', encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^Diana account creation stopped\./);
});
