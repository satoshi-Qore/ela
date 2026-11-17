import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as sdk from '@qorechain/sdk';
import { TxBody, TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import { CheckError, PLAN, hybridFormatFailures } from '../diana-hybrid-prepare.mjs';
import { FormatError } from '../diana-hybrid-sign.mjs';
import { guardedFetch } from '../diana-register-pqc.mjs';
import {
  BROADCAST_CONFIRMATION, BROADCAST_TIMEOUT_BLOCKS, MIN_BLOCKS_LEFT, SIGN_CONFIRMATION, failureMessage, runHybridBroadcast,
} from '../diana-hybrid-broadcast.mjs';

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
const scriptPath = fileURLToPath(new URL('../diana-hybrid-broadcast.mjs', import.meta.url));
const source = readFileSync(scriptPath, 'utf8');
const SECRETS = [PUBLIC_TEST_MNEMONIC, 'abandon', PASSWORD, account.privateKey.slice(2, 34), Buffer.from(account.pqc.secretKey).toString('hex').slice(0, 32)];
const recordBytes = () => Buffer.from(JSON.stringify({ mnemonic: PUBLIC_TEST_MNEMONIC, password: PASSWORD, index: 0, sdkVersion: '0.14.0' }));
const HEIGHT = 10240000n;

// A fake Diana node behind the real guard; no real network request is made by these tests.
function fakeNode(overrides = {}) {
  const chain = {
    network: 'qorechain-diana', evmChainId: '0x2648', accountNumber: '16046', sequence: '1', height: HEIGHT,
    pubKey: Buffer.from(account.publicKey.slice(2), 'hex').toString('base64'), uqor: '99910000',
    pqcFound: true, pqcKey: account.pqc.publicKey, minGasPrice: '0.1', placeholderGas: 186999, signedGas: 227413,
    simulateMode: 'ok', broadcastMode: 'ok', ...overrides,
  };
  const requests = [];
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = (init.method ?? 'GET').toUpperCase();
    requests.push({ method, path: u.pathname, body: init.body });
    if (u.host === new URL(EVM_RPC).host) return json(200, { result: chain.evmChainId });
    if (u.pathname === '/cosmos/base/tendermint/v1beta1/node_info') return json(200, { default_node_info: { network: chain.network } });
    if (u.pathname === '/cosmos/base/tendermint/v1beta1/blocks/latest') return json(200, { block: { header: { height: String(chain.height) } } });
    if (u.pathname.startsWith('/cosmos/auth/v1beta1/accounts/')) return json(200, { account: { '@type': '/cosmos.auth.v1beta1.BaseAccount', pub_key: { '@type': sdk.ETHSECP256K1_PUBKEY_TYPE, key: chain.pubKey }, account_number: chain.accountNumber, sequence: chain.sequence } });
    if (u.pathname.includes('/by_denom')) return json(200, { balance: { denom: 'uqor', amount: chain.uqor } });
    if (u.pathname.startsWith('/qorechain/pqc/v1/account/')) return json(200, chain.pqcFound ? { found: true, account: { algorithm_id: 1, public_key: Buffer.from(chain.pqcKey).toString('base64') } } : { found: false, account: null });
    if (u.pathname === '/cosmos/evm/feemarket/v1/params') return json(200, { params: { min_gas_price: chain.minGasPrice } });
    if (u.pathname === '/qorechain/pqc/v1/protocol_features') return json(200, { features: [{ name: 'pqc-sign-bytes-v2', enabled: true }] });
    if (u.pathname === '/cosmos/tx/v1beta1/simulate') {
      const raw = TxRaw.decode(Buffer.from(JSON.parse(init.body).tx_bytes, 'base64'));
      if (allZero(raw.signatures[0])) return json(200, { gas_info: { gas_used: String(chain.placeholderGas) } });
      chain.onSignedSimulate?.(chain);
      if (chain.simulateMode === 'refused') return json(400, { code: 5, message: 'insufficient funds' });
      if (chain.simulateMode === 'garbage') return new Response('<html>bad gateway</html>', { status: 502 });
      return json(200, { gas_info: { gas_used: String(chain.signedGas) } });
    }
    if (u.pathname === '/cosmos/tx/v1beta1/txs') {
      const bytes = Buffer.from(JSON.parse(init.body).tx_bytes, 'base64');
      if (chain.broadcastMode === 'network-error') throw new TypeError('fetch failed');
      if (chain.broadcastMode === 'garbage') return new Response('<html>gateway timeout</html>', { status: 504 });
      if (chain.broadcastMode === 'refused') return json(200, { tx_response: { txhash: sha(bytes).toUpperCase(), code: 32, codespace: 'sdk', raw_log: 'account sequence mismatch ' + PUBLIC_TEST_MNEMONIC } });
      if (chain.broadcastMode === 'other-hash') return json(200, { tx_response: { txhash: 'AB'.repeat(32), code: 0 } });
      return json(200, { tx_response: { txhash: sha(bytes).toUpperCase(), code: 0 } });
    }
    return json(404, { message: 'not found' });
  };
  const allowBroadcast = { value: false };
  return { chain, requests, network: { rest: REST, evmRpc: EVM_RPC, allowBroadcast, fetch: guardedFetch({ rest: REST, evmRpc: EVM_RPC }, { allowBroadcast: () => allowBroadcast.value, fetchImpl }) } };
}

