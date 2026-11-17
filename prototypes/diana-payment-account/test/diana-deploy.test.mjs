import assert from 'node:assert/strict';
const j = v => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? x.toString() : x));
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as sdk from '@qorechain/sdk';
import { getContractAddress, keccak256, parseTransaction, serializeTransaction, toHex, toRlp } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { windowFormatFailures } from '../diana-window-open.mjs';
import { WINDOW_PLAN } from '../diana-window-prepare.mjs';
import {
  DEPLOY_PLAN, DeployCheckError, LIVE_CONSTRUCTOR_PARAMS, VERIFY_FAILURES, broadcastConfirmation, constructorChecklist, deployGuardedFetch,
  deploymentFormatFailures, deploymentIntent, encodeConstructorArgs, expectedRuntimeCode, failureMessage, loadDeployArtifact, parseArgs,
  prepareDeployment, runDeployBroadcast, signConfirmation, signDeployment, testConstructorParams, verifyDeployment,
} from '../diana-deploy.mjs';

// Public BIP-39 test mnemonic (all-"abandon" vector). It is not an ELA account and holds nothing.
const PUBLIC_TEST_MNEMONIC = Array(11).fill('abandon').concat('about').join(' ');
const account = await sdk.deriveUnifiedAccount(PUBLIC_TEST_MNEMONIC, 0);
const other = await sdk.deriveUnifiedAccount(PUBLIC_TEST_MNEMONIC, 1);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const TEST_PLAN = Object.freeze({ ...DEPLOY_PLAN, native: account.cosmos, evm: account.evm, pqcPublicKeySha256: sha(account.pqc.publicKey) });
const EXPECTED = Object.freeze({ native: account.cosmos, evm: account.evm });
const { rest: REST, evmRpc: EVM_RPC } = sdk.NETWORKS.testnet.endpoints;
const NOW = 1795000000;
const HEIGHT = 10240400n;
const NONCE = 3n;
const scriptPath = fileURLToPath(new URL('../diana-deploy.mjs', import.meta.url));
const source = readFileSync(scriptPath, 'utf8');

// A synthetic artifact: creation code, runtime code, and immutable slots in the contract's declaration order.
const NAMES = ['executor', 'recipient', 'invoiceIssuer', 'maxPerPayment', 'spendingLimit', 'maxPayments', 'startsAt', 'endsAt'];
const RUNTIME = '0x' + Buffer.from(Array.from({ length: 400 }, (_, i) => (i * 7 + 1) % 256)).toString('hex');
const ARTIFACT = Object.freeze({
  bytecode: '0x6080604052348015600f57600080fd5b50', compiler: '0.8.28+commit.7893614a', evmVersion: 'paris', sourceKeccak: '0x' + '11'.repeat(32),
  deployedBytecode: RUNTIME, immutables: Object.fromEntries(NAMES.map((n, i) => [n, [{ start: 10 + i * 40, length: 32 }]])),
});
// A recipient that passes the checklist (public test account 2; not an ELA account).
const recipientAccount = await sdk.deriveUnifiedAccount(PUBLIC_TEST_MNEMONIC, 2);
const liveLikeParams = (overrides = {}) => Object.freeze({
  testOnly: false, reviewed: true, executor: account.evm, recipient: recipientAccount.evm, invoiceIssuer: account.evm,
  maxPerPayment: 10n ** 12n, spendingLimit: 3n * 10n ** 12n, maxPayments: 3n, startsAt: BigInt(NOW), endsAt: BigInt(NOW + 7 * 86400), ...overrides,
});
const PREDICTED = getContractAddress({ from: account.evm, nonce: NONCE });
account.pqc.secretKey.fill(0);

