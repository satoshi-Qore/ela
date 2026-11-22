import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as sdk from '@qorechain/sdk';
import { TxBody, TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import { getContractAddress, keccak256, toHex } from 'viem';
import { CheckError } from '../diana-hybrid-prepare.mjs';
import {
  WINDOW_PLAN, WindowCheckError, failureMessage, guardedFetch, loadArtifact, prepareDeploymentWindow, weiToUqorCeil, windowParameterFailures,
} from '../diana-window-prepare.mjs';

// Public BIP-39 test mnemonic (all-"abandon" vector), used only for public addresses and public keys.
const PUBLIC_TEST_MNEMONIC = Array(11).fill('abandon').concat('about').join(' ');
const account = await sdk.deriveUnifiedAccount(PUBLIC_TEST_MNEMONIC, 0);
const other = await sdk.deriveUnifiedAccount(PUBLIC_TEST_MNEMONIC, 1);
account.pqc.secretKey.fill(0);
other.pqc.secretKey.fill(0);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const TEST_PLAN = Object.freeze({ ...WINDOW_PLAN, native: account.cosmos, evm: account.evm, pqcPublicKeySha256: sha(account.pqc.publicKey) });
const { rest: REST, evmRpc: EVM_RPC } = sdk.NETWORKS.testnet.endpoints;
const ARTIFACT = Object.freeze({ bytecode: '0x6080604052', compiler: '0.8.28+commit.7893614a', evmVersion: 'paris', sourceKeccak: '0x' + '00'.repeat(32) });
const HEIGHT = 10240000n;
const source = readFileSync(fileURLToPath(new URL('../diana-window-prepare.mjs', import.meta.url)), 'utf8');

// A fake Diana node behind the real guard; no real network request is made by these tests.
function fakeNode(overrides = {}) {
  const chain = {
    network: 'qorechain-diana', evmChainId: '0x2648', accountNumber: '16046', sequence: '2', evmNonce: '0x2',
    pubKey: Buffer.from(account.publicKey.slice(2), 'hex').toString('base64'), uqor: '99857500',
    pqcFound: true, pqcKey: account.pqc.publicKey, signBytesV2: true, minGasPrice: '0.1',
    gasPrice: '0x' + (112_500_000_000n).toString(16), baseFee: '0.100000000000000000', windowLive: false,
    estimateGas: '0x' + (1_365_419).toString(16), estimateError: false, placeholderGas: 186651, secondsPerBlock: 1.425, ...overrides,
  };
  const requests = [];
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const t = h => new Date(Date.UTC(2026, 10, 17) + Number(h) * chain.secondsPerBlock * 1000).toISOString();
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = (init.method ?? 'GET').toUpperCase();
    requests.push({ method, path: u.pathname, body: init.body });
    if (u.host === new URL(EVM_RPC).host) {
      const { method: m } = JSON.parse(init.body);
      if (m === 'eth_chainId') return json(200, { result: chain.evmChainId });
      if (m === 'eth_getTransactionCount') return json(200, { result: chain.evmNonce });
      if (m === 'eth_getBalance') return json(200, { result: '0x' + (BigInt(chain.uqor) * 10n ** 12n).toString(16) });
      if (m === 'eth_gasPrice') return json(200, { result: chain.gasPrice });
      if (m === 'eth_estimateGas') return json(200, chain.estimateError ? { error: { code: -32000, message: 'execution reverted' } } : { result: chain.estimateGas });
    }
    if (u.pathname === '/cosmos/base/tendermint/v1beta1/node_info') return json(200, { default_node_info: { network: chain.network } });
    if (u.pathname === '/cosmos/base/tendermint/v1beta1/blocks/latest') return json(200, { block: { header: { height: String(HEIGHT), time: t(HEIGHT) } } });
    if (u.pathname.startsWith('/cosmos/base/tendermint/v1beta1/blocks/')) { const h = u.pathname.split('/').pop(); return json(200, { block: { header: { height: h, time: t(h) } } }); }
    if (u.pathname.startsWith('/cosmos/auth/v1beta1/accounts/')) return json(200, { account: { '@type': '/cosmos.auth.v1beta1.BaseAccount', pub_key: { '@type': sdk.ETHSECP256K1_PUBKEY_TYPE, key: chain.pubKey }, account_number: chain.accountNumber, sequence: chain.sequence } });
    if (u.pathname.includes('/by_denom')) return json(200, { balance: { denom: 'uqor', amount: chain.uqor } });
    if (u.pathname.startsWith('/qorechain/pqc/v1/account/')) return json(200, chain.pqcFound ? { found: true, account: { algorithm_id: 1, public_key: Buffer.from(chain.pqcKey).toString('base64') } } : { found: false, account: null });
    if (u.pathname === '/cosmos/evm/feemarket/v1/params') return json(200, { params: { min_gas_price: chain.minGasPrice, base_fee: chain.baseFee } });
    if (u.pathname === '/cosmos/evm/vm/v1/params') return json(200, { params: { evm_denom: 'uqor', extended_denom_options: { extended_denom: 'aqor' } } });
    if (u.pathname === '/qorechain/pqc/v1/protocol_features') return json(200, { features: [{ name: 'pqc-sign-bytes-v2', enabled: chain.signBytesV2 }] });
    if (u.pathname.startsWith('/qorechain/pqc/v1/evm_window/')) return json(200, { found: chain.windowLive, live: chain.windowLive });
    if (u.pathname === '/cosmos/tx/v1beta1/simulate') return json(200, { gas_info: { gas_used: String(chain.placeholderGas) } });
    return json(404, { message: 'not found' });
  };
  return { chain, requests, network: { rest: REST, evmRpc: EVM_RPC, fetch: guardedFetch({ rest: REST, evmRpc: EVM_RPC }, fetchImpl) } };
}