function spies() {
  const secrets = [];
  const signed = [];
  const calls = { readRecord: 0, signHybrid: 0 };
  return {
    secrets, signed, calls,
    deps: {
      derive: async (m, i) => { const a = await sdk.deriveUnifiedAccount(m, i); secrets.push(a.pqc.secretKey); return a; },
      canonical: (address, m) => { const k = sdk.derivePqcCanonical(address, m); secrets.push(k.secretKey); return k; },
      signHybrid: params => { calls.signHybrid++; const s = sdk.signHybridEth(params); signed.push(s); return s; },
    },
  };
}

async function run(node, options = {}) {
  const s = options.spies ?? spies();
  const outputs = [];
  const prompts = [];
  const answers = [...(options.answers ?? [SIGN_CONFIRMATION, BROADCAST_CONFIRMATION])];
  const bytes = recordBytes();
  let result;
  let error;
  try {
    result = await runHybridBroadcast({
      network: node.network, plan: TEST_PLAN, expected: EXPECTED, deps: s.deps,
      readRecord: () => { s.calls.readRecord++; return bytes; },
      confirm: async phrase => { prompts.push(phrase); options.onConfirm?.(phrase, node.chain); return answers.shift() ?? ''; },
      write: r => outputs.push(JSON.stringify(r)),
    });
  } catch (e) {
    error = e;
  }
  return { result, error, outputs, prompts, bytes, spies: s };
}
const broadcasts = node => node.requests.filter(r => r.path === '/cosmos/tx/v1beta1/txs');
const signedSims = node => node.requests.filter(r => r.path === '/cosmos/tx/v1beta1/simulate' && !allZero(TxRaw.decode(Buffer.from(JSON.parse(r.body).tx_bytes, 'base64')).signatures[0]));
const clean = r => {
  assert.ok(allZero(r.bytes), 'record bytes zeroed');
  for (const secret of r.spies.secrets) assert.ok(allZero(secret), 'PQC secret zeroed');
  for (const s of r.spies.signed) assert.ok(allZero(s.txRawBytes) && allZero(s.bodyBytes), 'signed bytes zeroed');
};
const noLeaks = r => {
  for (const text of [...r.outputs, r.error ? failureMessage(r.error) : '']) for (const secret of SECRETS) assert.equal(text.includes(secret), false);
  for (const s of r.spies.signed) for (const text of r.outputs) assert.equal(text.includes(Buffer.from(s.bodyBytes).toString('base64').slice(0, 40)), false);
};

