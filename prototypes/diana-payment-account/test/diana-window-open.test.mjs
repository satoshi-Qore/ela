import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as sdk from '@qorechain/sdk';
import { TxBody, TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import { CheckError, PLAN as SELF_SEND_PLAN, hybridFormatFailures } from '../diana-hybrid-prepare.mjs';
import { FormatError } from '../diana-hybrid-sign.mjs';
import { WINDOW_PLAN, WindowCheckError } from '../diana-window-prepare.mjs';
import {
  BROADCAST_TIMEOUT_BLOCKS, LOCAL_CONFIRMATION, MIN_BLOCKS_LEFT, OPEN_WINDOW_TYPE_URL, SIGNING_LIMITS, VERIFY_FAILURES,
  broadcastConfirmation, failureMessage, parseArgs, runWindowBroadcast, runWindowSignLocal, signConfirmation, stateFingerprint,
  verifyOpenedWindow, windowFormatFailures, windowGuardedFetch, windowIntent, windowMessage,
} from '../diana-window-open.mjs';

// Public BIP-39 test mnemonic (all-"abandon" vector). It is not an ELA account and holds nothing.
const PUBLIC_TEST_MNEMONIC = Array(11).fill('abandon').concat('about').join(' ');
const PASSWORD = 'public-test-password';
const account = await sdk.deriveUnifiedAccount(PUBLIC_TEST_MNEMONIC, 0);
const other = await sdk.deriveUnifiedAccount(PUBLIC_TEST_MNEMONIC, 1);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const TEST_PLAN = Object.freeze({ ...WINDOW_PLAN, native: account.cosmos, evm: account.evm, pqcPublicKeySha256: sha(account.pqc.publicKey) });
const EXPECTED = Object.freeze({ native: account.cosmos, evm: account.evm });
const { rest: REST, evmRpc: EVM_RPC } = sdk.NETWORKS.testnet.endpoints;
const ARTIFACT = Object.freeze({ bytecode: '0x6080604052', compiler: '0.8.28+commit.7893614a', evmVersion: 'paris', sourceKeccak: '0x' + '00'.repeat(32) });
const NOW = () => 1795000000;
const HEIGHT = 10240000n;
const MAX_VALUE = 256500n;
const FEE = 52500n;
const SIGN_PHRASE = 'SIGN EVM WINDOW 400 BLOCKS 1 TX 256500 UQOR FOR 16046';
const allZero = bytes => bytes.every(b => b === 0);
const scriptPath = fileURLToPath(new URL('../diana-window-open.mjs', import.meta.url));
const source = readFileSync(scriptPath, 'utf8');
const SECRETS = [PUBLIC_TEST_MNEMONIC, 'abandon', PASSWORD, account.privateKey.slice(2, 34), Buffer.from(account.pqc.secretKey).toString('hex').slice(0, 32)];
const recordBytes = () => Buffer.from(JSON.stringify({ mnemonic: PUBLIC_TEST_MNEMONIC, password: PASSWORD, index: 0, sdkVersion: '0.14.0' }));

// A fake Diana node behind the real guard; no real network request is made by these tests.
function fakeNode(overrides = {}) {
  const chain = {
    network: 'qorechain-diana', evmChainId: '0x2648', accountNumber: '16046', sequence: '2', evmNonce: '0x2', height: HEIGHT,
    pubKey: Buffer.from(account.publicKey.slice(2), 'hex').toString('base64'), uqor: '99857500',
    pqcFound: true, pqcKey: account.pqc.publicKey, signBytesV2: true, minGasPrice: '0.1',
    gasPrice: '0x' + (112_500_000_000n).toString(16), baseFee: '0.100000000000000000', window: { found: false, live: false },
    estimateGas: '0x' + (1_365_419).toString(16), placeholderGas: 186690, signedGas: 227100, secondsPerBlock: 1.425,
    simulateMode: 'ok', broadcastMode: 'ok', tx: undefined, ...overrides,
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
      if (m === 'eth_estimateGas') return json(200, { result: chain.estimateGas });
    }
    if (u.pathname === '/cosmos/base/tendermint/v1beta1/node_info') return json(200, { default_node_info: { network: chain.network } });
    if (u.pathname === '/cosmos/base/tendermint/v1beta1/blocks/latest') return json(200, { block: { header: { height: String(chain.height), time: t(chain.height) } } });
    if (u.pathname.startsWith('/cosmos/base/tendermint/v1beta1/blocks/')) { const h = u.pathname.split('/').pop(); return json(200, { block: { header: { height: h, time: t(h) } } }); }
    if (u.pathname.startsWith('/cosmos/auth/v1beta1/accounts/')) return json(200, { account: { '@type': '/cosmos.auth.v1beta1.BaseAccount', pub_key: { '@type': sdk.ETHSECP256K1_PUBKEY_TYPE, key: chain.pubKey }, account_number: chain.accountNumber, sequence: chain.sequence } });
    if (u.pathname.includes('/by_denom')) return json(200, { balance: { denom: 'uqor', amount: chain.uqor } });
    if (u.pathname.startsWith('/qorechain/pqc/v1/account/')) return json(200, chain.pqcFound ? { found: true, account: { algorithm_id: 1, public_key: Buffer.from(chain.pqcKey).toString('base64') } } : { found: false, account: null });
    if (u.pathname === '/cosmos/evm/feemarket/v1/params') return json(200, { params: { min_gas_price: chain.minGasPrice, base_fee: chain.baseFee } });
    if (u.pathname === '/cosmos/evm/vm/v1/params') return json(200, { params: { evm_denom: 'uqor', extended_denom_options: { extended_denom: 'aqor' } } });
    if (u.pathname === '/qorechain/pqc/v1/protocol_features') return json(200, { features: [{ name: 'pqc-sign-bytes-v2', enabled: chain.signBytesV2 }] });
    if (u.pathname.startsWith('/qorechain/pqc/v1/evm_window/')) return json(200, chain.window);
    if (u.pathname === '/cosmos/tx/v1beta1/simulate') {
      const raw = TxRaw.decode(Buffer.from(JSON.parse(init.body).tx_bytes, 'base64'));
      if (allZero(raw.signatures[0])) return json(200, { gas_info: { gas_used: String(chain.placeholderGas) } });
      if (chain.simulateMode === 'refused') return json(400, { code: 11, message: 'out of gas' });
      if (chain.simulateMode === 'garbage') return new Response('<html>bad gateway</html>', { status: 502 });
      return json(200, { gas_info: { gas_used: String(chain.signedGas) } });
    }
    if (u.pathname === '/cosmos/tx/v1beta1/txs' && method === 'POST') {
      const bytes = Buffer.from(JSON.parse(init.body).tx_bytes, 'base64');
      if (chain.broadcastMode === 'network-error') throw new TypeError('fetch failed');
      if (chain.broadcastMode === 'garbage') return new Response('<html>gateway timeout</html>', { status: 504 });
      if (chain.broadcastMode === 'refused') return json(200, { tx_response: { txhash: sha(bytes).toUpperCase(), code: 32, codespace: 'sdk', raw_log: 'account sequence mismatch ' + PUBLIC_TEST_MNEMONIC } });
      if (chain.broadcastMode === 'other-hash') return json(200, { tx_response: { txhash: 'AB'.repeat(32), code: 0 } });
      return json(200, { tx_response: { txhash: sha(bytes).toUpperCase(), code: 0 } });
    }
    if (u.pathname.startsWith('/cosmos/tx/v1beta1/txs/')) return chain.tx ? json(200, chain.tx) : json(404, { code: 5, message: 'tx not found' });
    return json(404, { message: 'not found' });
  };
  const allowBroadcast = { value: false };
  return { chain, requests, network: { rest: REST, evmRpc: EVM_RPC, allowBroadcast, fetch: windowGuardedFetch({ rest: REST, evmRpc: EVM_RPC }, { allowBroadcast: () => allowBroadcast.value, fetchImpl }) } };
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
  const answer = options.answer ?? (phrase => phrase);
  const bytes = recordBytes();
  let result;
  let error;
  try {
    result = await (options.local ? runWindowSignLocal : runWindowBroadcast)({
      network: node.network, plan: TEST_PLAN, expected: EXPECTED, artifact: ARTIFACT, now: NOW, deps: s.deps,
      readRecord: () => { s.calls.readRecord++; return bytes; },
      confirm: async phrase => { prompts.push(phrase); options.onConfirm?.(phrase, node.chain); return answer(phrase, prompts.length); },
      write: r => outputs.push(JSON.stringify(r)),
    });
  } catch (e) {
    error = e;
  }
  return { result, error, outputs, prompts, bytes, spies: s };
}
const broadcasts = node => node.requests.filter(r => r.method === 'POST' && r.path === '/cosmos/tx/v1beta1/txs');
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
const decodeWindow = raw => {
  const body = TxBody.decode(TxRaw.decode(raw).bodyBytes);
  return { body, msg: sdk.qorechainTypes.pqc.MsgOpenEVMWindow.decode(body.messages[0].value) };
};