async function prepare(node, plan = TEST_PLAN) {
  const outputs = [];
  try {
    return { result: await prepareDeploymentWindow({ network: node.network, plan, artifact: ARTIFACT, now: () => 1795000000, write: r => outputs.push(r) }), outputs };
  } catch (error) {
    return { error, outputs };
  }
}

test('PREPARE builds the deployment window, simulates it with placeholders, and predicts the nonce and address', async () => {
  const node = fakeNode();
  const { result, error } = await prepare(node);
  assert.equal(error, undefined);
  assert.deepEqual([result.signed, result.broadcast, result.windowOpened, result.deployed], [false, false, false, false]);
  assert.equal(result.window.typeUrl, '/qorechain.pqc.v1.MsgOpenEVMWindow');
  assert.equal(result.window.sender, account.cosmos);
  assert.equal(result.window.blocks, '400');
  assert.equal(result.window.maxTxs, '1');
  assert.deepEqual(result.window.allowedTargets, []);
  assert.equal(result.window.nativeOnly, false);
  // 1,365,419 x 1.25 = 1,706,774 -> 1,710,000 gas; x 150 gwei = 2.565e17 wei = 256,500 uqor.
  assert.equal(result.deployment.gasLimit, '1710000');
  assert.equal(result.deployment.maxCostWei, '256500000000000000');
  assert.equal(result.window.maxValueUqor, '256500');
  assert.equal(result.unitsConsistent, true);
  assert.equal(result.deployment.expectedNonce, '3');
  assert.equal(result.deployment.predictedContractAddress, getContractAddress({ from: account.evm, nonce: 3n }));
  assert.equal(result.cosmosTx.estimatedGas, 186651 + sdk.HYBRID_VERIFY_GAS);
  assert.equal(result.cosmosTx.estimateIsExact, false);
  assert.equal(result.window.approximateMinutes, 9.5);
  // Exactly one POST to the simulation route, carrying the window message and all-zero signatures.
  const posts = node.requests.filter(r => r.method === 'POST' && r.path !== '/');
  assert.deepEqual(posts.map(r => r.path), ['/cosmos/tx/v1beta1/simulate']);
  const raw = TxRaw.decode(Buffer.from(JSON.parse(posts[0].body).tx_bytes, 'base64'));
  assert.ok(raw.signatures[0].every(b => b === 0));
  const body = TxBody.decode(raw.bodyBytes);
  assert.equal(body.messages[0].typeUrl, '/qorechain.pqc.v1.MsgOpenEVMWindow');
  const decoded = sdk.qorechainTypes.pqc.MsgOpenEVMWindow.decode(body.messages[0].value);
  assert.deepEqual([decoded.sender, decoded.blocks, decoded.maxTxs, decoded.maxValue, decoded.nativeOnly, decoded.allowedTargets], [account.cosmos, '400', '1', '256500', false, []]);
  assert.ok(sdk.qorechainTypes.pqcHybrid.PQCHybridSignature.decode(body.extensionOptions[0].value).pqcSignature.every(b => b === 0));
  // Only read-only EVM methods were used.
  const evmMethods = node.requests.filter(r => r.method === 'POST' && r.path === '/').map(r => JSON.parse(r.body).method);
  assert.deepEqual([...new Set(evmMethods)].sort(), ['eth_chainId', 'eth_estimateGas', 'eth_gasPrice', 'eth_getBalance', 'eth_getTransactionCount']);
});