// A fake Diana node behind the real guard, after the window was opened: sequence 3, window live and unused.
function fakeNode(overrides = {}, params = liveLikeParams()) {
  const chain = {
    network: 'qorechain-diana', evmChainId: '0x2648', accountNumber: '16046', sequence: '3', nonce: NONCE, pendingNonce: NONCE, height: HEIGHT,
    pubKey: Buffer.from(account.publicKey.slice(2), 'hex').toString('base64'), uqor: '99805000', pqcFound: true, pqcKey: account.pqc.publicKey,
    gasPrice: '0x' + (112_500_000_000n).toString(16), baseFee: '0.100000000000000000', estimateGas: 1_365_419n, evmDenom: 'uqor',
    window: { found: true, live: true, opened_height: String(HEIGHT - 3n), expiry_height: String(HEIGHT + 397n), max_txs: '1', used_txs: '0', max_value: '256500', used_value: '0', remaining_blocks: '397', remaining_txs: '1', remaining_value: '256500', native_only: false, allowed_targets: [] },
    codes: {}, runtime: expectedRuntimeCode(ARTIFACT, params), callMode: 'ok', sendMode: 'ok', sent: [], txs: {}, receipts: {}, ...overrides,
  };
  const requests = [];
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const t = h => new Date(Date.UTC(2026, 10, 17) + Number(h) * 1425).toISOString();
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = (init.method ?? 'GET').toUpperCase();
    requests.push({ method, path: u.pathname, body: init.body });
    if (u.host === new URL(EVM_RPC).host) {
      const { method: m, params: p } = JSON.parse(init.body);
      const ok = result => json(200, { jsonrpc: '2.0', id: 1, result });
      if (m === 'eth_chainId') return ok(chain.evmChainId);
      if (m === 'eth_getTransactionCount') return ok('0x' + (p[1] === 'pending' ? chain.pendingNonce : chain.nonce).toString(16));
      if (m === 'eth_getBalance') return ok('0x' + (BigInt(chain.uqor) * 10n ** 12n).toString(16));
      if (m === 'eth_gasPrice') return ok(chain.gasPrice);
      if (m === 'eth_estimateGas') return chain.estimateGas === undefined ? json(200, { error: { code: -32000, message: 'execution reverted' } }) : ok('0x' + chain.estimateGas.toString(16));
      if (m === 'eth_getCode') return ok(chain.codes[p[0].toLowerCase()] ?? '0x');
      if (m === 'eth_call') return chain.callMode === 'revert' ? json(200, { error: { code: 3, message: 'execution reverted: InvalidConfiguration' } }) : ok(chain.callMode === 'other' ? RUNTIME : chain.runtime);
      if (m === 'eth_sendRawTransaction') {
        chain.sent.push(p[0]);
        if (chain.sendMode === 'network-error') throw new TypeError('fetch failed');
        if (chain.sendMode === 'no-window') return json(200, { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'no open EVM authorisation window for sender ' + PUBLIC_TEST_MNEMONIC } });
        if (chain.sendMode === 'other-hash') return ok('0x' + 'ab'.repeat(32));
        return ok(keccak256(p[0]));
      }
      if (m === 'eth_getTransactionByHash') return ok(chain.txs[p[0]] ?? null);
      if (m === 'eth_getTransactionReceipt') return ok(chain.receipts[p[0]] ?? null);
      return json(200, { error: { code: -32601, message: 'method not found' } });
    }
    if (method !== 'GET') return json(405, {});
    if (u.pathname === '/cosmos/base/tendermint/v1beta1/node_info') return json(200, { default_node_info: { network: chain.network } });
    if (u.pathname === '/cosmos/base/tendermint/v1beta1/blocks/latest') return json(200, { block: { header: { height: String(chain.height), time: t(chain.height) } } });
    if (u.pathname.startsWith('/cosmos/base/tendermint/v1beta1/blocks/')) { const h = u.pathname.split('/').pop(); return json(200, { block: { header: { height: h, time: t(h) } } }); }
    if (u.pathname.startsWith('/cosmos/auth/v1beta1/accounts/')) return json(200, { account: { '@type': '/cosmos.auth.v1beta1.BaseAccount', pub_key: { '@type': sdk.ETHSECP256K1_PUBKEY_TYPE, key: chain.pubKey }, account_number: chain.accountNumber, sequence: chain.sequence } });
    if (u.pathname.includes('/by_denom')) return json(200, { balance: { denom: 'uqor', amount: chain.uqor } });
    if (u.pathname.startsWith('/qorechain/pqc/v1/account/')) return json(200, chain.pqcFound ? { found: true, account: { algorithm_id: 1, public_key: Buffer.from(chain.pqcKey).toString('base64') } } : { found: false, account: null });
    if (u.pathname === '/cosmos/evm/feemarket/v1/params') return json(200, { params: { min_gas_price: '0.1', base_fee: chain.baseFee } });
    if (u.pathname === '/cosmos/evm/vm/v1/params') return json(200, { params: { evm_denom: chain.evmDenom, extended_denom_options: { extended_denom: 'aqor' } } });
    if (u.pathname === '/qorechain/pqc/v1/protocol_features') return json(200, { features: [{ name: 'pqc-sign-bytes-v2', enabled: true }] });
    if (u.pathname === '/qorechain/pqc/v1/evm_limits') return json(200, { tx_max_gas: '30000000', precompile_input_max_bytes: '65536' });
    if (u.pathname.startsWith('/qorechain/pqc/v1/evm_window/')) return json(200, chain.window);
    return json(404, { message: 'not found' });
  };
  const allowBroadcast = { value: false };
  return { chain, requests, network: { rest: REST, evmRpc: EVM_RPC, allowBroadcast, fetch: deployGuardedFetch({ rest: REST, evmRpc: EVM_RPC }, { allowBroadcast: () => allowBroadcast.value, fetchImpl }) } };
}

const prepare = (node, params = liveLikeParams(), plan = TEST_PLAN) => prepareDeployment({ network: node.network, plan, artifact: ARTIFACT, params, now: () => NOW });
const sends = node => node.requests.filter(r => r.path === '/' && JSON.parse(r.body).method === 'eth_sendRawTransaction');
const recordBytes = () => Buffer.from(JSON.stringify({ mnemonic: PUBLIC_TEST_MNEMONIC, password: 'public-test-password', index: 0, sdkVersion: '0.14.0' }));
const testDeps = () => ({ acceptTestParams: true, derive: (m, i) => sdk.deriveUnifiedAccount(m, i), canonical: (a, m) => sdk.derivePqcCanonical(a, m) });

