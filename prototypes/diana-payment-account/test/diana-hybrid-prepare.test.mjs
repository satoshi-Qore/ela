import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as sdk from '@qorechain/sdk';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { SignDoc, TxBody, TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import {
  CheckError, FORMAT_FAILURES, PLAN, PREPARE_FAILURES, failureMessage, feeFor, guardedFetch, hybridFormatFailures,
  placeholderSimulationTx, prepareFailures, prepareHybridSelfSend, unsignedHybridParts,
} from '../diana-hybrid-prepare.mjs';

// Public BIP-39 test mnemonic (all-"abandon" vector). It is not an ELA account and holds nothing.
const PUBLIC_TEST_MNEMONIC = Array(11).fill('abandon').concat('about').join(' ');
const account = await sdk.deriveUnifiedAccount(PUBLIC_TEST_MNEMONIC, 0);
const other = await sdk.deriveUnifiedAccount(PUBLIC_TEST_MNEMONIC, 1);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
// The same plan shape as the real one, for the public test account.
const TEST_PLAN = Object.freeze({ ...PLAN, native: account.cosmos, evm: account.evm, pqcPublicKeySha256: sha(account.pqc.publicKey) });
const { rest: REST, evmRpc: EVM_RPC } = sdk.NETWORKS.testnet.endpoints;
const registry = sdk.qorechainRegistry();
const source = readFileSync(fileURLToPath(new URL('../diana-hybrid-prepare.mjs', import.meta.url)), 'utf8');

/** Signs with the SDK's own hybrid signer, for the public test account only. */
function sdkSigned(overrides = {}, plan = TEST_PLAN) {
  const message = { typeUrl: '/cosmos.bank.v1beta1.MsgSend', value: { fromAddress: plan.native, toAddress: plan.native, amount: [{ denom: 'uqor', amount: overrides.amount ?? plan.amount }] } };
  return sdk.signHybridEth({
    account: overrides.account ?? { privateKey: account.privateKey, publicKey: account.publicKey, pqc: account.pqc },
    chainId: overrides.chainId ?? plan.chainId, accountNumber: BigInt(overrides.accountNumber ?? plan.accountNumber), sequence: BigInt(overrides.sequence ?? plan.sequence),
    messages: [message], fee: overrides.fee ?? { amount: [{ denom: 'uqor', amount: feeFor(plan.gasLimit, plan.gasPrice) }], gas: String(plan.gasLimit) },
    memo: '', encodeMessage: m => registry.encodeAsAny(m), signBytesVersion: overrides.signBytesVersion ?? 'v2',
  });
}
const check = (txRawBytes, keys = {}) => hybridFormatFailures(txRawBytes, { classicalPublicKeyHex: keys.classical ?? account.publicKey, pqcPublicKey: keys.pqc ?? account.pqc.publicKey, plan: TEST_PLAN });
const reencode = (txRawBytes, edit) => {
  const raw = TxRaw.decode(txRawBytes);
  const body = TxBody.decode(raw.bodyBytes);
  edit(body, raw);
  return TxRaw.encode(TxRaw.fromPartial({ bodyBytes: TxBody.encode(body).finish(), authInfoBytes: raw.authInfoBytes, signatures: raw.signatures })).finish();
};
const ethSign = (bodyBytes, authInfoBytes, privateKey = account.privateKey) => secp256k1.sign(
  sdk.keccak256(SignDoc.encode(SignDoc.fromPartial({ bodyBytes, authInfoBytes, chainId: TEST_PLAN.chainId, accountNumber: BigInt(TEST_PLAN.accountNumber) })).finish()),
  Buffer.from(privateKey.slice(2), 'hex'), { prehash: false },
);

test('the SDK hybrid format: B0 and auth info are signed by ML-DSA-87 (v2 sign bytes), the final body by the classical key', () => {
  const signed = sdkSigned();
  assert.deepEqual(check(signed.txRawBytes), []);
  const parts = unsignedHybridParts({ publicKeyHex: account.publicKey, plan: TEST_PLAN });
  assert.deepEqual(Buffer.from(signed.authInfoBytes), Buffer.from(parts.authInfoBytes), 'the prepare tool builds the same auth info');
  const body = TxBody.decode(signed.bodyBytes);
  assert.equal(body.extensionOptions.length, 1);
  assert.equal(body.extensionOptions[0].typeUrl, '/qorechain.pqc.v1.PQCHybridSignature');
  assert.equal(body.nonCriticalExtensionOptions.length, 0);
  const ext = sdk.qorechainTypes.pqcHybrid.PQCHybridSignature.decode(body.extensionOptions[0].value);
  assert.equal(ext.algorithmId, 1);
  assert.equal(ext.pqcSignature.length, 4627);
  assert.equal(ext.pqcPublicKey.length, 0);
  assert.ok(sdk.pqcVerify(account.pqc.publicKey, parts.pqcSignBytes, ext.pqcSignature), 'the PQC key signs exactly the prepared bytes');
  const v2 = Buffer.from(parts.pqcSignBytes);
  assert.equal(v2.subarray(0, 23).toString(), 'qorechain-pqc-hybrid-v2');
  assert.equal(v2.readBigUInt64BE(23), 15n);
  assert.equal(v2.subarray(31, 46).toString(), 'qorechain-diana');
  assert.equal(TxRaw.decode(signed.txRawBytes).signatures[0].length, 64);
});

test('every wrong signature format is refused', () => {
  const signed = sdkSigned();
  const cases = [
    ['v1 sign bytes', sdkSigned({ signBytesVersion: 'v1' }).txRawBytes, ['PQC signature does not verify']],
    ['another chain id', sdkSigned({ chainId: 'qorechain-vladi' }).txRawBytes, ['PQC signature does not verify', 'Classical signature does not verify']],
    ['another account number', sdkSigned({ accountNumber: '16047' }).txRawBytes, ['Classical signature does not verify']],
    ['another sequence', sdkSigned({ sequence: '2' }).txRawBytes, ['Wrong signer info']],
    ['another fee', sdkSigned({ fee: { amount: [{ denom: 'uqor', amount: '1' }], gas: '350000' } }).txRawBytes, ['Wrong fee']],
    ['another message', sdkSigned({ amount: '2' }).txRawBytes, ['Wrong message']],
    ['another PQC key (key mismatch)', sdkSigned({ account: { privateKey: account.privateKey, publicKey: account.publicKey, pqc: other.pqc } }).txRawBytes, ['PQC signature does not verify']],
    ['another classical key', sdkSigned({ account: { privateKey: other.privateKey, publicKey: account.publicKey, pqc: account.pqc } }).txRawBytes, ['Classical signature does not verify']],
    ['classical-only, no extension', sdk.signClassicalEth({ account: { privateKey: account.privateKey, publicKey: account.publicKey }, chainId: TEST_PLAN.chainId, accountNumber: 16046n, sequence: 1n, messages: [{ typeUrl: '/cosmos.bank.v1beta1.MsgSend', value: { fromAddress: account.cosmos, toAddress: account.cosmos, amount: [{ denom: 'uqor', amount: '1' }] } }], fee: { amount: [{ denom: 'uqor', amount: '52500' }], gas: '350000' }, memo: '', encodeMessage: m => registry.encodeAsAny(m) }).txRawBytes, ['Missing or extra hybrid extension']],
  ];
  for (const [label, bytes, expected] of cases) assert.deepEqual(check(bytes), expected, label);

  const ext = TxBody.decode(signed.bodyBytes).extensionOptions[0];
  const nonCritical = reencode(signed.txRawBytes, body => { body.nonCriticalExtensionOptions = body.extensionOptions; body.extensionOptions = []; });
  assert.deepEqual(check(nonCritical), ['Hybrid extension not in extension_options', 'Missing or extra hybrid extension', 'Classical signature does not verify']);
  const twice = reencode(signed.txRawBytes, body => { body.extensionOptions = [ext, ext]; });
  assert.ok(check(twice).includes('Missing or extra hybrid extension'));
  const withKey = reencode(signed.txRawBytes, body => {
    const decoded = sdk.qorechainTypes.pqcHybrid.PQCHybridSignature.decode(ext.value);
    body.extensionOptions = [sdk.encodeHybridExtension({ algorithm_id: 1, pqc_signature: decoded.pqcSignature, pqc_public_key: account.pqc.publicKey })];
  });
  assert.deepEqual(check(withKey), ['PQC public key must not be attached', 'Classical signature does not verify']);
  const corrupted = reencode(signed.txRawBytes, body => {
    const decoded = sdk.qorechainTypes.pqcHybrid.PQCHybridSignature.decode(ext.value);
    decoded.pqcSignature[100] ^= 1;
    body.extensionOptions = [sdk.encodeHybridExtension({ algorithm_id: 1, pqc_signature: decoded.pqcSignature })];
  });
  assert.deepEqual(check(corrupted), ['PQC signature does not verify', 'Classical signature does not verify']);
  // The classical key signing B0 (the body without the extension) instead of the final body.
  const parts = unsignedHybridParts({ publicKeyHex: account.publicKey, plan: TEST_PLAN });
  const overB0 = TxRaw.encode(TxRaw.fromPartial({ bodyBytes: signed.bodyBytes, authInfoBytes: signed.authInfoBytes, signatures: [ethSign(parts.b0, parts.authInfoBytes)] })).finish();
  assert.deepEqual(check(overB0), ['Classical signature does not verify']);
  const overFinal = TxRaw.encode(TxRaw.fromPartial({ bodyBytes: signed.bodyBytes, authInfoBytes: signed.authInfoBytes, signatures: [ethSign(signed.bodyBytes, signed.authInfoBytes)] })).finish();
  assert.deepEqual(check(overFinal), [], 'the same signer over the final body passes');
  assert.deepEqual(check(Buffer.from('not a tx')), ['Unreadable transaction']);
  for (const list of cases.map(c => c[2])) for (const failure of list) assert.ok(FORMAT_FAILURES.includes(failure));
});

// A fake Diana node behind the real guard. No real network request is made by these tests.
function fakeNode(overrides = {}) {
  const chain = {
    network: 'qorechain-diana', evmChainId: '0x2648', authStatus: 200, accountNumber: '16046', sequence: '1',
    pubKey: Buffer.from(account.publicKey.slice(2), 'hex').toString('base64'), pubKeyType: sdk.ETHSECP256K1_PUBKEY_TYPE,
    uqor: '99910000', pqcFound: true, pqcKey: account.pqc.publicKey, algorithmId: 1, minGasPrice: '0.1', signBytesV2: true, simulateGas: 186999, ...overrides,
  };
  const requests = [];
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = (init.method ?? 'GET').toUpperCase();
    requests.push({ method, path: u.pathname, body: init.body });
    if (u.host === new URL(EVM_RPC).host) return json(200, { result: chain.evmChainId });
    if (u.pathname === '/cosmos/base/tendermint/v1beta1/node_info') return json(200, { default_node_info: { network: chain.network } });
    if (u.pathname.startsWith('/cosmos/auth/v1beta1/accounts/')) {
      return chain.authStatus === 200
        ? json(200, { account: { '@type': '/cosmos.auth.v1beta1.BaseAccount', pub_key: chain.pubKey && { '@type': chain.pubKeyType, key: chain.pubKey }, account_number: chain.accountNumber, sequence: chain.sequence } })
        : json(404, { message: 'not found' });
    }
    if (u.pathname.includes('/by_denom')) return json(200, { balance: { denom: 'uqor', amount: chain.uqor } });
    if (u.pathname.startsWith('/qorechain/pqc/v1/account/')) return json(200, chain.pqcFound ? { found: true, account: { algorithm_id: chain.algorithmId, public_key: Buffer.from(chain.pqcKey).toString('base64') } } : { found: false, account: null });
    if (u.pathname === '/cosmos/evm/feemarket/v1/params') return json(200, { params: { min_gas_price: chain.minGasPrice } });
    if (u.pathname === '/qorechain/pqc/v1/protocol_features') return json(200, { features: [{ name: 'pqc-sign-bytes-v2', enabled: chain.signBytesV2 }] });
    if (u.pathname === '/cosmos/tx/v1beta1/simulate') return json(200, { gas_info: { gas_used: String(chain.simulateGas) } });
    return json(404, { message: 'not found' });
  };
  return { chain, requests, network: { rest: REST, evmRpc: EVM_RPC, fetch: guardedFetch({ rest: REST, evmRpc: EVM_RPC }, fetchImpl) } };
}

