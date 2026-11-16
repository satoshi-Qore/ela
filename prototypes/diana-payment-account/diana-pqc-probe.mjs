import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { decodeFunctionResult, encodeFunctionData, parseAbi } from 'viem';
import { IQORE_PQC_ABI, PRECOMPILE_ADDRESSES } from '@qorechain/evm';
import { OFFICIAL_VECTOR } from '../../src/pqc/demo/official-vector.ts';

const endpoint = 'https://evm-testnet.qore.host/';
const missingKeyAccount = '0x0000000000000000000000000000000000000001';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const publicKey = Buffer.from(OFFICIAL_VECTOR.publicKey, 'hex');
const message = Buffer.from(OFFICIAL_VECTOR.message, 'hex');
const signature = Buffer.from(OFFICIAL_VECTOR.signature, 'hex');
// The installed SDK declares three outputs for key status. Diana and the Solidity
// contract use the documented four-output ABI. The input selector is unchanged.
const dianaPqcAbi = parseAbi([
  'function pqcKeyStatus(address account) view returns (bool registered, uint8 algorithmId, bytes pubkey, bool possessionProven)',
  'function pqcVerify(bytes pubkey, bytes signature, bytes message) view returns (bool valid)',
]);
const asHex = bytes => '0x' + bytes.toString('hex');
assert.equal(publicKey.length, 2592);
assert.equal(signature.length, 4627);

const evidence = {
  startedAtUtc: new Date().toISOString(),
  endpoint,
  sdkKeyStatusOutputCount: IQORE_PQC_ABI.find(item => item.name === 'pqcKeyStatus').outputs.length,
  vector: { source: OFFICIAL_VECTOR.source, publicKeySha256: sha256(publicKey),
    messageSha256: sha256(message), signatureSha256: sha256(signature) },
  calls: [],
};

function rpc(name, method, params) {
  assert.ok(['eth_chainId', 'eth_blockNumber', 'eth_call'].includes(method));
  const request = { jsonrpc: '2.0', id: evidence.calls.length + 1, method, params };
  const row = { name, request };
  evidence.calls.push(row);
  const result = spawnSync('curl.exe', [
    '--disable', '--silent', '--show-error', '--connect-timeout', '8', '--max-time', '25',
    '--proto', '=https', '--write-out', '\n%{http_code}',
    '--header', 'Content-Type: application/json', '--data-binary', '@-', endpoint,
  ], { input: JSON.stringify(request), encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  const stdout = result.stdout ?? '';
  const separator = stdout.lastIndexOf('\n');
  row.httpStatus = Number(stdout.slice(separator + 1));
  row.transportExit = result.status;
  if (result.stderr) row.transportError = result.stderr.trim();
  if (result.error) row.transportError = result.error.message;
  assert.equal(result.status, 0, name + ': transport failure');
  assert.equal(row.httpStatus, 200, name + ': HTTP failure');
  row.response = JSON.parse(stdout.slice(0, separator));
  assert.equal(row.response.jsonrpc, '2.0');
  assert.equal(row.response.id, request.id);
  return row;
}

function precompile(name, address, functionName, args, block) {
  const data = encodeFunctionData({ abi: dianaPqcAbi, functionName, args });
  const row = rpc(name, 'eth_call', [{ to: address, data }, block]);
  if (!row.response.error) {
    row.returnBytes = (row.response.result.length - 2) / 2;
    row.decoded = decodeFunctionResult({ abi: dianaPqcAbi, functionName, data: row.response.result });
  }
  return row;
}

try {
  const chain = rpc('diana_chain_id', 'eth_chainId', []);
  assert.equal(BigInt(chain.response.result), 9800n);
  const latest = rpc('block_snapshot', 'eth_blockNumber', []);
  const block = latest.response.result;
  evidence.block = { hex: block, decimal: BigInt(block).toString() };
  const key = precompile('unregistered_key', PRECOMPILE_ADDRESSES.pqcKeyStatus,
    'pqcKeyStatus', [missingKeyAccount], block);
  const changedMessage = Buffer.from(message);
  changedMessage[0] ^= 1;
  const changedSignature = Buffer.from(signature);
  changedSignature[0] ^= 1;
  const verify = (name, input, proof) => precompile(name, PRECOMPILE_ADDRESSES.pqcVerify,
    'pqcVerify', [asHex(publicKey), asHex(proof), asHex(input)], block);
  const valid = verify('public_vector_valid', message, signature);
  const badMessage = verify('changed_message', changedMessage, signature);
  const badSignature = verify('changed_signature', message, changedSignature);
  const shortSignature = verify('truncated_signature', message, signature.subarray(0, -1));
  assert.deepEqual(key.decoded, [false, 0, '0x', false]);
  assert.equal(key.returnBytes, 160);
  assert.equal(valid.decoded, true);
  assert.equal(valid.returnBytes, 32);
  assert.equal(badMessage.decoded, false);
  assert.equal(badSignature.decoded, false);
  assert.ok(shortSignature.response.error || shortSignature.decoded === false);
  evidence.probeResult = 'PASS';
} catch (error) {
  evidence.probeResult = 'BLOCKED';
  evidence.failure = error.message;
  process.exitCode = 1;
} finally {
  evidence.finishedAtUtc = new Date().toISOString();
  const file = new URL('./diana-pqc-probe-evidence.json', import.meta.url);
  writeFileSync(file, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ result: evidence.probeResult, block: evidence.block, failure: evidence.failure,
    calls: evidence.calls.map(({ name, httpStatus, decoded, returnBytes, response }) =>
      ({ name, httpStatus, decoded, returnBytes, error: response?.error })) }, null, 2));
}