test('the full flow: window-bound and hash-bound confirmations, one signature, the same bytes simulated and broadcast once', async () => {
  const node = fakeNode();
  const r = await run(node);
  assert.equal(r.error, undefined, r.error && failureMessage(r.error));
  assert.equal(r.prompts[0], SIGN_PHRASE);
  assert.equal(r.prompts[1], broadcastConfirmation(r.result.txHash));
  assert.match(r.prompts[1], /^BROADCAST EVM WINDOW [0-9A-F]{8} TO QORECHAIN-DIANA$/);
  assert.equal(r.spies.calls.signHybrid, 1);
  assert.equal(r.result.broadcast, 'ACCEPTED');
  assert.equal(r.result.code, 0);
  assert.equal(r.result.windowOpened, false, 'accepted into the mempool is not an opened window');
  assert.equal(r.result.timeoutHeight, String(HEIGHT + BigInt(BROADCAST_TIMEOUT_BLOCKS)));
  assert.equal(r.result.expectedDeploymentNonce, '3');
  assert.match(r.result.verify.command, new RegExp('--verify ' + r.result.txHash + '$'));
  const sims = signedSims(node);
  const sent = broadcasts(node);
  assert.equal(sims.length, 1);
  assert.equal(sent.length, 1);
  assert.equal(JSON.parse(sent[0].body).tx_bytes, JSON.parse(sims[0].body).tx_bytes, 'simulated and broadcast bytes are identical');
  assert.equal(JSON.parse(sent[0].body).mode, 'BROADCAST_MODE_SYNC');
  assert.ok(node.requests.indexOf(sims[0]) < node.requests.indexOf(sent[0]));
  const raw = Buffer.from(JSON.parse(sent[0].body).tx_bytes, 'base64');
  assert.equal(sha(raw).toUpperCase(), r.result.txHash);
  // The broadcast transaction is exactly the planned window, nothing else.
  const { body, msg } = decodeWindow(raw);
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].typeUrl, OPEN_WINDOW_TYPE_URL);
  assert.deepEqual(msg, { sender: account.cosmos, blocks: '400', maxTxs: '1', maxValue: '256500', nativeOnly: false, allowedTargets: [], validators: [], stakingValidators: [], ibcReceivers: [] });
  assert.equal(body.timeoutHeight, HEIGHT + BigInt(BROADCAST_TIMEOUT_BLOCKS));
  const txPlan = { ...TEST_PLAN, maxValueUqor: MAX_VALUE, timeoutHeight: r.result.timeoutHeight };
  assert.deepEqual(windowFormatFailures(raw, { classicalPublicKeyHex: account.publicKey, pqcPublicKey: account.pqc.publicKey, plan: txPlan }), []);
  assert.equal(node.network.allowBroadcast.value, false);
  // Never an EVM send.
  assert.equal(node.requests.some(q => q.path === '/' && /eth_send/.test(q.body)), false);
  clean(r);
  noLeaks(r);
});