async function prepare(node) {
  const outputs = [];
  try {
    return { result: await prepareHybridSelfSend({ network: node.network, plan: TEST_PLAN, write: r => outputs.push(r) }), outputs };
  } catch (error) {
    return { error, outputs };
  }
}

test('PREPARE reads, simulates once with placeholder signatures, and never signs or broadcasts', async () => {
  const node = fakeNode();
  const { result, error } = await prepare(node);
  assert.equal(error, undefined);
  assert.equal(result.signed, false);
  assert.equal(result.broadcast, false);
  assert.equal(result.from, account.cosmos);
  assert.equal(result.to, account.cosmos);
  assert.equal(result.amount, '1uqor');
  assert.equal(result.sequence, '1');
  assert.equal(result.signMode, 'SIGN_MODE_DIRECT');
  assert.equal(result.signBytesVersion, 'v2');
  assert.equal(result.feeCeiling, '52500uqor');
  assert.equal(result.simulatedGasWithPlaceholders, 186999);
  assert.equal(result.estimatedGas, 226999);
  assert.equal(result.estimateIsExact, false);
  assert.equal(result.gasFitsWithHeadroom, true);
  const parts = unsignedHybridParts({ publicKeyHex: account.publicKey, plan: TEST_PLAN });
  assert.equal(result.pqcSignBytesSha256, sha(parts.pqcSignBytes));
  const posts = node.requests.filter(r => r.method === 'POST' && r.path !== '/');
  assert.deepEqual(posts.map(r => r.path), ['/cosmos/tx/v1beta1/simulate']);
  const simulated = TxRaw.decode(Buffer.from(JSON.parse(posts[0].body).tx_bytes, 'base64'));
  assert.ok(simulated.signatures[0].every(b => b === 0), 'all-zero classical placeholder');
  const ext = sdk.qorechainTypes.pqcHybrid.PQCHybridSignature.decode(TxBody.decode(simulated.bodyBytes).extensionOptions[0].value);
  assert.equal(ext.pqcSignature.length, 4627);
  assert.ok(ext.pqcSignature.every(b => b === 0), 'all-zero PQC placeholder');
  assert.deepEqual(Buffer.from(placeholderSimulationTx(parts, TEST_PLAN)), Buffer.from(JSON.parse(posts[0].body).tx_bytes, 'base64'));
});

