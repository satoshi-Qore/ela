import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { buildRegisterPqcKeyMsg, proofOfPossessionSignBytes, pqcVerify, qoreAddresses } from '@qorechain/sdk';
import { OFFICIAL_VECTOR } from '../../../src/pqc/demo/official-vector.ts';
import { NATIVE_CHAIN, promptForInvoiceOwner, validateInvoiceOwner } from '../diana-invoice-pqc.mjs';

const evm = '0x' + '11'.repeat(20);
const native = qoreAddresses({ evm }).cosmos;
const publicKey = Buffer.from(OFFICIAL_VECTOR.publicKey, 'hex');

test('accepts matching public addresses and rejects a mismatch', () => {
  assert.equal(validateInvoiceOwner(native, evm).native, native);
  assert.throws(() => validateInvoiceOwner(native, '0x' + '22'.repeat(20)));
  assert.throws(() => validateInvoiceOwner('qor1invalid', evm));
});

test('SDK verifies the published vector and rejects a changed message', () => {
  const message = Buffer.from(OFFICIAL_VECTOR.message, 'hex');
  const signature = Buffer.from(OFFICIAL_VECTOR.signature, 'hex');
  assert.equal(pqcVerify(publicKey, message, signature), true);
  message[0] ^= 1;
  assert.equal(pqcVerify(publicKey, message, signature), false);
});

test('SDK binds unsigned PoP bytes to Diana Native chain, address and key', () => {
  const bytes = proofOfPossessionSignBytes({ chainId: NATIVE_CHAIN, account: native, publicKey, algorithmId: 1 });
  assert.equal(Buffer.from(bytes).toString('utf8'),
    'qorechain-pqc-pop-v1|qorechain-diana|1|' + native + '|' + publicKey.toString('hex'));
  // Public-only builder fixture. No proof is produced and no signer is instantiated.
  const msg = buildRegisterPqcKeyMsg(native, { pqcKeypair: { publicKey }, keyType: 'hybrid' });
  assert.equal(msg.typeUrl, '/qorechain.pqc.v1.MsgRegisterPQCKeyV2');
  assert.equal(msg.value.sender, native);
  assert.equal(msg.value.algorithmId, 1);
  assert.equal(msg.value.keyType, 'hybrid');
  assert.equal(msg.value.proofOfPossession.length, 0);
});

test('production generator rejects redirected input before accessing the vault', () => {
  const script = fileURLToPath(new URL('../diana-create-invoice-pqc.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script], { input: native + '\n' + evm + '\n', encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^Diana Invoice Owner PQC preparation stopped\./);
});


test('both address prompts and approval wait for separate responses', { timeout: 2000 }, async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let screen = '';
  output.on('data', (chunk) => { screen += chunk; });
  let completed = false;
  const session = promptForInvoiceOwner(input, output).then((result) => {
    completed = true;
    return result;
  });

  assert.match(screen, /Native address/);
  await setImmediate();
  assert.doesNotMatch(screen, /EVM address/);

  input.write(native + '\r\n');
  await setImmediate();
  assert.match(screen, /EVM address/);
  assert.doesNotMatch(screen, /GENERATE DIANA INVOICE PQC/);

  input.write(evm + '\r\n');
  await setImmediate();
  assert.match(screen, /Type GENERATE DIANA INVOICE PQC/);
  assert.equal(completed, false);

  input.write('GENERATE DIANA INVOICE PQC\r\n');
  const result = await session;
  assert.equal(result.owner.native, native);
  assert.equal(result.owner.evm, evm);
  assert.equal(result.approval, 'GENERATE DIANA INVOICE PQC');
  input.end();
  output.end();
});

test('missing or incorrect approval stops input', { timeout: 2000 }, async () => {
  for (const [response, message] of [
    ['', /Input ended before confirmation/],
    ['NO\r\n', /Generation approval was not entered/],
  ]) {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();
    const session = promptForInvoiceOwner(input, output);
    input.end(native + '\r\n' + evm + '\r\n' + response);
    await assert.rejects(session, message);
    output.end();
  }
});
