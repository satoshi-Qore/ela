import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as sdk from '@qorechain/sdk';
import { TxBody, TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import { CheckError, PLAN, guardedFetch, hybridFormatFailures } from '../diana-hybrid-prepare.mjs';
import { FormatError, LOCAL_CONFIRMATION, SIGN_CONFIRMATION, SIMULATION_TIMEOUT_BLOCKS, failureMessage, runSignAndSimulate, runSignAndVerifyLocal, sealableNetwork } from '../diana-hybrid-sign.mjs';

// Public BIP-39 test mnemonic (all-"abandon" vector). It is not an ELA account and holds nothing.
const PUBLIC_TEST_MNEMONIC = Array(11).fill('abandon').concat('about').join(' ');
const PASSWORD = 'public-test-password';
const account = await sdk.deriveUnifiedAccount(PUBLIC_TEST_MNEMONIC, 0);
const other = await sdk.deriveUnifiedAccount(PUBLIC_TEST_MNEMONIC, 1);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const TEST_PLAN = Object.freeze({ ...PLAN, native: account.cosmos, evm: account.evm, pqcPublicKeySha256: sha(account.pqc.publicKey) });
const EXPECTED = Object.freeze({ native: account.cosmos, evm: account.evm });
const { rest: REST, evmRpc: EVM_RPC } = sdk.NETWORKS.testnet.endpoints;
const allZero = bytes => bytes.every(b => b === 0);
const scriptPath = fileURLToPath(new URL('../diana-hybrid-sign.mjs', import.meta.url));
const source = readFileSync(scriptPath, 'utf8');
const SECRETS = [PUBLIC_TEST_MNEMONIC, 'abandon', PASSWORD, account.privateKey.slice(2, 34), Buffer.from(account.pqc.secretKey).toString('hex').slice(0, 32)];
const recordBytes = (extra = {}) => Buffer.from(JSON.stringify({ mnemonic: PUBLIC_TEST_MNEMONIC, password: PASSWORD, index: 0, sdkVersion: '0.14.0', ...extra }));
const HEIGHT = 10230000n;

// A fake Diana node behind the real guard; no real network request is made by these tests.
function fakeNode(overrides = {}) {
  const chain = {
    network: 'qorechain-diana', evmChainId: '0x2648', accountNumber: '16046', sequence: '1',
    pubKey: Buffer.from(account.publicKey.slice(2), 'hex').toString('base64'), uqor: '99910000',
    pqcFound: true, pqcKey: account.pqc.publicKey, algorithmId: 1, minGasPrice: '0.1', signBytesV2: true,
    placeholderGas: 186999, signedGas: 227413, simulateMode: 'ok', ...overrides,
  };
  const requests = [];
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = (init.method ?? 'GET').toUpperCase();
    requests.push({ method, path: u.pathname, body: init.body });
    if (u.host === new URL(EVM_RPC).host) return json(200, { result: chain.evmChainId });
    if (u.pathname === '/cosmos/base/tendermint/v1beta1/node_info') return json(200, { default_node_info: { network: chain.network } });
    if (u.pathname === '/cosmos/base/tendermint/v1beta1/blocks/latest') return json(200, { block: { header: { height: String(HEIGHT) } } });
    if (u.pathname.startsWith('/cosmos/auth/v1beta1/accounts/')) return json(200, { account: { '@type': '/cosmos.auth.v1beta1.BaseAccount', pub_key: { '@type': sdk.ETHSECP256K1_PUBKEY_TYPE, key: chain.pubKey }, account_number: chain.accountNumber, sequence: chain.sequence } });
    if (u.pathname.includes('/by_denom')) return json(200, { balance: { denom: 'uqor', amount: chain.uqor } });
    if (u.pathname.startsWith('/qorechain/pqc/v1/account/')) return json(200, chain.pqcFound ? { found: true, account: { algorithm_id: chain.algorithmId, public_key: Buffer.from(chain.pqcKey).toString('base64') } } : { found: false, account: null });
    if (u.pathname === '/cosmos/evm/feemarket/v1/params') return json(200, { params: { min_gas_price: chain.minGasPrice } });
    if (u.pathname === '/qorechain/pqc/v1/protocol_features') return json(200, { features: [{ name: 'pqc-sign-bytes-v2', enabled: chain.signBytesV2 }] });
    if (u.pathname === '/cosmos/tx/v1beta1/simulate') {
      const raw = TxRaw.decode(Buffer.from(JSON.parse(init.body).tx_bytes, 'base64'));
      if (allZero(raw.signatures[0])) return json(200, { gas_info: { gas_used: String(chain.placeholderGas) } });
      if (chain.simulateMode === 'network-error') throw new TypeError('fetch failed');
      if (chain.simulateMode === 'garbage') return new Response('<html>bad gateway</html>', { status: 502 });
      if (chain.simulateMode === 'no-gas') return json(200, { gas_info: {} });
      if (chain.simulateMode === 'hybrid-rejected') return json(400, { code: 4, message: 'hybrid PQC signature verification failed: unauthorized ' + PUBLIC_TEST_MNEMONIC });
      if (chain.simulateMode === 'refused') return json(400, { code: 5, message: 'insufficient funds' });
      return json(200, { gas_info: { gas_used: String(chain.signedGas) } });
    }
    return json(404, { message: 'not found' });
  };
  return { chain, requests, network: { rest: REST, evmRpc: EVM_RPC, fetch: guardedFetch({ rest: REST, evmRpc: EVM_RPC }, fetchImpl) } };
}