async function run(node, options = {}) {
  const outputs = [];
  const prompts = [];
  const calls = { readRecord: 0, sign: 0 };
  const deps = { ...testDeps(), signEvm: async (key, tx) => { calls.sign++; return (options.sign ?? ((k, x) => privateKeyToAccount(k).signTransaction(x)))(key, tx); }, ...options.deps };
  let result;
  let error;
  try {
    result = await runDeployBroadcast({
      network: node.network, plan: TEST_PLAN, expected: EXPECTED, artifact: ARTIFACT, params: 'params' in options ? options.params : liveLikeParams(), now: () => NOW, deps,
      readRecord: () => { calls.readRecord++; return recordBytes(); },
      confirm: async phrase => { prompts.push(phrase); options.onConfirm?.(phrase, node.chain); return (options.answer ?? (x => x))(phrase, prompts.length); },
      write: r => outputs.push(JSON.stringify(r, (k, v) => (typeof v === 'bigint' ? v.toString() : v))),
    });
  } catch (e) {
    error = e;
  }
  return { result, error, outputs, prompts, calls };
}

test('PREPARE with an open, unused window and reviewed parameters: every check passes and the exact EIP-1559 creation is planned', async () => {
  const node = fakeNode();
  const r = await prepare(node);
  assert.deepEqual(r.blockers, []);
  assert.equal(r.readyToSign, true);
  assert.deepEqual([r.signed, r.broadcast, r.deployed], [false, false, false]);
  assert.deepEqual(r.checks.map(c => c.id), ['chain', 'deployer', 'pqc', 'window-live', 'window-unused', 'window-untargeted', 'window-bounds', 'nonce', 'gas', 'fee-cap', 'balance', 'units', 'artifact', 'address-free', 'constructor']);
  assert.equal(r.tx.type, 'eip1559');
  assert.equal(r.tx.chainId, 9800);
  assert.equal(r.tx.to, null);
  assert.equal(r.tx.nonce, '3');
  assert.equal(r.tx.gas, '1710000');
  assert.equal(r.tx.windowCostUqor, '256500');
  assert.equal(r.predictedContractAddress, PREDICTED);
  assert.match(r.signingFormat, /EIP-1559.*keccak256\(0x02 \|\| rlp\(fields\)\).*9800.*Not a Cosmos SignDoc/);
  // Read-only: REST GETs and read EVM methods only; no send, no Cosmos POST of any kind.
  assert.ok(node.requests.every(q => q.method === 'GET' || (q.path === '/' && !/eth_send/.test(q.body))));
});

test('each condition blocks on its own: chain, deployer, PQC, window, nonce, gas, fee cap, balance, units, address, constructor', async () => {
  const w = change => ({ window: { ...fakeNode().chain.window, ...change } });
  for (const [change, blocker, params] of [
    [{ network: 'qorechain-vladi' }, 'chain'],
    [{ evmChainId: '0x2649' }, 'chain'],
    [{ accountNumber: '99' }, 'deployer'],
    [{ pubKey: Buffer.from(other.publicKey.slice(2), 'hex').toString('base64') }, 'deployer'],
    [{ pqcFound: false }, 'pqc'],
    [{ pqcKey: other.pqc.publicKey }, 'pqc'],
    [{ window: { found: false, live: false } }, 'window-live'],
    [w({ live: false }), 'window-live'],
    [w({ remaining_blocks: '29' }), 'window-live'],
    [w({ used_txs: '1', remaining_txs: '0' }), 'window-unused'],
    [w({ used_value: '1' }), 'window-unused'],
    [w({ allowed_targets: ['0x1111111111111111111111111111111111111111'] }), 'window-untargeted'],
    [w({ native_only: true }), 'window-untargeted'],
    [w({ max_txs: '2', remaining_txs: '2' }), 'window-bounds'],
    [w({ max_value: '300001', remaining_value: '300001' }), 'window-bounds'],
    [w({ remaining_value: '256499' }), 'window-bounds'],
    [{ pendingNonce: NONCE + 1n }, 'nonce'],
    [{ nonce: NONCE + 1n, pendingNonce: NONCE + 1n }, 'nonce'],
    [{ estimateGas: undefined }, 'gas'],
    [{ estimateGas: 1_400_000n }, 'gas'],
    [{ gasPrice: '0x' + (150_000_000_001n).toString(16) }, 'fee-cap'],
    [{ baseFee: '0.150000000000000001' }, 'fee-cap'],
    [{ uqor: '256499' }, 'balance'],
    [{ evmDenom: 'aqor' }, 'units'],
    [{ codes: { [PREDICTED.toLowerCase()]: '0x60' } }, 'address-free'],
    [{}, 'constructor', testConstructorParams(TEST_PLAN, NOW)],
    [{}, 'constructor', liveLikeParams({ reviewed: false })],
  ]) {
    const r = await prepare(fakeNode(change), params ?? liveLikeParams());
    assert.ok(r.blockers.includes(blocker), blocker + ' ' + j(change) + ' -> ' + JSON.stringify(r.blockers));
    assert.equal(r.readyToSign, false);
    assert.throws(() => deploymentIntent(r, params ?? liveLikeParams(), { plan: TEST_PLAN, artifact: ARTIFACT, acceptTestParams: true }), DeployCheckError);
  }
});