test('missing or wrong confirmations: nothing read or signed without the first, nothing sent without the second', async () => {
  for (const first of ['', 'yes', SIGN_PHRASE.toLowerCase(), 'SIGN EVM WINDOW 400 BLOCKS 1 TX 300000 UQOR FOR 16046', 'SIGN HYBRID SELF-SEND FOR 16046', LOCAL_CONFIRMATION]) {
    const node = fakeNode();
    const r = await run(node, { answer: () => first });
    assert.equal(r.error.message, 'Not confirmed');
    assert.equal(r.spies.calls.readRecord, 0, 'record not read');
    assert.equal(r.spies.calls.signHybrid, 0);
    assert.equal(broadcasts(node).length, 0);
  }
  for (const second of ['', 'yes', SIGN_PHRASE, 'BROADCAST EVM WINDOW 00000000 TO QORECHAIN-DIANA', 'BROADCAST HYBRID SELF-SEND TO QORECHAIN-DIANA']) {
    const node = fakeNode();
    const r = await run(node, { answer: (phrase, n) => (n === 1 ? phrase : second) });
    assert.equal(r.error.message, 'Not confirmed');
    assert.equal(r.spies.calls.signHybrid, 1);
    assert.equal(broadcasts(node).length, 0, 'signed and simulated but never sent');
    clean(r);
  }
});

test('wrong network, account, sequence, nonce, PQC key, window or balance stops before the first confirmation', async () => {
  for (const [change, failure, kind] of [
    [{ network: 'qorechain-vladi' }, 'Wrong chain id', CheckError],
    [{ evmChainId: '0x2649' }, 'Wrong chain id', CheckError],
    [{ accountNumber: '99' }, 'Unexpected account number', CheckError],
    [{ sequence: '3', evmNonce: '0x3' }, 'Account sequence changed', CheckError],
    [{ pqcKey: other.pqc.publicKey }, 'Registered PQC key is not the expected key', CheckError],
    [{ pqcFound: false }, 'PQC key not registered', CheckError],
    [{ uqor: String(FEE + MAX_VALUE - 1n) }, 'Insufficient uqor balance', CheckError],
    [{ evmNonce: '0x5' }, 'EVM nonce is not the account sequence', WindowCheckError],
    [{ window: { found: true, live: true } }, 'A window is already live', WindowCheckError],
    [{ gasPrice: '0x' + (200_000_000_000n).toString(16) }, 'Fee cap below the live gas price', WindowCheckError],
  ]) {
    const node = fakeNode(change);
    const r = await run(node);
    assert.ok(r.error instanceof kind, failure);
    assert.deepEqual(r.error.failures, [failure]);
    assert.deepEqual(r.prompts, [], 'no confirmation asked');
    assert.equal(r.spies.calls.readRecord, 0);
    assert.equal(r.spies.calls.signHybrid, 0);
  }
});

test('any chain change after PREPARE stops before signing', async () => {
  for (const [change, expected] of [
    [{ uqor: '99857501' }, 'Chain state changed since PREPARE'],
    [{ uqor: '99000000' }, 'Chain state changed since PREPARE'],
    [{ gasPrice: '0x' + (113_000_000_000n).toString(16) }, 'Chain state changed since PREPARE'],
    [{ baseFee: '0.100000000000000001' }, 'Chain state changed since PREPARE'],
    [{ estimateGas: '0x' + (1_400_000).toString(16) }, 'Chain state changed since PREPARE'],
    [{ window: { found: true, live: false } }, 'Chain state changed since PREPARE'],
    [{ sequence: '3', evmNonce: '0x3' }, 'Account sequence changed'],
    [{ evmNonce: '0x3' }, 'EVM nonce is not the account sequence'],
    [{ pqcKey: other.pqc.publicKey }, 'Registered PQC key is not the expected key'],
    [{ window: { found: true, live: true } }, 'A window is already live'],
    [{ network: 'qorechain-vladi' }, 'Wrong chain id'],
  ]) {
    const node = fakeNode();
    const r = await run(node, { onConfirm: (phrase, chain) => { if (phrase === SIGN_PHRASE) Object.assign(chain, change); } });
    const got = r.error?.failures ? r.error.failures[0] : r.error?.message;
    assert.equal(got, expected, JSON.stringify(change));
    assert.equal(r.spies.calls.signHybrid, 0, 'nothing signed');
    assert.equal(signedSims(node).length, 0);
    assert.equal(broadcasts(node).length, 0);
    clean(r);
  }
});