function spies() {
  const secrets = [];
  const signedBuffers = [];
  const calls = { readRecord: 0, signHybrid: 0 };
  return {
    secrets, signedBuffers, calls,
    deps: {
      derive: async (m, i) => { const a = await sdk.deriveUnifiedAccount(m, i); secrets.push(a.pqc.secretKey); return a; },
      canonical: (address, m) => { const k = sdk.derivePqcCanonical(address, m); secrets.push(k.secretKey); return k; },
      signHybrid: params => { calls.signHybrid++; const s = sdk.signHybridEth(params); signedBuffers.push(s.txRawBytes, s.bodyBytes, s.classicalSignature); return s; },
    },
  };
}

async function run(node, options = {}) {
  const s = options.spies ?? spies();
  const outputs = [];
  const prompts = [];
  const bytes = options.record ?? recordBytes();
  let result;
  let error;
  try {
    result = await runSignAndSimulate({
      network: node.network, plan: TEST_PLAN, expected: options.expected ?? EXPECTED, deps: s.deps,
      readRecord: () => { s.calls.readRecord++; return bytes; },
      confirm: async phrase => { prompts.push(phrase); options.onConfirm?.(node.chain); return options.answer ?? SIGN_CONFIRMATION; },
      write: r => outputs.push(JSON.stringify(r)),
    });
  } catch (e) {
    error = e;
  }
  return { result, error, outputs, prompts, bytes, spies: s };
}
const simulations = node => node.requests.filter(r => r.path === '/cosmos/tx/v1beta1/simulate');
const signedSimulations = node => simulations(node).filter(r => !allZero(TxRaw.decode(Buffer.from(JSON.parse(r.body).tx_bytes, 'base64')).signatures[0]));
const noLeaks = (outputs, error) => {
  for (const text of [...outputs, error ? failureMessage(error) : '']) for (const secret of SECRETS) assert.equal(text.includes(secret), false);
};
const allClean = (r) => {
  assert.ok(allZero(r.bytes), 'record bytes zeroed');
  for (const secret of r.spies.secrets) assert.ok(allZero(secret), 'PQC secret zeroed');
  for (const buffer of r.spies.signedBuffers) if (buffer) assert.ok(allZero(buffer), 'signed bytes zeroed');
};