test('constructor checklist: the test set and every unsafe live value are refused', () => {
  const ctx = { plan: TEST_PLAN, nowSeconds: NOW, predictedAddress: PREDICTED, recipientCode: '0x' };
  assert.equal(constructorChecklist(liveLikeParams(), ctx).ready, true);
  const test = constructorChecklist(testConstructorParams(TEST_PLAN, NOW), ctx);
  assert.deepEqual(test.failing, ['chosen', 'reviewed', 'recipient-address']);
  assert.deepEqual(constructorChecklist(null, ctx).failing.slice(0, 2), ['chosen', 'reviewed']);
  for (const [label, change, item, c = {}] of [
    ['other executor', { executor: other.evm }, 'executor'],
    ['other issuer', { invoiceIssuer: other.evm }, 'invoiceIssuer'],
    ['zero recipient', { recipient: '0x0000000000000000000000000000000000000000' }, 'recipient-address'],
    ['precompile recipient', { recipient: '0x0000000000000000000000000000000000000A01' }, 'recipient-address'],
    ['not checksummed', { recipient: recipientAccount.evm.toLowerCase() }, 'recipient-address'],
    ['recipient is executor', { recipient: account.evm }, 'recipient-distinct'],
    ['recipient is the contract', { recipient: PREDICTED }, 'recipient-distinct'],
    ['recipient has code', {}, 'recipient-code', { recipientCode: '0x6080' }],
    ['recipient code unread', {}, 'recipient-code', { recipientCode: undefined }],
    ['zero per payment', { maxPerPayment: 0n }, 'amounts'],
    ['per payment above limit', { maxPerPayment: 4n * 10n ** 12n }, 'amounts'],
    ['limit above 1 QOR', { spendingLimit: 10n ** 18n + 10n ** 12n }, 'amounts'],
    ['not whole uqor', { maxPerPayment: 10n ** 12n + 1n }, 'amounts'],
    ['zero payments', { maxPayments: 0n }, 'maxPayments'],
    ['too many payments', { maxPayments: 101n }, 'maxPayments'],
    ['ends before start', { endsAt: BigInt(NOW - 1) }, 'dates'],
    ['ends too soon', { endsAt: BigInt(NOW + 3600) }, 'dates'],
    ['too long', { endsAt: BigInt(NOW + 400 * 86400) }, 'dates'],
    ['starts too late', { startsAt: BigInt(NOW + 31 * 86400), endsAt: BigInt(NOW + 40 * 86400) }, 'dates'],
  ]) {
    const result = constructorChecklist(liveLikeParams(change), { ...ctx, ...c });
    assert.ok(result.failing.includes(item), label + ' -> ' + JSON.stringify(result.failing));
  }
  // The checklist names every constructor argument and the review sign-off.
  assert.deepEqual(constructorChecklist(liveLikeParams(), ctx).items.map(i => i.id), ['chosen', 'reviewed', 'executor', 'invoiceIssuer', 'recipient-address', 'recipient-distinct', 'recipient-code', 'amounts', 'maxPayments', 'dates']);
});

test('the real deployment is blocked: no live parameters, and test parameters are never accepted for signing', async () => {
  assert.equal(LIVE_CONSTRUCTOR_PARAMS, null);
  const node = fakeNode({}, testConstructorParams(TEST_PLAN, NOW));
  for (const params of [null, undefined, testConstructorParams(TEST_PLAN, NOW)]) {
    const r = await run(node, { params, deps: { acceptTestParams: false } });
    assert.equal(r.error.message, 'Constructor parameters not chosen');
    assert.deepEqual(r.prompts, []);
    assert.equal(r.calls.readRecord, 0);
  }
  assert.equal(node.requests.length, 0, 'refused before any request');
  const r = await prepare(fakeNode(), testConstructorParams(TEST_PLAN, NOW));
  assert.throws(() => deploymentIntent({ ...r, readyToSign: true, blockers: [] }, testConstructorParams(TEST_PLAN, NOW), { plan: TEST_PLAN, artifact: ARTIFACT }), { message: 'Constructor parameters not chosen' });
  // The CLI refuses every non-PREPARE option before touching anything.
  for (const args of [['--broadcast'], ['--verify', '0x' + 'ab'.repeat(32)]]) {
    const out = spawnSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8', input: 'x\n' });
    assert.equal(out.status, 1);
    assert.equal(out.stdout, '');
    assert.equal(out.stderr, 'Diana deployment tool stopped: Constructor parameters not chosen. Nothing was signed or sent.\n');
  }
  assert.match(spawnSync(process.execPath, [scriptPath, '--yes'], { encoding: 'utf8' }).stderr, /Unknown option/);
});