test('each failing live check stops before the simulation', async () => {
  const scenarios = [
    [{ network: 'qorechain-vladi' }, 'Wrong chain id'],
    [{ evmChainId: '0x2649' }, 'Wrong chain id'],
    [{ authStatus: 404 }, 'Account not found on chain'],
    [{ accountNumber: '99' }, 'Unexpected account number'],
    [{ sequence: '2' }, 'Account sequence changed'],
    [{ pubKey: Buffer.from(other.publicKey.slice(2), 'hex').toString('base64') }, 'On-chain classical key missing or not this account'],
    [{ pubKey: null }, 'On-chain classical key missing or not this account'],
    [{ pqcFound: false }, 'PQC key not registered'],
    [{ pqcKey: other.pqc.publicKey }, 'Registered PQC key is not the expected key'],
    [{ algorithmId: 2 }, 'Registered PQC algorithm is not ML-DSA-87'],
    [{ signBytesV2: false }, 'Chain does not use v2 hybrid sign bytes'],
    [{ uqor: '52500' }, 'Insufficient uqor balance'],
    // feemarket min_gas_price is in the EVM base unit (1 uqor = 1e12); 2e11 is 0.2 uqor per gas.
    [{ minGasPrice: '200000000000' }, 'Gas price below the chain minimum'],
  ];
  for (const [change, failure] of scenarios) {
    const node = fakeNode(change);
    const { error } = await prepare(node);
    assert.ok(error instanceof CheckError, failure);
    assert.deepEqual(error.failures, [failure], failure);
    assert.equal(failureMessage(error), 'Check failed: ' + failure);
    assert.equal(node.requests.some(r => r.path.startsWith('/cosmos/tx/')), false, failure);
    assert.ok(PREPARE_FAILURES.includes(failure));
  }
  assert.equal(prepareFailures({}, TEST_PLAN).length > 0, true);
});