test('a chain change between the confirmations stops the broadcast', async () => {
  for (const change of [{ uqor: '99857499' }, { sequence: '3', evmNonce: '0x3' }, { window: { found: true, live: true } }, { gasPrice: '0x' + (120_000_000_000n).toString(16) }, { pqcKey: other.pqc.publicKey }]) {
    const node = fakeNode();
    const r = await run(node, { onConfirm: (phrase, chain) => { if (phrase.startsWith('BROADCAST')) Object.assign(chain, change); } });
    assert.ok(r.error, JSON.stringify(change));
    assert.equal(r.spies.calls.signHybrid, 1);
    assert.equal(broadcasts(node).length, 0, JSON.stringify(change));
    clean(r);
  }
  const node = fakeNode();
  const late = await run(node, { onConfirm: (phrase, chain) => { if (phrase.startsWith('BROADCAST')) chain.height = HEIGHT + BigInt(BROADCAST_TIMEOUT_BLOCKS - MIN_BLOCKS_LEFT + 1); } });
  assert.equal(late.error.message, 'Timeout height too close');
  assert.equal(broadcasts(node).length, 0);
});

test('a tampered window, a MsgSend, or wrong keys, fee or sequence are never simulated or sent', async () => {
  const withValue = (p, change) => ({ ...p, messages: [{ ...p.messages[0], value: { ...p.messages[0].value, ...change } }] });
  for (const [label, sign, check] of [
    ['bigger maxValue', p => sdk.signHybridEth(withValue(p, { maxValue: '256501' })), e => e instanceof FormatError && e.failures.includes('Wrong window bounds')],
    ['two transactions', p => sdk.signHybridEth(withValue(p, { maxTxs: '2' })), e => e instanceof FormatError && e.failures.includes('Wrong window bounds')],
    ['longer window', p => sdk.signHybridEth(withValue(p, { blocks: '17280' })), e => e instanceof FormatError && e.failures.includes('Wrong window bounds')],
    ['targets', p => sdk.signHybridEth(withValue(p, { allowedTargets: ['0x1111111111111111111111111111111111111111'] })), e => e instanceof FormatError && e.failures.includes('Wrong window scope')],
    ['native only', p => sdk.signHybridEth(withValue(p, { nativeOnly: true })), e => e instanceof FormatError && e.failures.includes('Wrong window scope')],
    ['validators', p => sdk.signHybridEth(withValue(p, { validators: ['0x2222222222222222222222222222222222222222'] })), e => e instanceof FormatError && e.failures.includes('Wrong window scope')],
    ['other sender', p => sdk.signHybridEth(withValue(p, { sender: other.cosmos })), e => e instanceof FormatError && e.failures.includes('Wrong window sender')],
    ['a MsgSend instead', p => sdk.signHybridEth({ ...p, messages: [{ typeUrl: '/cosmos.bank.v1beta1.MsgSend', value: { fromAddress: account.cosmos, toAddress: other.cosmos, amount: [{ denom: 'uqor', amount: '256500' }] } }] }), e => e instanceof FormatError && e.failures.includes('Wrong message type')],
    ['an extra message', p => sdk.signHybridEth({ ...p, messages: [p.messages[0], sdk.closeEvmWindowMsg(account.cosmos)] }), e => e instanceof FormatError && e.failures.includes('Wrong message type')],
    ['a close instead', p => sdk.signHybridEth({ ...p, messages: [sdk.closeEvmWindowMsg(account.cosmos)] }), e => e instanceof FormatError && e.failures.includes('Wrong message type')],
    ['memo', p => sdk.signHybridEth({ ...p, memo: 'x' }), e => e instanceof FormatError && e.failures.includes('Wrong message')],
    ['wrong classical key', p => sdk.signHybridEth({ ...p, account: { ...p.account, privateKey: other.privateKey } }), e => e instanceof FormatError && e.failures.includes('Classical signature does not verify')],
    ['wrong PQC key', p => sdk.signHybridEth({ ...p, account: { ...p.account, pqc: other.pqc } }), e => e instanceof FormatError && e.failures.includes('PQC signature does not verify')],
    ['v1 sign bytes', p => sdk.signHybridEth({ ...p, signBytesVersion: 'v1' }), e => e instanceof FormatError],
    ['changed fee', p => sdk.signHybridEth({ ...p, fee: { amount: [{ denom: 'uqor', amount: '1' }], gas: '350000' } }), e => e.message === 'Signed transaction differs from the plan'],
    ['changed sequence', p => sdk.signHybridEth({ ...p, sequence: 5n }), e => e.message === 'Signed transaction differs from the plan'],
  ]) {
    const node = fakeNode();
    const s = spies();
    s.deps.signHybrid = params => { const out = sign(params); s.signed.push(out); return out; };
    const r = await run(node, { spies: s });
    assert.ok(check(r.error), label + ': ' + r.error?.message + ' ' + JSON.stringify(r.error?.failures));
    assert.equal(signedSims(node).length, 0, label);
    assert.equal(broadcasts(node).length, 0, label);
    assert.equal(r.prompts.length, 1, label + ': no broadcast confirmation asked');
    clean(r);
  }
});