test('the full flow: two confirmations, one signature, the same bytes simulated and broadcast once', async () => {
  const node = fakeNode();
  const r = await run(node);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.prompts, [SIGN_CONFIRMATION, BROADCAST_CONFIRMATION]);
  assert.equal(r.spies.calls.signHybrid, 1);
  assert.equal(r.result.broadcast, 'ACCEPTED');
  assert.equal(r.result.code, 0);
  assert.equal(r.result.gasUsed, 227413);
  assert.equal(r.result.exactHybridGas, sdk.exactHybridGas(227413));
  assert.equal(r.result.timeoutHeight, String(HEIGHT + BigInt(BROADCAST_TIMEOUT_BLOCKS)));
  assert.match(r.result.txHash, /^[0-9A-F]{64}$/);
  assert.match(r.result.verify.account, /expect sequence 2/);
  const sims = signedSims(node);
  const sent = broadcasts(node);
  assert.equal(sims.length, 1);
  assert.equal(sent.length, 1);
  const simulated = JSON.parse(sims[0].body).tx_bytes;
  const broadcast = JSON.parse(sent[0].body).tx_bytes;
  assert.equal(broadcast, simulated, 'simulated and broadcast bytes are identical');
  assert.equal(sha(Buffer.from(broadcast, 'base64')).toUpperCase(), r.result.txHash);
  assert.equal(JSON.parse(sent[0].body).mode, 'BROADCAST_MODE_SYNC');
  const raw = Buffer.from(broadcast, 'base64');
  assert.deepEqual(hybridFormatFailures(raw, { classicalPublicKeyHex: account.publicKey, pqcPublicKey: account.pqc.publicKey, plan: { ...TEST_PLAN, timeoutHeight: r.result.timeoutHeight } }), []);
  assert.equal(TxBody.decode(TxRaw.decode(raw).bodyBytes).timeoutHeight, HEIGHT + BigInt(BROADCAST_TIMEOUT_BLOCKS));
  assert.equal(node.network.allowBroadcast.value, false);
  // Order on the wire: the signed simulation strictly before the broadcast.
  assert.ok(node.requests.indexOf(sims[0]) < node.requests.indexOf(sent[0]));
  clean(r);
  noLeaks(r);
});

test('missing or wrong confirmations: nothing signed without the first, nothing sent without the second', async () => {
  for (const answers of [[], ['yes'], [SIGN_CONFIRMATION.toLowerCase()], [BROADCAST_CONFIRMATION, SIGN_CONFIRMATION]]) {
    const node = fakeNode();
    const r = await run(node, { answers });
    assert.equal(r.error.message, 'Not confirmed');
    assert.equal(r.spies.calls.readRecord, 0, 'record not read');
    assert.equal(r.spies.calls.signHybrid, 0);
    assert.equal(broadcasts(node).length, 0);
  }
  for (const second of ['', 'yes', SIGN_CONFIRMATION, BROADCAST_CONFIRMATION.toLowerCase()]) {
    const node = fakeNode();
    const r = await run(node, { answers: [SIGN_CONFIRMATION, second] });
    assert.equal(r.error.message, 'Not confirmed');
    assert.equal(r.spies.calls.signHybrid, 1);
    assert.equal(broadcasts(node).length, 0, 'signed and simulated but never sent');
    clean(r);
  }
});

test('wrong network, account, sequence, PQC key or balance stops before signing', async () => {
  for (const [change, failure] of [
    [{ network: 'qorechain-vladi' }, 'Wrong chain id'],
    [{ evmChainId: '0x2649' }, 'Wrong chain id'],
    [{ accountNumber: '99' }, 'Unexpected account number'],
    [{ sequence: '2' }, 'Account sequence changed'],
    [{ pqcKey: other.pqc.publicKey }, 'Registered PQC key is not the expected key'],
    [{ pqcFound: false }, 'PQC key not registered'],
    [{ uqor: '52500' }, 'Insufficient uqor balance'],
  ]) {
    for (const when of ['prepare', 'before signing']) {
      const node = fakeNode(when === 'prepare' ? change : {});
      const r = await run(node, { onConfirm: (phrase, chain) => { if (when !== 'prepare' && phrase === SIGN_CONFIRMATION) Object.assign(chain, change); } });
      assert.ok(r.error instanceof CheckError, failure + ' ' + when);
      assert.deepEqual(r.error.failures, [failure]);
      assert.equal(r.spies.calls.signHybrid, 0);
      assert.equal(broadcasts(node).length, 0);
    }
  }
});

test('a change between the confirmations stops the broadcast', async () => {
  for (const [change, failure] of [
    [{ sequence: '2' }, 'Account sequence changed'],
    [{ pqcKey: other.pqc.publicKey }, 'Registered PQC key is not the expected key'],
    [{ uqor: '100' }, 'Insufficient uqor balance'],
    [{ network: 'qorechain-vladi' }, 'Wrong chain id'],
  ]) {
    const node = fakeNode();
    const r = await run(node, { onConfirm: (phrase, chain) => { if (phrase === BROADCAST_CONFIRMATION) Object.assign(chain, change); } });
    assert.ok(r.error instanceof CheckError, failure);
    assert.deepEqual(r.error.failures, [failure]);
    assert.equal(broadcasts(node).length, 0);
    clean(r);
  }
  const node = fakeNode();
  const late = await run(node, { onConfirm: (phrase, chain) => { if (phrase === BROADCAST_CONFIRMATION) chain.height = HEIGHT + BigInt(BROADCAST_TIMEOUT_BLOCKS - MIN_BLOCKS_LEFT + 1); } });
  assert.equal(late.error.message, 'Timeout height too close');
  assert.equal(broadcasts(node).length, 0);
});