test('SIGN and CHECK: an EIP-1559 creation on 9800 signed by the deployer, and nothing else', async () => {
  const params = liveLikeParams();
  const intent = deploymentIntent(await prepare(fakeNode()), params, { plan: TEST_PLAN, artifact: ARTIFACT });
  assert.equal(signConfirmation(intent), 'SIGN DEPLOYMENT NONCE 3 GAS 1710000 TO ' + PREDICTED + ' FOR 16046');
  const signed = await signDeployment(account.privateKey, intent);
  assert.ok(signed.startsWith('0x02'));
  assert.deepEqual(await deploymentFormatFailures(signed, intent), []);
  const parsed = parseTransaction(signed);
  assert.deepEqual([parsed.chainId, parsed.nonce, parsed.gas, parsed.to, parsed.value ?? 0n], [9800, 3, 1_710_000n, undefined, 0n]);
  assert.equal(parsed.data, ARTIFACT.bytecode + encodeConstructorArgs(params).slice(2));
  const viaKey = (tx, key = account.privateKey) => privateKeyToAccount(key).signTransaction(tx);
  for (const [label, tx, key, failure] of [
    ['other chain', { ...intent.tx, chainId: 9801 }, undefined, 'Wrong chain or type'],
    ['other nonce', { ...intent.tx, nonce: 4 }, undefined, 'Wrong nonce'],
    ['more gas', { ...intent.tx, gas: intent.tx.gas + 1n }, undefined, 'Wrong gas or fees'],
    ['higher fee cap', { ...intent.tx, maxFeePerGas: intent.tx.maxFeePerGas + 1n }, undefined, 'Wrong gas or fees'],
    ['value', { ...intent.tx, value: 1n }, undefined, 'Wrong value'],
    ['a call instead of a creation', { ...intent.tx, to: other.evm }, undefined, 'Not a contract creation'],
    ['other constructor arguments', { ...intent.tx, data: ARTIFACT.bytecode + encodeConstructorArgs(liveLikeParams({ recipient: other.evm })).slice(2) }, undefined, 'Wrong initcode'],
    ['access list', { ...intent.tx, accessList: [{ address: other.evm, storageKeys: [] }] }, undefined, 'Unexpected access or authorization list'],
    ['other key', intent.tx, other.privateKey, 'Signature is not the deployer'],
  ]) {
    const bad = await viaKey(tx, key);
    assert.ok((await deploymentFormatFailures(bad, intent)).includes(failure), label);
  }
  // Legacy and EIP-2930 forms, and garbage, are refused outright.
  assert.deepEqual(await deploymentFormatFailures(await viaKey({ type: 'legacy', chainId: 9800, nonce: 3, gas: intent.tx.gas, gasPrice: intent.tx.maxFeePerGas, data: intent.tx.data }), intent), ['Not an EIP-1559 transaction']);
  assert.deepEqual(await deploymentFormatFailures(await viaKey({ type: 'eip2930', chainId: 9800, nonce: 3, gas: intent.tx.gas, gasPrice: intent.tx.maxFeePerGas, data: intent.tx.data, accessList: [] }), intent), ['Not an EIP-1559 transaction']);
  assert.deepEqual(await deploymentFormatFailures('0x02zz', intent), ['Unreadable transaction']);
  // An unsigned serialization is not a signature by the deployer.
  assert.ok((await deploymentFormatFailures(serializeTransaction(intent.tx), intent)).length > 0);
});

test('the Cosmos hybrid format and the EVM format do not accept each other', async () => {
  const params = liveLikeParams();
  const intent = deploymentIntent(await prepare(fakeNode()), params, { plan: TEST_PLAN, artifact: ARTIFACT });
  const evmTx = await signDeployment(account.privateKey, intent);
  // A hybrid-signed Cosmos window transaction is not an EVM transaction.
  const registry = sdk.qorechainRegistry();
  const windowPlan = { ...WINDOW_PLAN, native: account.cosmos, evm: account.evm, maxValueUqor: 256500n };
  const cosmos = sdk.signHybridEth({
    account: { privateKey: account.privateKey, publicKey: account.publicKey, pqc: await sdk.deriveUnifiedAccount(PUBLIC_TEST_MNEMONIC, 0).then(a => a.pqc) },
    chainId: 'qorechain-diana', accountNumber: 16046n, sequence: 2n, messages: [sdk.openEvmWindowMsg({ sender: account.cosmos, blocks: 400, maxTxs: 1, maxValue: 256500n, nativeOnly: false, allowedTargets: [] })],
    fee: { amount: [{ denom: 'uqor', amount: '52500' }], gas: '350000' }, memo: '', timeoutHeight: 0n, encodeMessage: m => registry.encodeAsAny(m), signBytesVersion: 'v2',
  });
  assert.deepEqual(await deploymentFormatFailures(toHex(cosmos.txRawBytes), intent), ['Not an EIP-1559 transaction']);
  // An EVM transaction is not a Cosmos hybrid transaction.
  const asCosmos = windowFormatFailures(Buffer.from(evmTx.slice(2), 'hex'), { classicalPublicKeyHex: account.publicKey, pqcPublicKey: account.pqc.publicKey, plan: windowPlan });
  assert.ok(asCosmos.length > 0);
  // The two signatures sign different digests over different encodings.
  assert.notEqual(keccak256(evmTx), keccak256(toHex(cosmos.txRawBytes)));
  assert.equal(source.includes('signHybridEth'), false);
  assert.equal(source.includes('/cosmos/tx/v1beta1/'), false, 'no Cosmos simulation or broadcast route');
});

test('the CREATE address is predicted from sender and nonce, and the expected runtime code carries the constructor values', () => {
  for (const nonce of [0n, 1n, 3n, 127n, 128n, 1000n]) {
    const rlpNonce = nonce === 0n ? '0x' : toHex(nonce);
    const manual = '0x' + keccak256(toRlp([account.evm, rlpNonce])).slice(-40);
    assert.equal(getContractAddress({ from: account.evm, nonce }).toLowerCase(), manual, String(nonce));
  }
  assert.notEqual(getContractAddress({ from: account.evm, nonce: 3n }), getContractAddress({ from: account.evm, nonce: 4n }));
  const params = liveLikeParams();
  const code = Buffer.from(expectedRuntimeCode(ARTIFACT, params).slice(2), 'hex');
  assert.equal(code.length, (RUNTIME.length - 2) / 2);
  assert.equal('0x' + code.subarray(10 + 12, 10 + 32).toString('hex'), params.executor.toLowerCase());
  assert.equal('0x' + code.subarray(50 + 12, 50 + 32).toString('hex'), params.recipient.toLowerCase());
  assert.equal(BigInt('0x' + code.subarray(290, 322).toString('hex')), params.endsAt);
  assert.equal(code.subarray(0, 10).toString('hex'), RUNTIME.slice(2, 22), 'code outside the immutable slots is unchanged');
  assert.notEqual(expectedRuntimeCode(ARTIFACT, liveLikeParams({ recipient: other.evm })), expectedRuntimeCode(ARTIFACT, params));
});

