import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { deriveUnifiedAccount, derivePqcCanonical, derivePqcLegacy, qoreAddresses } from '@qorechain/sdk';
import { canonicalPqcSummary, verifyRecoveryRecord } from '../diana-canonical-pqc.mjs';

// Public BIP-39 test mnemonic (all-"abandon" vector). It is not an ELA account and holds nothing.
const PUBLIC_TEST_MNEMONIC = Array(11).fill('abandon').concat('about').join(' ');
const hex = bytes => Buffer.from(bytes).toString('hex');

test('the unified account key is the canonical address-bound key and only public values are returned', async () => {
  const account = await deriveUnifiedAccount(PUBLIC_TEST_MNEMONIC, 0);
  const canonical = derivePqcCanonical(account.cosmos, PUBLIC_TEST_MNEMONIC);
  assert.equal(hex(account.pqc.publicKey), hex(canonical.publicKey));
  assert.equal(hex(derivePqcCanonical(account.evm, PUBLIC_TEST_MNEMONIC).publicKey), hex(canonical.publicKey));

  const summary = canonicalPqcSummary(account, PUBLIC_TEST_MNEMONIC);
  assert.deepEqual(Object.keys(summary).sort(), ['algorithmId', 'pqcPublicKeySha256']);
  assert.equal(summary.algorithmId, 1);
  assert.equal(summary.pqcPublicKeySha256, createHash('sha256').update(account.pqc.publicKey).digest('hex'));
  const text = JSON.stringify(summary);
  assert.equal(text.includes('abandon'), false);
  assert.equal(text.includes(hex(account.pqc.secretKey).slice(0, 32)), false);
  assert.equal(text.includes(account.privateKey.slice(2, 34)), false);
});

test('the helper zeroes only its own recomputed secret, not the caller copy', async () => {
  const account = await deriveUnifiedAccount(PUBLIC_TEST_MNEMONIC, 0);
  canonicalPqcSummary(account, PUBLIC_TEST_MNEMONIC);
  assert.ok(Buffer.from(account.pqc.secretKey).some(byte => byte !== 0));
});

test('legacy, foreign, and wrong-size keys are refused before anything is written', async () => {
  const account = await deriveUnifiedAccount(PUBLIC_TEST_MNEMONIC, 0);
  const other = await deriveUnifiedAccount(PUBLIC_TEST_MNEMONIC, 1);
  const legacy = derivePqcLegacy(PUBLIC_TEST_MNEMONIC);
  assert.throws(() => canonicalPqcSummary({ ...account, pqc: legacy }, PUBLIC_TEST_MNEMONIC), /not the canonical/);
  assert.throws(() => canonicalPqcSummary({ ...account, pqc: other.pqc }, PUBLIC_TEST_MNEMONIC), /not the canonical/);
  assert.throws(() => canonicalPqcSummary({ ...account, pqc: { ...account.pqc, secretKey: other.pqc.secretKey } }, PUBLIC_TEST_MNEMONIC), /not the canonical/);
  assert.throws(() => canonicalPqcSummary({ ...account, pqc: { ...account.pqc, publicKey: account.pqc.publicKey.slice(1) } }, PUBLIC_TEST_MNEMONIC), /size/);
});

test('the account generator checks the canonical key before writing and writes no separate PQC key file', () => {
  const source = readFileSync(new URL('../diana-create-accounts.mjs', import.meta.url), 'utf8');
  const check = source.indexOf('canonicalPqcSummary(account, mnemonic)');
  assert.ok(check > 0);
  assert.ok(check < source.indexOf("writeReservedFile(role, 'recovery'"));
  assert.ok(source.includes('account.pqc.secretKey.fill(0)'));
  assert.ok(source.includes('pqcPublicKeySha256: pqc.pqcPublicKeySha256'));
  assert.equal(/generatePqcKeypair|mldsa87|pqcSign\(/.test(source), false);
  assert.equal(/console\.log|stdout\.write\([^)]*(mnemonic|password|privateKey|secretKey)/.test(source), false);
});

// --- 7C-5B: existing recovery records ----------------------------------------------------------

const INVOICE_OWNER_PUBLIC = { native: 'qor1dfw567en2l0edze2xqzqw8kwnrcpt3u5m9n88r', evm: '0x6a5d4D7B3357df968b2A3004071eCe98f015C794' };

test('an original-format recovery record (no pqc field) is verified without regeneration', async () => {
  const account = await deriveUnifiedAccount(PUBLIC_TEST_MNEMONIC, 0);
  const record = { mnemonic: PUBLIC_TEST_MNEMONIC, password: 'public-test-password', index: 0, sdkVersion: '0.14.0' };
  const result = await verifyRecoveryRecord(record, { native: account.cosmos, evm: account.evm });
  assert.deepEqual(Object.keys(result).sort(), ['algorithmId', 'evm', 'index', 'native', 'pqcPublicKeySha256']);
  assert.equal(result.native, account.cosmos);
  assert.equal(result.pqcPublicKeySha256, createHash('sha256').update(account.pqc.publicKey).digest('hex'));
  const text = JSON.stringify(result);
  assert.equal(text.includes('abandon') || text.includes('public-test-password'), false);
  assert.deepEqual(Object.keys(record).sort(), ['index', 'mnemonic', 'password', 'sdkVersion'], 'the record is not modified');
});

test('a 7C-5 record with a matching fingerprint passes; a different fingerprint is refused', async () => {
  const account = await deriveUnifiedAccount(PUBLIC_TEST_MNEMONIC, 0);
  const expected = { native: account.cosmos, evm: account.evm };
  const { pqcPublicKeySha256 } = canonicalPqcSummary(account, PUBLIC_TEST_MNEMONIC);
  const base = { mnemonic: PUBLIC_TEST_MNEMONIC, password: 'x', index: 0, sdkVersion: '0.14.0' };
  await verifyRecoveryRecord({ ...base, pqc: { derivation: 'canonical', algorithmId: 1, pqcPublicKeySha256 } }, expected);
  await assert.rejects(verifyRecoveryRecord({ ...base, pqc: { derivation: 'canonical', algorithmId: 1, pqcPublicKeySha256: '0'.repeat(64) } }, expected), /fingerprint/);
});

test('a record that does not derive the expected public account is refused', async () => {
  const record = { mnemonic: PUBLIC_TEST_MNEMONIC, password: 'x', index: 0, sdkVersion: '0.14.0' };
  await assert.rejects(verifyRecoveryRecord(record, INVOICE_OWNER_PUBLIC), /does not derive the expected account/);
  const account = await deriveUnifiedAccount(PUBLIC_TEST_MNEMONIC, 0);
  await assert.rejects(verifyRecoveryRecord({ ...record, index: 1 }, { native: account.cosmos, evm: account.evm }), /does not derive/);
  await assert.rejects(verifyRecoveryRecord(record, { native: account.cosmos, evm: INVOICE_OWNER_PUBLIC.evm }), /one account/);
  for (const bad of [null, {}, { mnemonic: 42 }, { ...record, index: -1 }, { ...record, index: 0.5 }]) {
    await assert.rejects(verifyRecoveryRecord(bad, { native: account.cosmos, evm: account.evm }));
  }
});

test('the known Invoice Owner public addresses are one valid account', () => {
  assert.equal(qoreAddresses({ evm: INVOICE_OWNER_PUBLIC.evm }).cosmos, INVOICE_OWNER_PUBLIC.native);
});