test('an invalid hybrid signature or a changed body or fee is never simulated or sent', async () => {
  for (const [label, sign, check] of [
    ['wrong classical key', p => sdk.signHybridEth({ ...p, account: { ...p.account, privateKey: other.privateKey } }), e => e instanceof FormatError && e.failures.includes('Classical signature does not verify')],
    ['wrong PQC key', p => sdk.signHybridEth({ ...p, account: { ...p.account, pqc: other.pqc } }), e => e instanceof FormatError && e.failures.includes('PQC signature does not verify')],
    ['v1 sign bytes', p => sdk.signHybridEth({ ...p, signBytesVersion: 'v1' }), e => e instanceof FormatError],
    ['changed body', p => sdk.signHybridEth({ ...p, memo: 'changed' }), e => e instanceof FormatError && e.failures.includes('Wrong message')],
    ['changed amount', p => sdk.signHybridEth({ ...p, messages: [{ ...p.messages[0], value: { ...p.messages[0].value, amount: [{ denom: 'uqor', amount: '1000000' }] } }] }), e => e instanceof FormatError && e.failures.includes('Wrong message')],
    ['changed fee', p => sdk.signHybridEth({ ...p, fee: { amount: [{ denom: 'uqor', amount: '1' }], gas: '350000' } }), e => e.message === 'Signed transaction differs from the plan'],
    ['changed sequence', p => sdk.signHybridEth({ ...p, sequence: 5n }), e => e.message === 'Signed transaction differs from the plan'],
  ]) {
    const node = fakeNode();
    const s = spies();
    s.deps.signHybrid = params => { const out = sign(params); s.signed.push(out); return out; };
    const r = await run(node, { spies: s });
    assert.ok(check(r.error), label + ': ' + r.error?.message);
    assert.equal(signedSims(node).length, 0, label);
    assert.equal(broadcasts(node).length, 0, label);
    clean(r);
  }
});

test('a failed simulation or gas above the limit blocks the broadcast', async () => {
  for (const [change, message] of [
    [{ simulateMode: 'refused' }, 'Simulation did not succeed'],
    [{ simulateMode: 'garbage' }, 'Simulation did not succeed'],
    [{ signedGas: 345000 }, 'Simulated gas exceeds the gas limit'],
  ]) {
    const node = fakeNode(change);
    const r = await run(node);
    assert.equal(r.error.message, message);
    assert.equal(failureMessage(r.error), message);
    assert.deepEqual(r.prompts, [SIGN_CONFIRMATION], 'no broadcast confirmation is even asked');
    assert.equal(broadcasts(node).length, 0);
    clean(r);
  }
});

test('a lost or unclear broadcast answer is UNKNOWN, reported with the hash and timeout height, never retried', async () => {
  for (const broadcastMode of ['network-error', 'garbage']) {
    const node = fakeNode({ broadcastMode });
    const r = await run(node);
    assert.equal(r.error.message, 'Broadcast result unknown');
    assert.equal(broadcasts(node).length, 1, 'exactly one attempt');
    const last = JSON.parse(r.outputs.at(-1));
    assert.equal(last.broadcast, 'UNKNOWN');
    assert.match(last.txHash, /^[0-9A-F]{64}$/);
    assert.equal(last.verify.lastIncludableHeight, String(HEIGHT + BigInt(BROADCAST_TIMEOUT_BLOCKS)));
    assert.match(last.next, /Do not re-run/);
    assert.equal(node.network.allowBroadcast.value, false);
    assert.equal(r.outputs.some(t => /gateway timeout|fetch failed/.test(t)), false);
    clean(r);
    noLeaks(r);
  }
  const refused = fakeNode({ broadcastMode: 'refused' });
  const r = await run(refused);
  assert.equal(r.error.message, 'Broadcast refused by the node');
  assert.equal(JSON.parse(r.outputs.at(-1)).code, 32);
  assert.equal(r.outputs.some(t => t.includes('sequence mismatch')), false, 'the node log is not echoed');
  noLeaks(r);
  const mismatch = fakeNode({ broadcastMode: 'other-hash' });
  assert.equal((await run(mismatch)).error.message, 'Broadcast hash mismatch');
});