test('the window path and the MsgSend path do not accept each other', async () => {
  // The self-send plan and its verifier are unchanged.
  assert.equal(SELF_SEND_PLAN.amount, '1');
  assert.equal(SELF_SEND_PLAN.sequence, '1');
  const registry = sdk.qorechainRegistry();
  const common = { account: { privateKey: account.privateKey, publicKey: account.publicKey, pqc: account.pqc }, chainId: 'qorechain-diana', accountNumber: 16046n, memo: '', timeoutHeight: 0n, encodeMessage: m => registry.encodeAsAny(m), signBytesVersion: 'v2', fee: { amount: [{ denom: 'uqor', amount: '52500' }], gas: '350000' } };
  const windowPlan = { ...TEST_PLAN, maxValueUqor: MAX_VALUE };
  const windowTx = sdk.signHybridEth({ ...common, sequence: 2n, messages: [windowMessage(windowPlan)] });
  const sendPlan = { ...SELF_SEND_PLAN, native: account.cosmos, evm: account.evm };
  const sendTx = sdk.signHybridEth({ ...common, sequence: 1n, messages: [{ typeUrl: '/cosmos.bank.v1beta1.MsgSend', value: { fromAddress: account.cosmos, toAddress: account.cosmos, amount: [{ denom: 'uqor', amount: '1' }] } }] });
  const keys = { classicalPublicKeyHex: account.publicKey, pqcPublicKey: account.pqc.publicKey };
  assert.deepEqual(windowFormatFailures(windowTx.txRawBytes, { ...keys, plan: windowPlan }), []);
  assert.ok(hybridFormatFailures(windowTx.txRawBytes, { ...keys, plan: { ...sendPlan, sequence: '2' } }).includes('Wrong message'));
  assert.ok(windowFormatFailures(sendTx.txRawBytes, { ...keys, plan: { ...windowPlan, sequence: '1' } }).includes('Wrong message type'));
  assert.deepEqual(hybridFormatFailures(sendTx.txRawBytes, { ...keys, plan: sendPlan }), []);
  // A signature over one window does not cover another (a one-byte change in maxValue).
  assert.ok(windowFormatFailures(windowTx.txRawBytes, { ...keys, plan: { ...windowPlan, maxValueUqor: MAX_VALUE + 1n } }).includes('Wrong window bounds'));
  // The phrases of the two paths never coincide.
  assert.notEqual(SIGN_PHRASE, 'SIGN HYBRID SELF-SEND FOR 16046');
});

test('BUILD: the intent is the fixed plan within the signing limits, or nothing', async () => {
  const outputs = [];
  const node = fakeNode();
  const { prepareDeploymentWindow } = await import('../diana-window-prepare.mjs');
  const prepared = await prepareDeploymentWindow({ network: node.network, plan: TEST_PLAN, artifact: ARTIFACT, now: NOW, write: o => outputs.push(o) });
  const intent = windowIntent(prepared, TEST_PLAN);
  assert.equal(intent.maxValueUqor, MAX_VALUE);
  assert.equal(signConfirmation(intent), SIGN_PHRASE);
  assert.equal(intent.fingerprint, stateFingerprint(prepared));
  assert.ok(Object.isFrozen(intent) && Object.isFrozen(intent.plan));
  const mutate = (path, value) => { const copy = structuredClone(prepared); const keys = path.split('.'); keys.slice(0, -1).reduce((o, k) => o[k], copy)[keys.at(-1)] = value; return copy; };
  for (const [label, report, plan, message] of [
    ['signed report', mutate('signed', true), TEST_PLAN, 'Window intent does not match the plan'],
    ['other type', mutate('window.typeUrl', '/qorechain.pqc.v1.MsgCloseEVMWindow'), TEST_PLAN, 'Window intent does not match the plan'],
    ['other sender', mutate('window.sender', other.cosmos), TEST_PLAN, 'Window intent does not match the plan'],
    ['500 blocks', mutate('window.blocks', '500'), TEST_PLAN, 'Window intent does not match the plan'],
    ['plan 500 blocks', prepared, { ...TEST_PLAN, windowBlocks: 500 }, 'Window intent does not match the plan'],
    ['two txs', mutate('window.maxTxs', '2'), TEST_PLAN, 'Window intent does not match the plan'],
    ['targets', mutate('window.allowedTargets', ['0x1111111111111111111111111111111111111111']), TEST_PLAN, 'Window intent does not match the plan'],
    ['native only', mutate('window.nativeOnly', true), TEST_PLAN, 'Window intent does not match the plan'],
    ['live window', mutate('existingWindow.live', true), TEST_PLAN, 'Window intent does not match the plan'],
    ['nonce', mutate('evmNonce', '3'), TEST_PLAN, 'Window intent does not match the plan'],
    ['units', mutate('unitsConsistent', false), TEST_PLAN, 'Window intent does not match the plan'],
    ['gas does not fit', mutate('cosmosTx.gasFitsWithHeadroom', false), TEST_PLAN, 'Window intent does not match the plan'],
    ['value above the limit', mutate('window.maxValueUqor', '300001'), TEST_PLAN, 'Window value above the signing limit'],
    ['zero value', mutate('window.maxValueUqor', '0'), TEST_PLAN, 'Window value above the signing limit'],
    ['value below the deployment cost', mutate('deployment.maxCostWei', '256500000000000001'), TEST_PLAN, 'Window value above the signing limit'],
    ['bigger fee', prepared, { ...TEST_PLAN, gasPrice: '0.2' }, 'Window intent does not match the plan'],
  ]) {
    assert.throws(() => windowIntent(report, plan), { message: message }, label);
  }
  assert.throws(() => windowIntent(prepared, TEST_PLAN, { ...SIGNING_LIMITS, maxFeeUqor: 52499n }), { message: 'Fee above the signing limit' });
  assert.throws(() => windowIntent(prepared, TEST_PLAN, { ...SIGNING_LIMITS, maxWindowValueUqor: 256499n }), { message: 'Window value above the signing limit' });
  // Through the whole flow: a live estimate that pushes the window value over the limit is refused before any confirmation.
  const big = fakeNode({ estimateGas: '0x' + (1_700_000).toString(16) });
  const r = await run(big);
  assert.equal(r.error.message, 'Window value above the signing limit');
  assert.deepEqual(r.prompts, []);
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
    assert.deepEqual(r.prompts, [SIGN_PHRASE], 'no broadcast confirmation is even asked');
    assert.equal(broadcasts(node).length, 0);
    clean(r);
  }
});