test('wrong network, changed sequence, missing PQC registration or low balance stops before the simulation', async () => {
  for (const [change, failure] of [
    [{ network: 'qorechain-vladi' }, 'Wrong chain id'],
    [{ evmChainId: '0x2649' }, 'Wrong chain id'],
    [{ sequence: '3', evmNonce: '0x3' }, 'Account sequence changed'],
    [{ pqcFound: false }, 'PQC key not registered'],
    [{ pqcKey: other.pqc.publicKey }, 'Registered PQC key is not the expected key'],
    [{ uqor: String(52500 + 256500 - 1) }, 'Insufficient uqor balance'],
  ]) {
    const node = fakeNode(change);
    const { error } = await prepare(node);
    assert.ok(error instanceof CheckError, failure);
    assert.deepEqual(error.failures, [failure]);
    assert.equal(failureMessage(error), 'Check failed: ' + failure);
    assert.equal(node.requests.some(r => r.path === '/cosmos/tx/v1beta1/simulate'), false, failure);
  }
  // Exactly enough: the window fee ceiling plus the whole window value.
  assert.equal((await prepare(fakeNode({ uqor: String(52500 + 256500) }))).error, undefined);
});

test('window-side problems stop before the simulation', async () => {
  for (const [change, failure] of [
    [{ evmNonce: '0x5' }, 'EVM nonce is not the account sequence'],
    [{ windowLive: true }, 'A window is already live'],
    [{ gasPrice: '0x' + (200_000_000_000n).toString(16) }, 'Fee cap below the live gas price'],
    [{ baseFee: '0.200000000000000000' }, 'Fee cap below the live gas price'],
    [{ estimateError: true }, 'Deployment estimate failed'],
  ]) {
    const node = fakeNode(change);
    const { error } = await prepare(node);
    assert.ok(error instanceof WindowCheckError, failure);
    assert.deepEqual(error.failures, [failure]);
    assert.equal(failureMessage(error), 'Window check failed: ' + failure);
    assert.equal(node.requests.some(r => r.path === '/cosmos/tx/v1beta1/simulate'), false);
  }
});

test('invalid window parameters are refused', async () => {
  const live = { secondsPerBlock: 1.425 };
  const ok = { ...TEST_PLAN, maxValueUqor: 256500n };
  assert.deepEqual(windowParameterFailures(ok, live), []);
  for (const [label, change, failure] of [
    ['maxTxs 0', { maxTxs: 0 }, 'Invalid window parameters'],
    ['maxTxs 2', { maxTxs: 2 }, 'Invalid window parameters'],
    ['targets set', { allowedTargets: ['0x1111111111111111111111111111111111111111'] }, 'Invalid window parameters'],
    ['native only', { nativeOnly: true }, 'Invalid window parameters'],
    ['zero blocks', { windowBlocks: 0 }, 'Invalid window parameters'],
    ['above the chain maximum', { windowBlocks: 17281, maxWindowBlocks: 20000 }, 'Invalid window parameters'],
    ['zero maxValue', { maxValueUqor: 0n }, 'Invalid window parameters'],
    ['too short', { windowBlocks: 50 }, 'Window too short or too long for the live block time'],
    ['too long', { windowBlocks: 5000 }, 'Window too short or too long for the live block time'],
  ]) {
    assert.ok(windowParameterFailures({ ...ok, ...change }, live).includes(failure), label);
  }
  assert.ok(windowParameterFailures(ok, {}).includes('Window too short or too long for the live block time'), 'no live block time');
  // Through the whole flow: a plan with two transactions never reaches the simulation.
  const node = fakeNode();
  const { error } = await prepare(node, { ...TEST_PLAN, maxTxs: 2 });
  assert.ok(error instanceof WindowCheckError);
  assert.deepEqual(error.failures, ['Invalid window parameters']);
  assert.equal(node.requests.some(r => r.path === '/cosmos/tx/v1beta1/simulate'), false);
});

test('a Cosmos estimate that does not fit the gas limit with headroom is refused', async () => {
  const { error, outputs } = await prepare(fakeNode({ placeholderGas: 240000 }));
  assert.equal(error.message, 'Estimated gas exceeds the safe gas limit');
  assert.equal(outputs.at(-1).cosmosTx.gasFitsWithHeadroom, false);
});