test('the same transaction cannot be sent twice', async () => {
  // Within one run: the guard passes the broadcast route at most once, even if it is opened again.
  let calls = 0;
  const fetch = guardedFetch({ rest: REST, evmRpc: EVM_RPC }, { allowBroadcast: () => true, fetchImpl: async () => { calls++; return new Response('{}'); } });
  await fetch(REST + '/cosmos/tx/v1beta1/txs', { method: 'POST', body: '{}' });
  await assert.rejects(fetch(REST + '/cosmos/tx/v1beta1/txs', { method: 'POST', body: '{}' }), /Network request blocked/);
  assert.equal(calls, 1);
  // Across runs: once the first is on chain the sequence has moved, and a second run stops before signing.
  const node = fakeNode({ sequence: '2', uqor: '99857500' });
  const r = await run(node);
  assert.deepEqual(r.error.failures, ['Account sequence changed']);
  assert.equal(r.spies.calls.readRecord, 0);
  assert.equal(broadcasts(node).length, 0);
  // The broadcast route stays closed outside the single attempt.
  const guard = fakeNode();
  await assert.rejects(guard.network.fetch(REST + '/cosmos/tx/v1beta1/txs', { method: 'POST', body: '{}' }), /Network request blocked/);
  await assert.rejects(guard.network.fetch(EVM_RPC, { method: 'POST', body: JSON.stringify({ method: 'eth_sendRawTransaction' }) }), /Network request blocked/);
});

test('failure messages never echo SDK errors, node logs or secrets', () => {
  assert.equal(failureMessage(new Error('Invalid mnemonic: ' + PUBLIC_TEST_MNEMONIC)), 'Prepare stopped');
  assert.equal(failureMessage(new Error('Broadcast result unknown')), 'Broadcast result unknown');
  assert.equal(failureMessage(new CheckError(['Account sequence changed', PASSWORD])), 'Check failed: Account sequence changed');
  assert.equal(failureMessage(new FormatError(['PQC signature does not verify', 'x: ' + PASSWORD + '!'])), 'Format check failed: PQC signature does not verify');
});

test('order and reuse: one signing path, record read after the first confirmation, broadcast after the second', () => {
  const flow = source.slice(source.indexOf('export async function runHybridBroadcast'), source.indexOf('export function failureMessage'));
  const steps = ['prepareHybridSelfSend(', 'confirm(SIGN_CONFIRMATION)', 'readParsedRecord(readRecord)', 'presignChecks(', 'signPlanned(', 'hybridFormatFailures(', 'simulateSigned(signed.txRawBytes', 'exactHybridGas', 'confirm(BROADCAST_CONFIRMATION)', 'fetchLiveState(', 'Timeout height too close', 'broadcastOnce(signed.txRawBytes'];
  const order = steps.map(s => flow.indexOf(s));
  assert.ok(order.every(i => i > 0), steps[order.findIndex(i => i <= 0)]);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.equal([...flow.matchAll(/signPlanned\(/g)].length, 1, 'signed once');
  assert.equal([...source.matchAll(/broadcastOnce\(/g)].length, 2, 'one definition, one call');
  assert.equal([...source.matchAll(/allowBroadcast\.value = true/g)].length, 1);
  for (const forbidden of ['signHybridEth(', 'signClassicalEth', 'pqcSign(', 'eth_sendRawTransaction', 'writeFile', 'console.', 'for (', 'while (', 'retry']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  const main = source.slice(source.indexOf('async function main'));
  assert.ok(main.indexOf('isTTY') < main.indexOf('readRecordBytes(RECORD_PATH)'));
});

test('redirected input is refused before the vault is touched, with no output', () => {
  const result = spawnSync(process.execPath, [scriptPath, '--broadcast'], { input: SIGN_CONFIRMATION + '\n' + BROADCAST_CONFIRMATION + '\n', encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^Diana hybrid broadcast stopped: Interactive Windows terminal required\. No file was written\.\n$/);
  assert.match(spawnSync(process.execPath, [scriptPath, '--yes'], { encoding: 'utf8' }).stderr, /Unknown option/);
});