test('the artifact loader maps immutables by declaration order and refuses a mismatched source', () => {
  const src = Buffer.from([
    'pragma solidity 0.8.28;', 'contract DianaPaymentAccount {',
    '    address public immutable executor;', '    address payable public immutable recipient;', '    address public immutable invoiceIssuer;',
    '    uint256 public immutable maxPerPayment;', '    uint256 public immutable spendingLimit;', '    uint256 public immutable maxPayments;',
    '    uint256 public immutable startsAt;', '    uint256 public immutable endsAt;', '}', '',
  ].join('\n'));
  const refs = { 163: [{ start: 7, length: 32 }], 149: [{ start: 0, length: 32 }], 151: [{ start: 1, length: 32 }], 153: [{ start: 2, length: 32 }], 155: [{ start: 3, length: 32 }], 157: [{ start: 4, length: 32 }], 159: [{ start: 5, length: 32 }], 161: [{ start: 6, length: 32 }] };
  const art = (k, r = refs) => JSON.stringify({ bytecode: { object: '0x60' }, deployedBytecode: { object: '0x' + '00'.repeat(64), immutableReferences: r }, metadata: { compiler: { version: 'x' }, settings: { evmVersion: 'paris' }, sources: { 'src/DianaPaymentAccount.sol': { keccak256: k } } } });
  const read = data => p => (String(p).endsWith('.json') ? data : src);
  const loaded = loadDeployArtifact({ artifactPath: 'a.json', sourcePath: 's.sol', read: read(art(keccak256(toHex(src)))) });
  assert.deepEqual(Object.keys(loaded.immutables), NAMES);
  assert.deepEqual(NAMES.map(n => loaded.immutables[n][0].start), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.throws(() => loadDeployArtifact({ artifactPath: 'a.json', sourcePath: 's.sol', read: read(art('0x' + '22'.repeat(32))) }), /Artifact does not match the contract source/);
  assert.throws(() => loadDeployArtifact({ artifactPath: 'a.json', sourcePath: 's.sol', read: read(art(keccak256(toHex(src)), { 149: [] })) }), /Artifact does not match the contract source/);
});

test('the compiled artifact, when built locally, matches the source and its immutables match their uses', { skip: !existsSync(fileURLToPath(new URL('../out/DianaPaymentAccount.sol/DianaPaymentAccount.json', import.meta.url))) && 'out/ not built (forge build)' }, () => {
  const art = loadDeployArtifact();
  assert.deepEqual(Object.keys(art.immutables), NAMES);
  // Uses in the source: recipient 4 (getter, check, call, event), invoiceIssuer 3 (getter, digest, key status), the others 2 (getter + one check).
  assert.deepEqual(NAMES.map(n => art.immutables[n].length), [2, 4, 3, 2, 2, 2, 2, 2]);
  assert.equal(expectedRuntimeCode(art, liveLikeParams()).length, art.deployedBytecode.length);
});

test('the full flow: confirmations bound to the deployment and the hash, one signature, a dry run, one send', async () => {
  const node = fakeNode();
  const r = await run(node);
  assert.equal(r.error, undefined, r.error && failureMessage(r.error));
  assert.equal(r.prompts[0], 'SIGN DEPLOYMENT NONCE 3 GAS 1710000 TO ' + PREDICTED + ' FOR 16046');
  assert.equal(r.prompts[1], broadcastConfirmation(r.result.txHash));
  assert.match(r.prompts[1], /^BROADCAST DEPLOYMENT [0-9A-F]{8} TO DIANA 9800$/);
  assert.equal(r.calls.sign, 1);
  assert.equal(r.result.broadcast, 'ACCEPTED');
  assert.equal(r.result.dryRun, 'runtime code matches');
  assert.equal(sends(node).length, 1);
  assert.equal(keccak256(node.chain.sent[0]), r.result.txHash);
  assert.equal(node.network.allowBroadcast.value, false);
  const dry = node.requests.findIndex(q => q.path === '/' && JSON.parse(q.body).method === 'eth_call');
  assert.ok(dry >= 0 && dry < node.requests.indexOf(sends(node)[0]), 'dry run before the send');
  for (const text of r.outputs) for (const secret of [PUBLIC_TEST_MNEMONIC, account.privateKey.slice(2, 34), node.chain.sent[0].slice(0, 80)]) assert.equal(text.includes(secret), false);
});

test('confirmations, chain changes, a failed dry run and node answers each stop the flow safely', async () => {
  for (const answer of [() => '', () => 'yes', p => p.toLowerCase(), () => 'SIGN EVM WINDOW 400 BLOCKS 1 TX 256500 UQOR FOR 16046']) {
    const node = fakeNode();
    const r = await run(node, { answer });
    assert.equal(r.error.message, 'Not confirmed');
    assert.equal(r.calls.readRecord, 0);
    assert.equal(r.calls.sign, 0);
  }
  const second = await run(fakeNode(), { answer: (p, n) => (n === 1 ? p : 'BROADCAST DEPLOYMENT 00000000 TO DIANA 9800') });
  assert.equal(second.error.message, 'Not confirmed');
  assert.equal(second.calls.sign, 1);
  for (const [when, change] of [
    ['SIGN', { uqor: '99805001' }], ['SIGN', { nonce: 4n, pendingNonce: 4n }], ['SIGN', { window: { ...fakeNode().chain.window, used_txs: '1', remaining_txs: '0' } }],
    ['SIGN', { gasPrice: '0x' + (120_000_000_000n).toString(16) }], ['BROADCAST', { pendingNonce: 4n }], ['BROADCAST', { window: { found: false, live: false } }],
  ]) {
    const node = fakeNode();
    const r = await run(node, { onConfirm: (p, chain) => { if (p.startsWith(when)) Object.assign(chain, change); } });
    assert.equal(r.error.message, 'Chain state changed since PREPARE', when + ' ' + j(change));
    assert.equal(sends(node).length, 0);
    if (when === 'SIGN') assert.equal(r.calls.sign, 0);
  }
  for (const callMode of ['revert', 'other']) {
    const node = fakeNode({ callMode });
    const r = await run(node);
    assert.equal(r.error.message, 'Creation dry run failed');
    assert.equal(r.prompts.length, 1, 'no broadcast confirmation asked');
    assert.equal(sends(node).length, 0);
  }
  const wrongKey = await run(fakeNode(), { sign: (k, x) => privateKeyToAccount(other.privateKey).signTransaction(x) });
  assert.ok(wrongKey.error instanceof DeployCheckError && wrongKey.error.failures.includes('Signature is not the deployer'));
  const tampered = await run(fakeNode(), { sign: (k, x) => privateKeyToAccount(k).signTransaction({ ...x, gas: x.gas + 10000n }) });
  assert.ok(tampered.error instanceof DeployCheckError && tampered.error.failures.includes('Wrong gas or fees'));
  for (const [sendMode, message] of [['network-error', 'Broadcast result unknown'], ['no-window', 'Broadcast refused by the node'], ['other-hash', 'Broadcast hash mismatch']]) {
    const node = fakeNode({ sendMode });
    const r = await run(node);
    assert.equal(r.error.message, message);
    assert.equal(node.chain.sent.length, 1, 'exactly one attempt');
    assert.equal(r.outputs.some(t => t.includes('abandon')), false, 'node message not echoed');
    if (sendMode === 'no-window') assert.equal(JSON.parse(r.outputs.at(-1)).window, 'no-window');
  }
});

test('the guard: REST GET only, read-only EVM methods, eth_call only for a creation, the send route once and only when opened', async () => {
  let calls = 0;
  let open = false;
  const fetch = deployGuardedFetch({ rest: REST, evmRpc: EVM_RPC }, { allowBroadcast: () => open, fetchImpl: async () => { calls++; return new Response('{}'); } });
  const evm = (method, params = []) => fetch(EVM_RPC, { method: 'POST', body: JSON.stringify({ method, params }) });
  await fetch(REST + '/cosmos/auth/v1beta1/accounts/x');
  for (const m of ['eth_chainId', 'eth_blockNumber', 'eth_getTransactionCount', 'eth_getBalance', 'eth_gasPrice', 'eth_estimateGas', 'eth_getCode', 'eth_getTransactionByHash', 'eth_getTransactionReceipt']) await evm(m);
  await evm('eth_call', [{ data: '0x60' }, 'latest']);
  await assert.rejects(evm('eth_call', [{ to: other.evm, data: '0x' }, 'latest']), /Network request blocked/);
  await assert.rejects(evm('eth_sendRawTransaction', ['0x02']), /Network request blocked/, 'closed by default');
  open = true;
  await evm('eth_sendRawTransaction', ['0x02']);
  await assert.rejects(evm('eth_sendRawTransaction', ['0x02']), /Network request blocked/, 'only once');
  for (const [url, init] of [
    [REST + '/cosmos/tx/v1beta1/simulate', { method: 'POST', body: '{}' }],
    [REST + '/cosmos/tx/v1beta1/txs', { method: 'POST', body: '{}' }],
    [EVM_RPC, { method: 'POST', body: JSON.stringify({ method: 'eth_sendTransaction' }) }],
    [EVM_RPC, { method: 'POST', body: JSON.stringify({ method: 'eth_sign' }) }],
    [EVM_RPC, { method: 'POST', body: 'not json' }],
    ['https://example.com/x', {}],
    [REST.replace('https:', 'http:') + '/x', {}],
  ]) await assert.rejects(fetch(url, init), /Network request blocked/);
  assert.equal(calls, 12);
});

test('VERIFY: receipt, predicted address, on-chain runtime code with the constructor values, nonce and window use', async () => {
  const params = liveLikeParams();
  const intent = deploymentIntent(await prepare(fakeNode()), params, { plan: TEST_PLAN, artifact: ARTIFACT });
  const signed = await signDeployment(account.privateKey, intent);
  const hash = keccak256(signed);
  const parsed = parseTransaction(signed);
  const included = (change = {}) => {
    const c = {
      nonce: NONCE + 1n, pendingNonce: NONCE + 1n,
      codes: { [PREDICTED.toLowerCase()]: intent.expectedRuntime },
      txs: { [hash]: { type: '0x2', chainId: '0x2648', from: account.evm.toLowerCase(), to: null, nonce: '0x3', gas: '0x' + parsed.gas.toString(16), value: '0x0', input: parsed.data } },
      receipts: { [hash]: { status: '0x1', contractAddress: PREDICTED.toLowerCase(), blockNumber: '0x' + (HEIGHT + 2n).toString(16), gasUsed: '0x14d5ab' } },
      window: { ...fakeNode().chain.window, used_txs: '1', remaining_txs: '0', used_value: '256500', remaining_value: '0', live: false },
    };
    for (const [k, v] of Object.entries(change)) c[k] = typeof v === 'function' ? v(structuredClone(c[k])) : v;
    return fakeNode(c);
  };
  const ok = await verifyDeployment({ network: included().network, txHash: hash, intent });
  assert.equal(ok.verified, true, JSON.stringify(ok.failures));
  assert.equal(ok.codeKeccak, keccak256(intent.expectedRuntime));
  const flip = code => code.slice(0, 100) + (code[100] === 'a' ? 'b' : 'a') + code.slice(101);
  for (const [label, change, failure] of [
    ['missing', { txs: {}, receipts: {} }, 'Transaction not found'],
    ['reverted', { receipts: r => ({ [hash]: { ...r[hash], status: '0x0' } }) }, 'Deployment failed or not included'],
    ['other address', { receipts: r => ({ [hash]: { ...r[hash], contractAddress: other.evm.toLowerCase() } }) }, 'Contract address is not the predicted address'],
    ['code changed', { codes: c => ({ [PREDICTED.toLowerCase()]: flip(c[PREDICTED.toLowerCase()]) }) }, 'On-chain code differs from the compiled contract'],
    ['other recipient baked in', { codes: { [PREDICTED.toLowerCase()]: expectedRuntimeCode(ARTIFACT, liveLikeParams({ recipient: other.evm })) } }, 'On-chain code differs from the compiled contract'],
    ['no code', { codes: {} }, 'On-chain code differs from the compiled contract'],
    ['nonce', { nonce: NONCE + 2n }, 'EVM nonce did not advance by one'],
    ['window unused', { window: w => ({ ...w, used_txs: '0', used_value: '0' }) }, 'Window use not recorded'],
    ['other input', { txs: t => ({ [hash]: { ...t[hash], input: '0x00' } }) }, 'Transaction is not the planned deployment'],
    ['a call', { txs: t => ({ [hash]: { ...t[hash], to: other.evm } }) }, 'Transaction is not the planned deployment'],
  ]) {
    const result = await verifyDeployment({ network: included(change).network, txHash: hash, intent });
    assert.equal(result.verified, false, label);
    assert.ok(result.failures.includes(failure), label + ': ' + JSON.stringify(result.failures));
    assert.ok(result.failures.every(f => VERIFY_FAILURES.includes(f)));
  }
  // VERIFY sends nothing.
  const node = included();
  await verifyDeployment({ network: node.network, txHash: hash, intent });
  assert.ok(node.requests.every(q => q.method === 'GET' || !/eth_send/.test(q.body)));
});

test('options, failure messages and static guarantees', () => {
  assert.deepEqual(parseArgs([]), { mode: 'prepare' });
  assert.deepEqual(parseArgs(['--broadcast']), { mode: 'broadcast' });
  for (const args of [['--yes'], ['--sign'], ['--verify', '0x12'], ['--broadcast', '--yes']]) assert.throws(() => parseArgs(args), { message: 'Unknown option' });
  assert.equal(failureMessage(new Error('invalid mnemonic ' + PUBLIC_TEST_MNEMONIC)), 'Deployment stopped');
  assert.equal(failureMessage(new DeployCheckError(['window-live', 'x: ' + PUBLIC_TEST_MNEMONIC + '!'])), 'Deployment check failed: window-live');
  const main = source.slice(source.indexOf('async function main'));
  assert.ok(main.indexOf('LIVE_CONSTRUCTOR_PARAMS === null') < main.indexOf('prepareDeployment('), 'non-PREPARE options are refused first');
  for (const forbidden of ['runDeployBroadcast(', 'readRecordBytes', 'RECORD_PATH', 'ELA-PRIVATE-VAULT', 'acceptTestParams: true']) assert.equal(main.includes(forbidden), false, forbidden);
  for (const forbidden of ['signHybridEth', 'signClassicalEth', 'pqcSign(', 'writeFile', 'console.', 'while (', 'retry']) assert.equal(source.includes(forbidden), false, forbidden);
  assert.equal([...source.matchAll(/signTransaction\(/g)].length, 1, 'one signing call');
  assert.equal([...source.matchAll(/allowBroadcast\.value = true/g)].length, 1);
  const flow = source.slice(source.indexOf('export async function runDeployBroadcast'), source.indexOf('export function failureMessage'));
  const steps = ['Constructor parameters not chosen', 'prepareDeployment(', 'deploymentIntent(', 'confirm(signPhrase)', 'readParsedRecord(readRecord)', 'Record key is not the on-chain key', 'await same()', 'signDeployment(', 'deploymentFormatFailures(', 'dryRunCreation(', 'confirm(broadcastPhrase)', 'Signed bytes changed before broadcast', 'broadcastOnce('];
  const order = steps.map(s => flow.indexOf(s));
  assert.ok(order.every(i => i >= 0), steps[order.findIndex(i => i < 0)]);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});