test('an estimate that does not fit 350,000 gas with 1.3x headroom is refused', async () => {
  const node = fakeNode({ simulateGas: 240000 });
  const { error, outputs } = await prepare(node);
  assert.equal(error.message, 'Estimated gas exceeds the safe gas limit');
  assert.equal(outputs.at(-1).gasFitsWithHeadroom, false);
  assert.equal(outputs.at(-1).signed, false);
});

test('the network guard has no broadcast route at all', async () => {
  let calls = 0;
  const fetch = guardedFetch({ rest: REST, evmRpc: EVM_RPC }, async () => { calls++; return new Response('{}'); });
  await fetch(REST + '/cosmos/auth/v1beta1/accounts/x');
  await fetch(REST + '/cosmos/tx/v1beta1/simulate', { method: 'POST', body: '{}' });
  await fetch(EVM_RPC, { method: 'POST', body: JSON.stringify({ method: 'eth_chainId' }) });
  for (const [url, init] of [
    [REST + '/cosmos/tx/v1beta1/txs', { method: 'POST', body: '{}' }],
    [EVM_RPC, { method: 'POST', body: JSON.stringify({ method: 'eth_sendRawTransaction' }) }],
    ['https://example.com/x', {}],
    [REST.replace('https:', 'http:') + '/x', {}],
  ]) await assert.rejects(fetch(url, init), /Network request blocked/);
  assert.equal(calls, 3);
});