test('a lost or unclear broadcast answer is UNKNOWN and never retried; refusals do not echo the node log', async () => {
  for (const broadcastMode of ['network-error', 'garbage']) {
    const node = fakeNode({ broadcastMode });
    const r = await run(node);
    assert.equal(r.error.message, 'Broadcast result unknown');
    assert.equal(broadcasts(node).length, 1, 'exactly one attempt');
    const last = JSON.parse(r.outputs.at(-1));
    assert.equal(last.broadcast, 'UNKNOWN');
    assert.match(last.next, /Do not re-run/);
    assert.equal(last.verify.lastIncludableHeight, String(HEIGHT + BigInt(BROADCAST_TIMEOUT_BLOCKS)));
    assert.equal(node.network.allowBroadcast.value, false);
    clean(r);
    noLeaks(r);
  }
  const refused = await run(fakeNode({ broadcastMode: 'refused' }));
  assert.equal(refused.error.message, 'Broadcast refused by the node');
  assert.equal(refused.outputs.some(t => t.includes('sequence mismatch')), false);
  noLeaks(refused);
  assert.equal((await run(fakeNode({ broadcastMode: 'other-hash' }))).error.message, 'Broadcast hash mismatch');
});

test('SIGN-AND-VERIFY-LOCAL signs the window, verifies it, and sends nothing after sealing', async () => {
  const node = fakeNode();
  const r = await run(node, { local: true });
  assert.equal(r.error, undefined, r.error && failureMessage(r.error));
  assert.deepEqual(r.prompts, [LOCAL_CONFIRMATION]);
  assert.equal(r.result.formatCheck, 'pass');
  assert.equal(r.result.sentToNetwork, false);
  assert.equal(r.result.matchesPrepare, true, 'the signed body and auth info are the PREPAREd ones');
  assert.equal(signedSims(node).length, 0);
  assert.equal(broadcasts(node).length, 0);
  clean(r);
  noLeaks(r);
});

test('the guard: reads, simulation and read-only EVM methods; the broadcast route only when opened, and once', async () => {
  let calls = 0;
  let open = false;
  const fetch = windowGuardedFetch({ rest: REST, evmRpc: EVM_RPC }, { allowBroadcast: () => open, fetchImpl: async () => { calls++; return new Response('{}'); } });
  await fetch(REST + '/cosmos/auth/v1beta1/accounts/x');
  await fetch(REST + '/cosmos/tx/v1beta1/simulate', { method: 'POST', body: '{}' });
  for (const method of ['eth_chainId', 'eth_getTransactionCount', 'eth_getBalance', 'eth_gasPrice', 'eth_estimateGas']) await fetch(EVM_RPC, { method: 'POST', body: JSON.stringify({ method }) });
  await assert.rejects(fetch(REST + '/cosmos/tx/v1beta1/txs', { method: 'POST', body: '{}' }), /Network request blocked/, 'closed by default');
  open = true;
  await fetch(REST + '/cosmos/tx/v1beta1/txs', { method: 'POST', body: '{}' });
  await assert.rejects(fetch(REST + '/cosmos/tx/v1beta1/txs', { method: 'POST', body: '{}' }), /Network request blocked/, 'only once');
  for (const [url, init] of [
    [EVM_RPC, { method: 'POST', body: JSON.stringify({ method: 'eth_sendRawTransaction' }) }],
    [EVM_RPC, { method: 'POST', body: JSON.stringify({ method: 'eth_sendTransaction' }) }],
    [EVM_RPC, { method: 'POST', body: JSON.stringify({ method: 'eth_call' }) }],
    [REST + '/cosmos/tx/v1beta1/txs/x', { method: 'PUT' }],
    ['https://example.com/x', {}],
    [REST.replace('https:', 'http:') + '/x', {}],
  ]) await assert.rejects(fetch(url, init), /Network request blocked/);
  assert.equal(calls, 8);
});