test('units: wei to uqor rounds up, as the SDK does', () => {
  assert.equal(weiToUqorCeil(0n), 0n);
  assert.equal(weiToUqorCeil(1n), 1n);
  assert.equal(weiToUqorCeil(10n ** 12n), 1n);
  assert.equal(weiToUqorCeil(10n ** 12n + 1n), 2n);
  assert.equal(weiToUqorCeil(256_500_000_000_000_000n), 256_500n);
  // The SDK's own window cost formula agrees.
  assert.equal(sdk.MAX_EVM_WINDOW_BLOCKS, 17280n);
});

test('the artifact must have been compiled from the contract source', () => {
  const src = Buffer.from('pragma solidity 0.8.28;\ncontract X {}\n');
  const art = k => JSON.stringify({ bytecode: { object: '0x60' }, metadata: { compiler: { version: 'x' }, settings: { evmVersion: 'paris' }, sources: { 'src/DianaPaymentAccount.sol': { keccak256: k } } } });
  const read = (data, s = src) => p => (String(p).endsWith('.json') ? data : s);
  assert.equal(loadArtifact({ artifactPath: 'a.json', sourcePath: 's.sol', read: read(art(keccak256(toHex(src)))) }).bytecode, '0x60');
  const crlf = Buffer.from(src.toString().replace(/\n/g, '\r\n'));
  assert.equal(loadArtifact({ artifactPath: 'a.json', sourcePath: 's.sol', read: read(art(keccak256(toHex(src))), crlf) }).bytecode, '0x60', 'CRLF checkout of the same source');
  assert.throws(() => loadArtifact({ artifactPath: 'a.json', sourcePath: 's.sol', read: read(art('0x' + '11'.repeat(32))) }), WindowCheckError);
  assert.throws(() => loadArtifact({ artifactPath: 'a.json', sourcePath: 's.sol', read: () => { throw new Error('ENOENT'); } }), WindowCheckError);
});

test('the guard allows reads, the simulation route and read-only EVM methods, and nothing else', async () => {
  let calls = 0;
  const fetch = guardedFetch({ rest: REST, evmRpc: EVM_RPC }, async () => { calls++; return new Response('{}'); });
  await fetch(REST + '/cosmos/auth/v1beta1/accounts/x');
  await fetch(REST + '/cosmos/tx/v1beta1/simulate', { method: 'POST', body: '{}' });
  for (const method of ['eth_chainId', 'eth_getTransactionCount', 'eth_getBalance', 'eth_gasPrice', 'eth_estimateGas']) {
    await fetch(EVM_RPC, { method: 'POST', body: JSON.stringify({ method }) });
  }
  for (const [url, init] of [
    [REST + '/cosmos/tx/v1beta1/txs', { method: 'POST', body: '{}' }],
    [EVM_RPC, { method: 'POST', body: JSON.stringify({ method: 'eth_sendRawTransaction' }) }],
    [EVM_RPC, { method: 'POST', body: JSON.stringify({ method: 'eth_sendTransaction' }) }],
    [EVM_RPC, { method: 'POST', body: JSON.stringify({ method: 'eth_call' }) }],
    ['https://example.com/x', {}],
    [REST.replace('https:', 'http:') + '/x', {}],
  ]) await assert.rejects(fetch(url, init), /Network request blocked/);
  assert.equal(calls, 7);
});

test('the tool cannot touch the vault, a key, or a broadcast route', () => {
  for (const forbidden of ['ELA-PRIVATE-VAULT', 'recovery.json', 'readRecordBytes', 'deriveUnifiedAccount', 'mnemonic', 'privateKey', 'secretKey', 'signHybridEth', 'signClassicalEth', 'pqcSign(', '/cosmos/tx/v1beta1/txs', 'eth_sendRawTransaction', 'writeFile', 'console.']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  const imports = [...source.matchAll(/^import [^;]*? from '([^']+)';$/gms)].map(m => m[1]).sort();
  assert.deepEqual(imports, ['./diana-hybrid-prepare.mjs', './diana-read-retry.mjs', '@qorechain/sdk', 'node:crypto', 'node:fs', 'node:path', 'node:url', 'viem']);
  const retrySource=readFileSync(new URL('../diana-read-retry.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(retrySource,/^import\s/m);
  for(const forbidden of ['ELA-PRIVATE-VAULT','readRecordBytes','privateKey','secretKey','signTransaction','eth_sendRawTransaction','writeFile'])assert.equal(retrySource.includes(forbidden),false,forbidden);
  assert.equal(failureMessage(new Error('HTTP 500 ' + PUBLIC_TEST_MNEMONIC)), 'Prepare stopped');
});