test('sign-and-simulate: one confirmed signature, a passing format check, and one signed simulation', async () => {
  const node = fakeNode();
  const r = await run(node);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.prompts, [SIGN_CONFIRMATION]);
  assert.equal(r.result.signed, true);
  assert.equal(r.result.broadcast, false);
  assert.equal(r.result.formatCheck, 'pass');
  assert.equal(r.result.simulation, 'ok');
  assert.equal(r.result.gasUsed, 227413);
  assert.equal(r.result.exactHybridGas, sdk.exactHybridGas(227413));
  assert.equal(r.result.fitsGasLimit, true);
  assert.equal(r.result.simulationTimeoutHeight, String(HEIGHT + BigInt(SIMULATION_TIMEOUT_BLOCKS)));
  assert.equal(r.spies.calls.readRecord, 1);
  assert.equal(r.spies.calls.signHybrid, 1);
  const signed = signedSimulations(node);
  assert.equal(signed.length, 1);
  const raw = Buffer.from(JSON.parse(signed[0].body).tx_bytes, 'base64');
  assert.deepEqual(hybridFormatFailures(raw, { classicalPublicKeyHex: account.publicKey, pqcPublicKey: account.pqc.publicKey, plan: { ...TEST_PLAN, timeoutHeight: r.result.simulationTimeoutHeight } }), []);
  assert.equal(TxBody.decode(TxRaw.decode(raw).bodyBytes).timeoutHeight, HEIGHT + BigInt(SIMULATION_TIMEOUT_BLOCKS));
  assert.equal(node.requests.filter(q => q.method === 'POST' && q.path !== '/' && q.path !== '/cosmos/tx/v1beta1/simulate').length, 0);
  allClean(r);
  noLeaks(r.outputs);
  for (const text of r.outputs) assert.equal(text.includes(raw.toString('base64').slice(0, 40)), false, 'signed bytes never printed');
});

test('no confirmation: the record is never read and nothing is signed', async () => {
  for (const answer of ['', 'yes', SIGN_CONFIRMATION.toLowerCase()]) {
    const node = fakeNode();
    const r = await run(node, { answer });
    assert.equal(r.error.message, 'Not confirmed');
    assert.equal(r.spies.calls.readRecord, 0);
    assert.equal(r.spies.calls.signHybrid, 0);
    assert.equal(signedSimulations(node).length, 0);
  }
});

test('wrong network, account, sequence or balance stops before signing', async () => {
  for (const [change, failure, when] of [
    [{ network: 'qorechain-vladi' }, 'Wrong chain id', 'prepare'],
    [{ accountNumber: '99' }, 'Unexpected account number', 'prepare'],
    [{ uqor: '1000' }, 'Insufficient uqor balance', 'prepare'],
    [{ sequence: '2' }, 'Account sequence changed', 'after confirmation'],
    [{ uqor: '1000' }, 'Insufficient uqor balance', 'after confirmation'],
    [{ network: 'qorechain-vladi' }, 'Wrong chain id', 'after confirmation'],
  ]) {
    const node = fakeNode(when === 'prepare' ? change : {});
    const r = await run(node, { onConfirm: when === 'prepare' ? undefined : chain => Object.assign(chain, change) });
    assert.ok(r.error instanceof CheckError, failure + ' ' + when);
    assert.deepEqual(r.error.failures, [failure]);
    assert.equal(r.spies.calls.signHybrid, 0);
    assert.equal(signedSimulations(node).length, 0);
    if (when === 'prepare') assert.equal(r.spies.calls.readRecord, 0);
    else allClean(r);
  }
});