// ---- Post-broadcast verification, read-only ----
const TX_HEIGHT = HEIGHT + 3n;
function includedChain(changes = {}) {
  const tx = {
    tx: {
      body: { messages: [{ '@type': OPEN_WINDOW_TYPE_URL, sender: account.cosmos, blocks: '400', max_txs: '1', max_value: '256500', native_only: false, allowed_targets: [], validators: [], staking_validators: [], ibc_receivers: [] }], memo: '', timeout_height: String(HEIGHT + 300n), extension_options: [{ '@type': sdk.HYBRID_SIG_TYPE_URL }] },
      auth_info: { signer_infos: [{ sequence: '2' }], fee: { amount: [{ denom: 'uqor', amount: '52500' }], gas_limit: '350000', payer: '', granter: '' } },
    },
    tx_response: { height: String(TX_HEIGHT), txhash: 'AA'.repeat(32), code: 0, gas_wanted: '350000', gas_used: '227100' },
  };
  const window = { found: true, live: true, opened_height: String(TX_HEIGHT), expiry_height: String(TX_HEIGHT + 400n), max_txs: '1', used_txs: '0', max_value: '256500', used_value: '0', remaining_blocks: '400', remaining_txs: '1', remaining_value: '256500', native_only: false, allowed_targets: [] };
  return fakeNode({ sequence: '3', evmNonce: '0x3', uqor: String(99857500n - FEE), tx, window, ...changes });
}
const verify = (node, extra = {}) => verifyOpenedWindow({ network: node.network, txHash: 'AA'.repeat(32), plan: { ...TEST_PLAN, maxValueUqor: MAX_VALUE }, before: '99857500', ...extra });

test('VERIFY passes only when the transaction, account, nonce, key, window and balance all match', async () => {
  const node = includedChain();
  const ok = await verify(node);
  assert.equal(ok.verified, true, JSON.stringify(ok.failures));
  assert.deepEqual(ok.failures, []);
  assert.equal(ok.window.expiryHeight, String(TX_HEIGHT + 400n));
  // Read-only: GETs and read-only EVM methods only.
  assert.equal(node.requests.some(q => q.method !== 'GET' && !(q.path === '/' && /eth_getTransactionCount/.test(q.body))), false);
  // Standalone (no PREPAREd balance or value): the window value is taken from the transaction itself.
  assert.equal((await verifyOpenedWindow({ network: includedChain().network, txHash: 'AA'.repeat(32), plan: TEST_PLAN })).verified, true);

  const base = includedChain().chain;
  const withTx = f => { const t = structuredClone(base.tx); f(t); return { tx: t }; };
  const withWindow = change => ({ window: { ...base.window, ...change } });
  for (const [label, change, failure] of [
    ['failed tx', withTx(t => { t.tx_response.code = 11; }), 'Transaction failed or not included'],
    ['other hash', withTx(t => { t.tx_response.txhash = 'BB'.repeat(32); }), 'Transaction failed or not included'],
    ['other message', withTx(t => { t.tx.body.messages[0]['@type'] = '/cosmos.bank.v1beta1.MsgSend'; }), 'Transaction is not the planned window'],
    ['more value', withTx(t => { t.tx.body.messages[0].max_value = '256501'; }), 'Transaction is not the planned window'],
    ['targets', withTx(t => { t.tx.body.messages[0].allowed_targets = ['0x11']; }), 'Transaction is not the planned window'],
    ['two messages', withTx(t => { t.tx.body.messages.push(t.tx.body.messages[0]); }), 'Transaction is not the planned window'],
    ['no hybrid extension', withTx(t => { t.tx.body.extension_options = []; }), 'Transaction is not the planned window'],
    ['other fee', withTx(t => { t.tx.auth_info.fee.amount[0].amount = '60000'; }), 'Transaction fee or gas is not the planned one'],
    ['other sequence', withTx(t => { t.tx.auth_info.signer_infos[0].sequence = '3'; }), 'Transaction fee or gas is not the planned one'],
    ['sequence not moved', { sequence: '2' }, 'Account sequence did not advance by one'],
    ['sequence moved twice', { sequence: '4' }, 'Account sequence did not advance by one'],
    ['nonce', { evmNonce: '0x4' }, 'EVM nonce is not the new sequence'],
    ['key rotated', { pqcKey: other.pqc.publicKey }, 'Registered PQC key changed'],
    ['no window', { window: { found: false, live: false } }, 'Window not found'],
    ['not live', withWindow({ live: false }), 'Window not live'],
    ['opened elsewhere', withWindow({ opened_height: String(TX_HEIGHT + 1n), expiry_height: String(TX_HEIGHT + 401n) }), 'Window not opened by this transaction'],
    ['longer', withWindow({ expiry_height: String(TX_HEIGHT + 1000n) }), 'Window length differs from the plan'],
    ['more txs', withWindow({ max_txs: '2', remaining_txs: '2' }), 'Window bounds differ from the plan'],
    ['more value', withWindow({ max_value: '999999', remaining_value: '999999' }), 'Window bounds differ from the plan'],
    ['used', withWindow({ used_txs: '1', remaining_txs: '0' }), 'Window already used'],
    ['targets', withWindow({ allowed_targets: ['0x11'] }), 'Window scope differs from the plan'],
    ['native only', withWindow({ native_only: true }), 'Window scope differs from the plan'],
    ['balance unchanged', { uqor: '99857500' }, 'Balance drop is not the window fee'],
    ['balance drop too large', { uqor: String(99857500n - FEE - 1n) }, 'Balance drop is not the window fee'],
  ]) {
    const result = await verify(includedChain(change));
    assert.equal(result.verified, false, label);
    assert.ok(result.failures.includes(failure), label + ': ' + JSON.stringify(result.failures));
    assert.ok(result.failures.every(f => VERIFY_FAILURES.includes(f)), label);
  }
  await assert.rejects(verify(includedChain({ tx: undefined })), { message: 'Transaction not found' });
});