test('failure messages are fixed', () => {
  assert.equal(failureMessage(new CheckError(['Account sequence changed', 'secret ' + PUBLIC_TEST_MNEMONIC])), 'Check failed: Account sequence changed');
  assert.equal(failureMessage(new Error('HTTP 500 from ' + REST)), 'Prepare stopped');
  assert.equal(failureMessage(new Error('Simulation failed')), 'Simulation failed');
});

test('the prepare tool cannot touch the vault, a key, or the broadcast route', () => {
  const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map(m => m[1]);
  assert.deepEqual(imports.sort(), ['@noble/curves/secp256k1.js', '@qorechain/sdk', 'cosmjs-types/cosmos/crypto/secp256k1/keys', 'cosmjs-types/cosmos/tx/signing/v1beta1/signing', 'cosmjs-types/cosmos/tx/v1beta1/tx', 'node:crypto', 'node:path', 'node:url']);
  for (const forbidden of ['ELA-PRIVATE-VAULT', 'recovery.json', 'readRecordBytes', 'node:fs', 'deriveUnifiedAccount', 'mnemonic', 'privateKey', 'secretKey', 'signHybridEth(', 'signClassicalEth', 'pqcSign(', 'secp256k1.sign', '/cosmos/tx/v1beta1/txs', 'writeFile', 'console.']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