test('a PQC key mismatch or a record for another account stops before signing', async () => {
  // The chain reports another registered key, and the plan expects that key: prepare passes, the record's key does not.
  const node = fakeNode({ pqcKey: other.pqc.publicKey });
  const r = await run(node);
  assert.deepEqual(r.error.failures, ['Registered PQC key is not the expected key'], 'prepare refuses a registered key that is not the planned one');
  assert.equal(r.spies.calls.readRecord, 0);
  const mismatchPlanNode = fakeNode({ pqcKey: other.pqc.publicKey });
  const s = spies();
  const outputs = [];
  await assert.rejects(runSignAndSimulate({
    network: mismatchPlanNode.network, plan: { ...TEST_PLAN, pqcPublicKeySha256: sha(other.pqc.publicKey) }, expected: EXPECTED, deps: s.deps,
    readRecord: () => recordBytes(), confirm: async () => SIGN_CONFIRMATION, write: o => outputs.push(o),
  }), /Record PQC key is not the registered key/);
  assert.equal(s.calls.signHybrid, 0);
  for (const secret of s.secrets) assert.ok(allZero(secret));

  const wrongAccount = fakeNode();
  const r2 = await run(wrongAccount, { expected: { native: 'qor1dfw567en2l0edze2xqzqw8kwnrcpt3u5m9n88r', evm: '0x6a5d4D7B3357df968b2A3004071eCe98f015C794' } });
  assert.equal(r2.error.message, 'Recovery record does not derive the expected account');
  assert.equal(r2.spies.calls.signHybrid, 0);
  allClean(r2);
});

test('a wrong classical key, corrupted hybrid signature, wrong sign bytes, or changed body or fee never reaches the simulation', async () => {
  const cases = [
    ['wrong classical key', p => sdk.signHybridEth({ ...p, account: { ...p.account, privateKey: other.privateKey } }), ['Classical signature does not verify']],
    ['wrong PQC key', p => sdk.signHybridEth({ ...p, account: { ...p.account, pqc: other.pqc } }), ['PQC signature does not verify']],
    ['v1 sign bytes', p => sdk.signHybridEth({ ...p, signBytesVersion: 'v1' }), ['PQC signature does not verify']],
    ['wrong chain id in sign bytes', p => sdk.signHybridEth({ ...p, chainId: 'qorechain-vladi' }), ['PQC signature does not verify', 'Classical signature does not verify']],
    ['changed body', p => sdk.signHybridEth({ ...p, memo: 'changed' }), ['Wrong message']],
    ['corrupted hybrid signature', p => {
      const s = sdk.signHybridEth(p);
      const raw = TxRaw.decode(s.txRawBytes);
      const body = TxBody.decode(raw.bodyBytes);
      const ext = sdk.qorechainTypes.pqcHybrid.PQCHybridSignature.decode(body.extensionOptions[0].value);
      ext.pqcSignature[7] ^= 1;
      body.extensionOptions = [sdk.encodeHybridExtension({ algorithm_id: 1, pqc_signature: ext.pqcSignature })];
      return { ...s, txRawBytes: TxRaw.encode(TxRaw.fromPartial({ bodyBytes: TxBody.encode(body).finish(), authInfoBytes: raw.authInfoBytes, signatures: raw.signatures })).finish() };
    }, ['PQC signature does not verify', 'Classical signature does not verify']],
  ];
  for (const [label, sign, failures] of cases) {
    const node = fakeNode();
    const s = spies();
    s.deps.signHybrid = params => { s.calls.signHybrid++; const out = sign(params); s.signedBuffers.push(out.txRawBytes); return out; };
    const r = await run(node, { spies: s });
    assert.ok(r.error instanceof FormatError, label);
    assert.deepEqual(r.error.failures, failures, label);
    assert.equal(failureMessage(r.error), 'Format check failed: ' + failures.join('; '));
    assert.equal(signedSimulations(node).length, 0, label);
    allClean(r);
  }
  const node = fakeNode();
  const s = spies();
  s.deps.signHybrid = params => sdk.signHybridEth({ ...params, fee: { amount: [{ denom: 'uqor', amount: '1' }], gas: '350000' } });
  const r = await run(node, { spies: s });
  assert.equal(r.error.message, 'Signed transaction differs from the plan');
  assert.equal(signedSimulations(node).length, 0);
});