test('failure messages never echo SDK errors, node logs or secrets', () => {
  assert.equal(failureMessage(new Error('Invalid mnemonic: ' + PUBLIC_TEST_MNEMONIC)), 'Prepare stopped');
  assert.equal(failureMessage(new Error('Chain state changed since PREPARE')), 'Chain state changed since PREPARE');
  assert.equal(failureMessage(new CheckError(['Account sequence changed', PASSWORD])), 'Check failed: Account sequence changed');
  assert.equal(failureMessage(new WindowCheckError(['A window is already live', PASSWORD])), 'Window check failed: A window is already live');
  assert.equal(failureMessage(new FormatError(['Wrong window bounds', 'x: ' + PASSWORD + '!'])), 'Format check failed: Wrong window bounds');
  assert.equal(failureMessage(new Error('Record classical key is not the on-chain key')), 'Record classical key is not the on-chain key');
});

test('options: PREPARE by default; signing, broadcasting and verifying only on explicit options', () => {
  assert.deepEqual(parseArgs([]), { mode: 'prepare' });
  assert.deepEqual(parseArgs(['--sign-and-verify-local']), { mode: 'local' });
  assert.deepEqual(parseArgs(['--broadcast']), { mode: 'broadcast' });
  assert.deepEqual(parseArgs(['--verify', 'ab'.repeat(32)]), { mode: 'verify', txHash: 'AB'.repeat(32) });
  for (const args of [['--yes'], ['--broadcast', '--yes'], ['--verify'], ['--verify', 'xyz'], ['--verify', 'ab'.repeat(32), '--broadcast'], ['--sign-and-simulate']]) {
    assert.throws(() => parseArgs(args), { message: 'Unknown option' }, args.join(' '));
  }
});

test('order and reuse: one signing call, record after the first confirmation, re-PREPARE before signing and before the single broadcast', () => {
  const flow = source.slice(source.indexOf('export async function runWindowBroadcast'), source.indexOf('export async function runWindowSignLocal'));
  const steps = ['prepareDeploymentWindow(', 'windowIntent(', 'confirm(signPhrase)', 'readParsedRecord(readRecord)', 'presign(', 'signAndCheck(', 'simulateSigned(signed.txRawBytes', 'exactHybridGas', 'confirm(broadcastPhrase)', 'samePrepare(ctx)', 'Timeout height too close', 'broadcastOnce(signed.txRawBytes'];
  const order = steps.map(s => flow.indexOf(s));
  assert.ok(order.every(i => i > 0), steps[order.findIndex(i => i <= 0)]);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  const presignFn = source.slice(source.indexOf('async function presign('), source.indexOf('function signAndCheck'));
  assert.ok(presignFn.indexOf('presignChecks(') < presignFn.indexOf('samePrepare(ctx)'));
  assert.equal([...source.matchAll(/signWindow\(account/g)].length, 2, 'one definition, one signing call');
  assert.equal([...source.matchAll(/signAndCheck\(account/g)].length, 3, 'one definition; one call in the broadcast flow, one in the local flow');
  assert.equal([...source.matchAll(/\(deps\.signHybrid \?\? sdk\.signHybridEth\)\(/g)].length, 1);
  assert.equal([...source.matchAll(/broadcastOnce\(/g)].length, 2, 'one definition, one call');
  assert.equal([...source.matchAll(/allowBroadcast\.value = true/g)].length, 1);
  for (const forbidden of ['selfSendMessage', 'signPlanned', 'signClassicalEth', 'pqcSign(', 'eth_sendRawTransaction', 'closeEvmWindowMsg', 'writeFile', 'console.', 'while (', 'retry']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  const main = source.slice(source.indexOf('async function main'));
  assert.ok(main.indexOf("mode === 'prepare'") < main.indexOf('isTTY'), 'PREPARE needs no terminal and no record');
  assert.ok(main.indexOf('isTTY') < main.indexOf('readRecordBytes(RECORD_PATH)'));
  const prepareBranch = main.slice(main.indexOf("if (mode === 'prepare')"), main.indexOf("if (mode === 'verify')"));
  assert.ok(prepareBranch.includes('prepareNetwork()') && !prepareBranch.includes('dianaWindowNetwork'), 'PREPARE uses the guard with no broadcast route');
  const verifyBranch = main.slice(main.indexOf("if (mode === 'verify')"), main.indexOf('isTTY'));
  assert.ok(verifyBranch.includes('prepareNetwork()') && !verifyBranch.includes('readRecord'), 'VERIFY is read-only');
});

test('redirected input is refused before the vault is touched, with no output', () => {
  for (const option of ['--broadcast', '--sign-and-verify-local']) {
    const result = spawnSync(process.execPath, [scriptPath, option], { input: SIGN_PHRASE + '\n', encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^Diana EVM window tool stopped: Interactive Windows terminal required\. No file was written\.\n$/);
  }
  assert.match(spawnSync(process.execPath, [scriptPath, '--yes'], { encoding: 'utf8' }).stderr, /Unknown option/);
});
