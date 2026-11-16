import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { deriveUnifiedAccount, derivePqcCanonical, qoreAddresses } from '@qorechain/sdk';
import { CONFIRMATION, INVOICE_OWNER, RECORD_PATH, failureMessage, publicReport, verifyFromBytes } from '../diana-verify-recovery.mjs';

// Public BIP-39 test mnemonic (all-"abandon" vector). It is not an ELA account and holds nothing.
const PUBLIC_TEST_MNEMONIC = Array(11).fill('abandon').concat('about').join(' ');
const PASSWORD = 'public-test-password';
const recordBytes = (extra = {}) => Buffer.from(JSON.stringify({ mnemonic: PUBLIC_TEST_MNEMONIC, password: PASSWORD, index: 0, sdkVersion: '0.14.0', ...extra }));
const allZero = bytes => bytes.every(byte => byte === 0);
const scriptPath = fileURLToPath(new URL('../diana-verify-recovery.mjs', import.meta.url));
const source = readFileSync(scriptPath, 'utf8');

// Spies record every secret byte array the SDK hands out, so the test can check they end zeroed.
function spies() {
  const secrets = [];
  return {
    secrets,
    deps: {
      derive: async (mnemonic, index) => { const account = await deriveUnifiedAccount(mnemonic, index); secrets.push(account.pqc.secretKey); return account; },
      canonical: (account, mnemonic) => { const keypair = derivePqcCanonical(account, mnemonic); secrets.push(keypair.secretKey); return keypair; },
    },
  };
}

test('a matching record prints only public values, and every derived secret buffer ends zeroed', async () => {
  const account = await deriveUnifiedAccount(PUBLIC_TEST_MNEMONIC, 0);
  const expected = { native: account.cosmos, evm: account.evm };
  const bytes = recordBytes();
  const { secrets, deps } = spies();
  const report = publicReport('invoice-owner', await verifyFromBytes(bytes, expected, deps));
  assert.deepEqual(Object.keys(report).sort(), ['algorithmId', 'evm', 'index', 'native', 'pqcPublicKeySha256', 'role', 'status']);
  assert.equal(report.status, 'MATCH');
  const text = JSON.stringify(report);
  for (const secret of ['abandon', PASSWORD, account.privateKey.slice(2, 34), Buffer.from(account.pqc.secretKey).toString('hex').slice(0, 32)]) assert.equal(text.includes(secret), false);
  assert.ok(allZero(bytes), 'record bytes zeroed');
  assert.equal(secrets.length, 2);
  for (const secret of secrets) assert.ok(allZero(secret), 'derived PQC secret zeroed');
});

test('a record for another account is refused and its secrets are still zeroed', async () => {
  const bytes = recordBytes();
  const { secrets, deps } = spies();
  await assert.rejects(verifyFromBytes(bytes, INVOICE_OWNER, deps), /does not derive the expected account/);
  assert.ok(allZero(bytes));
  assert.equal(secrets.length, 1);
  assert.ok(allZero(secrets[0]));
});

test('unreadable input is refused with a fixed message and the bytes are zeroed', async () => {
  const account = await deriveUnifiedAccount(PUBLIC_TEST_MNEMONIC, 0);
  const expected = { native: account.cosmos, evm: account.evm };
  for (const bytes of [Buffer.from('{not json'), Buffer.alloc(0), Buffer.alloc(5000, 0x20), Buffer.from('null'), recordBytes({ pqc: null }), recordBytes({ index: -1 })]) {
    await assert.rejects(verifyFromBytes(bytes, expected), error => ['Unreadable recovery record', 'Invalid derivation index'].includes(error.message));
    assert.ok(allZero(bytes));
  }
});

test('failure messages never echo SDK errors or record contents', () => {
  assert.equal(failureMessage(new Error('Recovery record does not derive the expected account')), 'Recovery record does not derive the expected account');
  assert.equal(failureMessage(new Error('Invalid mnemonic: ' + PUBLIC_TEST_MNEMONIC)), 'Verification failed');
  assert.equal(failureMessage(new SyntaxError('Unexpected token in JSON at "' + PASSWORD + '"')), 'Verification failed');
  assert.equal(failureMessage(undefined), 'Verification failed');
});

test('redirected input is refused before the vault is touched, with no output', () => {
  const result = spawnSync(process.execPath, [scriptPath], { input: CONFIRMATION + '\n', encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^Diana Invoice Owner verification stopped: Interactive Windows terminal required\. Nothing was written\.\n$/);
});

test('the tool is read-only by construction and checks the terminal and confirmation first', () => {
  assert.equal(/writeFile|appendFile|createWriteStream|mkdir|rename|unlink|rmSync|copyFile|truncate|fetch\(|https?:\/\//.test(source), false);
  assert.equal(/console\.(log|error|info|warn|debug)/.test(source), false);
  assert.match(source, /openSync\(file, 'r'\)/);
  const main = source.slice(source.indexOf('async function main'));
  assert.ok(main.indexOf('isTTY') < main.indexOf('CONFIRMATION') && main.indexOf('CONFIRMATION') < main.indexOf('readRecordBytes(RECORD_PATH)'));
  // Exactly two writes to stdout: the fixed explanation text and the public report.
  const writes = [...source.matchAll(/stdout\.write\(/g)].map(match => source.slice(match.index, match.index + 80));
  assert.equal(writes.length, 2);
  assert.ok(writes[0].startsWith("stdout.write('Read-only check"));
  assert.ok(writes[1].startsWith('stdout.write(JSON.stringify(publicReport('));
  assert.equal(RECORD_PATH, 'E:\\ELA-PRIVATE-VAULT\\Diana-9800-accounts\\invoice-owner.recovery.json');
});

test('the expected Invoice Owner addresses are one account', () => {
  assert.equal(qoreAddresses({ evm: INVOICE_OWNER.evm }).cosmos, INVOICE_OWNER.native);
});