test('failed or unclear simulation answers are reported without retry and without echoing the node', async () => {
  for (const [mode, message] of [
    ['hybrid-rejected', 'Simulation rejected the hybrid signature'],
    ['refused', 'Simulation refused by the node'],
    ['garbage', 'Simulation result unknown'],
    ['network-error', 'Simulation result unknown'],
    ['no-gas', 'Simulation result unknown'],
  ]) {
    const node = fakeNode({ simulateMode: mode });
    const r = await run(node);
    assert.equal(r.error.message, message, mode);
    assert.equal(failureMessage(r.error), message);
    assert.equal(signedSimulations(node).length, 1, 'exactly one signed simulation, no retry');
    assert.equal(JSON.parse(r.outputs.at(-1)).broadcast, false);
    for (const text of r.outputs) assert.equal(/bad gateway|insufficient funds|verification failed|fetch failed/.test(text), false);
    noLeaks(r.outputs, r.error);
    allClean(r);
  }
});

test('failure messages never echo SDK errors or secrets', () => {
  assert.equal(failureMessage(new Error('Invalid mnemonic: ' + PUBLIC_TEST_MNEMONIC)), 'Prepare stopped');
  assert.equal(failureMessage(new FormatError(['PQC signature does not verify', 'leak: ' + PASSWORD + '!'])), 'Format check failed: PQC signature does not verify');
  assert.equal(failureMessage(new Error('Recovery record does not derive the expected account')), 'Recovery record does not derive the expected account');
  assert.equal(failureMessage(undefined), 'Prepare stopped');
});

test('unreadable record bytes are refused and zeroed, and nothing is signed', async () => {
  for (const bytes of [Buffer.from('{not json'), Buffer.alloc(0), Buffer.alloc(5000, 0x20), Buffer.from('null')]) {
    const node = fakeNode();
    const r = await run(node, { record: bytes });
    assert.equal(r.error.message, 'Unreadable recovery record');
    assert.ok(allZero(bytes));
    assert.equal(r.spies.calls.signHybrid, 0);
  }
});

test('every broadcast route is blocked, and the source has none', async () => {
  let calls = 0;
  const fetch = guardedFetch({ rest: REST, evmRpc: EVM_RPC }, async () => { calls++; return new Response('{}'); });
  for (const [url, init] of [
    [REST + '/cosmos/tx/v1beta1/txs', { method: 'POST', body: '{"mode":"BROADCAST_MODE_SYNC"}' }],
    [REST + '/cosmos/tx/v1beta1/txs', { method: 'PUT', body: '{}' }],
    [EVM_RPC, { method: 'POST', body: JSON.stringify({ method: 'eth_sendRawTransaction' }) }],
    [EVM_RPC, { method: 'POST', body: JSON.stringify({ method: 'eth_sendTransaction' }) }],
    ['https://rpc-testnet.qore.host/broadcast_tx_sync', { method: 'POST', body: '{}' }],
    ['https://example.com/cosmos/tx/v1beta1/simulate', { method: 'POST', body: '{}' }],
  ]) await assert.rejects(fetch(url, init), /Network request blocked/);
  assert.equal(calls, 0);
  for (const forbidden of ['/cosmos/tx/v1beta1/txs', 'eth_sendRawTransaction', 'broadcastTx', 'BROADCAST_MODE', 'broadcast_tx', 'signAndBroadcast', 'writeFile', 'console.']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test('the record is read only after the confirmation, and the terminal gate comes first', () => {
  const inOrder = (from, to, steps) => {
    const flow = source.slice(source.indexOf(from), source.indexOf(to));
    const order = steps.map(step => flow.indexOf(step));
    assert.ok(order.every(i => i > 0), from + ': ' + steps[order.findIndex(i => i <= 0)]);
    assert.deepEqual(order, [...order].sort((a, b) => a - b), from);
  };
  inOrder('export async function runSignAndSimulate', 'export function failureMessage', ['prepareHybridSelfSend(', 'confirm(SIGN_CONFIRMATION)', 'readParsedRecord(readRecord)', 'withVerifiedAccount(', 'presignChecks(', 'signPlanned(', 'hybridFormatFailures(', 'simulateSigned(']);
  inOrder('export async function runSignAndVerifyLocal', 'export async function runSignAndSimulate', ['prepareHybridSelfSend(', 'confirm(LOCAL_CONFIRMATION)', 'readParsedRecord(readRecord)', 'withVerifiedAccount(', 'presignChecks(', 'gate.seal()', 'signPlanned(', 'hybridFormatFailures(', 'write(report)']);
  inOrder('async function presignChecks', 'function signPlanned', ['fetchLiveState(', 'prepareFailures(', 'classicalKeyHex(']);
  const local = source.slice(source.indexOf('export async function runSignAndVerifyLocal'), source.indexOf('export async function runSignAndSimulate'));
  assert.equal(/simulateSigned|latestHeight|txHash|tx_bytes|toString\('base64'\)/.test(local), false, 'the local mode has no path that could send or show the signed bytes');
  const main = source.slice(source.indexOf('async function main'));
  assert.ok(main.indexOf('isTTY') < main.indexOf('readRecordBytes(RECORD_PATH)'));
});

test('redirected input is refused before the vault is touched, with no output', () => {
  const result = spawnSync(process.execPath, [scriptPath, '--sign-and-simulate'], { input: SIGN_CONFIRMATION + '\n', encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^Diana hybrid signer stopped: Interactive Windows terminal required\. Nothing was broadcast and no file was written\.\n$/);
  const unknown = spawnSync(process.execPath, [scriptPath, '--broadcast'], { encoding: 'utf8' });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Unknown option/);
});

// ---- SIGN-AND-VERIFY-LOCAL ----

async function runLocal(node, options = {}) {
  const s = options.spies ?? spies();
  const outputs = [];
  const prompts = [];
  const bytes = options.record ?? recordBytes();
  // Every request that reaches the fake transport, with the moment it happened relative to signing.
  let result;
  let error;
  try {
    result = await runSignAndVerifyLocal({
      network: node.network, plan: TEST_PLAN, expected: EXPECTED, deps: s.deps,
      readRecord: () => { s.calls.readRecord++; return bytes; },
      confirm: async phrase => { prompts.push(phrase); options.onConfirm?.(node.chain); return options.answer ?? LOCAL_CONFIRMATION; },
      write: r => outputs.push(JSON.stringify(r)),
    });
  } catch (e) {
    error = e;
  }
  return { result, error, outputs, prompts, bytes, spies: s };
}

/** Records the request count when signing starts, so a test can prove nothing reached the network afterwards. */
function markSigning(s, node) {
  const marks = {};
  const sign = s.deps.signHybrid;
  s.deps.signHybrid = params => { marks.requestsAtSigning = node.requests.length; const out = sign(params); marks.signed = out; return out; };
  return marks;
}

test('sign-and-verify-local: signs exactly the plan, verifies both signatures locally, and sends nothing after signing', async () => {
  const node = fakeNode();
  const s = spies();
  const marks = markSigning(s, node);
  const r = await runLocal(node, { spies: s });
  assert.equal(r.error, undefined);
  assert.deepEqual(r.prompts, [LOCAL_CONFIRMATION]);
  assert.equal(r.result.mode, 'sign-and-verify-local');
  assert.equal(r.result.signed, true);
  assert.equal(r.result.sentToNetwork, false);
  assert.equal(r.result.broadcast, false);
  assert.equal(r.result.formatCheck, 'pass');
  assert.equal(r.result.matchesPrepare, true, 'same B0, auth info and PQC sign bytes as PREPARE printed');
  assert.equal(r.result.chainId, 'qorechain-diana');
  assert.equal(r.result.accountNumber, '16046');
  assert.equal(r.result.sequence, '1');
  assert.equal(r.result.feeCeiling, '52500uqor');
  assert.equal(marks.requestsAtSigning, node.requests.length, 'no request of any kind after signing');
  assert.equal(signedSimulations(node).length, 0, 'the signed bytes never reached the simulation route');
  // The only simulation is PREPARE's placeholder one, before the record was read.
  assert.equal(simulations(node).length, 1);
  allClean(r);
  for (const buffer of [marks.signed.txRawBytes, marks.signed.bodyBytes, marks.signed.classicalSignature]) assert.ok(allZero(buffer), 'signed bytes zeroed');
  noLeaks(r.outputs);
  for (const text of r.outputs) assert.equal(/txRaw|tx_bytes|simulationTxHash/.test(text), false);
});

test('sign-and-verify-local: the signed transaction is exactly the planned one, with no timeout height', async () => {
  const node = fakeNode();
  const s = spies();
  let copy;
  const sign = s.deps.signHybrid;
  s.deps.signHybrid = params => { const out = sign(params); copy = Buffer.from(out.txRawBytes); return out; };
  const r = await runLocal(node, { spies: s });
  assert.equal(r.error, undefined);
  assert.deepEqual(hybridFormatFailures(copy, { classicalPublicKeyHex: account.publicKey, pqcPublicKey: account.pqc.publicKey, plan: TEST_PLAN }), []);
  assert.equal(TxBody.decode(TxRaw.decode(copy).bodyBytes).timeoutHeight, 0n);
});

test('sign-and-verify-local: a wrong signature stops with a format failure and still sends nothing', async () => {
  for (const [label, sign, failures] of [
    ['wrong classical key', p => sdk.signHybridEth({ ...p, account: { ...p.account, privateKey: other.privateKey } }), ['Classical signature does not verify']],
    ['wrong PQC key', p => sdk.signHybridEth({ ...p, account: { ...p.account, pqc: other.pqc } }), ['PQC signature does not verify']],
    ['v1 sign bytes', p => sdk.signHybridEth({ ...p, signBytesVersion: 'v1' }), ['PQC signature does not verify']],
    ['wrong chain id', p => sdk.signHybridEth({ ...p, chainId: 'qorechain-vladi' }), ['PQC signature does not verify', 'Classical signature does not verify']],
    ['wrong account number', p => sdk.signHybridEth({ ...p, accountNumber: 16047n }), ['Classical signature does not verify']],
    ['changed body', p => sdk.signHybridEth({ ...p, memo: 'changed' }), ['Wrong message']],
  ]) {
    const node = fakeNode();
    const s = spies();
    let signed;
    s.deps.signHybrid = params => { signed = sign(params); return signed; };
    const r = await runLocal(node, { spies: s });
    assert.ok(r.error instanceof FormatError, label);
    assert.deepEqual(r.error.failures, failures, label);
    assert.equal(signedSimulations(node).length, 0);
    assert.ok(allZero(signed.txRawBytes), label + ': signed bytes zeroed on failure');
    allClean(r);
  }
  for (const [label, change] of [['fee', { fee: { amount: [{ denom: 'uqor', amount: '1' }], gas: '350000' } }], ['sequence', { sequence: 2n }]]) {
    const node = fakeNode();
    const s = spies();
    s.deps.signHybrid = params => sdk.signHybridEth({ ...params, ...change });
    const r = await runLocal(node, { spies: s });
    assert.equal(r.error.message, 'Signed transaction differs from the plan', label);
  }
});

test('sign-and-verify-local: a changed sequence or PQC registration stops before signing', async () => {
  for (const [change, failure] of [
    [{ sequence: '2' }, 'Account sequence changed'],
    [{ pqcFound: false }, 'PQC key not registered'],
    [{ pqcKey: other.pqc.publicKey }, 'Registered PQC key is not the expected key'],
  ]) {
    const node = fakeNode();
    const r = await runLocal(node, { onConfirm: chain => Object.assign(chain, change) });
    assert.ok(r.error instanceof CheckError, failure);
    assert.deepEqual(r.error.failures, [failure]);
    assert.equal(r.spies.calls.signHybrid, 0);
    allClean(r);
  }
});

test('sign-and-verify-local: a refused confirmation never opens the record or signs', async () => {
  for (const answer of ['', 'no', SIGN_CONFIRMATION, LOCAL_CONFIRMATION.toLowerCase()]) {
    const node = fakeNode();
    const r = await runLocal(node, { answer });
    assert.equal(r.error.message, 'Not confirmed', answer);
    assert.equal(r.spies.calls.readRecord, 0);
    assert.equal(r.spies.calls.signHybrid, 0);
  }
});

test('sign-and-verify-local: attempts to send the signed bytes over the network after signing are refused', async () => {
  // A signer that, right after signing, tries every route to push the signed bytes out: through a
  // network gate sealed at signing (as the tool's own is) and through the base guard itself.
  const node = fakeNode();
  const gate = sealableNetwork(node.network);
  const s = spies();
  const attempts = [];
  let requestsAtSigning;
  const sign = s.deps.signHybrid;
  s.deps.signHybrid = params => {
    gate.seal();
    requestsAtSigning = node.requests.length;
    const out = sign(params);
    const b64 = Buffer.from(out.txRawBytes).toString('base64');
    const body = JSON.stringify({ tx_bytes: b64, mode: 'BROADCAST_MODE_SYNC' });
    for (const fetch of [gate.network.fetch]) {
      attempts.push(fetch(REST + '/cosmos/tx/v1beta1/simulate', { method: 'POST', body }));
      attempts.push(fetch(REST + '/cosmos/auth/v1beta1/accounts/x?leak=' + encodeURIComponent(b64.slice(0, 64))));
      attempts.push(fetch(EVM_RPC, { method: 'POST', body: JSON.stringify({ method: 'eth_chainId', params: [b64] }) }));
    }
    attempts.push(node.network.fetch(REST + '/cosmos/tx/v1beta1/txs', { method: 'POST', body }));
    attempts.push(node.network.fetch(EVM_RPC, { method: 'POST', body: JSON.stringify({ method: 'eth_sendRawTransaction', params: [b64] }) }));
    return out;
  };
  const r = await runLocal(node, { spies: s });
  assert.equal(r.error, undefined);
  const outcomes = await Promise.all(attempts.map(p => p.then(() => 'sent', e => e.message)));
  assert.deepEqual(outcomes, Array(5).fill('Network request blocked'));
  assert.equal(node.requests.length, requestsAtSigning, 'nothing reached the transport after signing');
});

test('the tool seals its network: after sealing, even a read is refused before the transport', async () => {
  const node = fakeNode();
  const gate = sealableNetwork(node.network);
  await gate.network.fetch(REST + '/cosmos/base/tendermint/v1beta1/node_info');
  gate.seal();
  for (const [url, init] of [
    [REST + '/cosmos/base/tendermint/v1beta1/node_info', {}],
    [REST + '/cosmos/tx/v1beta1/simulate', { method: 'POST', body: '{}' }],
    [EVM_RPC, { method: 'POST', body: JSON.stringify({ method: 'eth_chainId' }) }],
  ]) await assert.rejects(gate.network.fetch(url, init), /Network request blocked/);
  assert.equal(node.requests.length, 1);
});

test('the local mode needs an interactive terminal and refuses redirected input with no output', () => {
  const result = spawnSync(process.execPath, [scriptPath, '--sign-and-verify-local'], { input: LOCAL_CONFIRMATION + '\n', encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^Diana hybrid signer stopped: Interactive Windows terminal required\. Nothing was broadcast and no file was written\.\n$/);
});
