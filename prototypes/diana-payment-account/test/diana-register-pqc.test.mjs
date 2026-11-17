import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as sdk from '@qorechain/sdk';
import {
  BROADCAST_CONFIRMATION, PLAN, PREFLIGHT_FAILURES, PREPARE_CONFIRMATION, PreflightError, SIGN_CONFIRMATION,
  encodeTxRaw, failureMessage, feeFor, guardedFetch, preflightFailures, registrationMessage, runRegistration,
  signedProofOfPossession, unsignedTxParts,
} from '../diana-register-pqc.mjs';

// Public BIP-39 test mnemonic (all-"abandon" vector). It is not an ELA account and holds nothing.
const PUBLIC_TEST_MNEMONIC = Array(11).fill('abandon').concat('about').join(' ');
const PASSWORD = 'public-test-password';
const account = await sdk.deriveUnifiedAccount(PUBLIC_TEST_MNEMONIC, 0);
const EXPECTED = Object.freeze({ role: 'test-account', native: account.cosmos, evm: account.evm });
const recordBytes = () => Buffer.from(JSON.stringify({ mnemonic: PUBLIC_TEST_MNEMONIC, password: PASSWORD, index: 0, sdkVersion: '0.14.0' }));
const allZero = bytes => bytes.every(byte => byte === 0);
const { rest: REST, evmRpc: EVM_RPC } = sdk.NETWORKS.testnet.endpoints;
const scriptPath = fileURLToPath(new URL('../diana-register-pqc.mjs', import.meta.url));
const source = readFileSync(scriptPath, 'utf8');
const SECRETS = [PUBLIC_TEST_MNEMONIC, 'abandon', PASSWORD, account.privateKey.slice(2, 34), Buffer.from(account.pqc.secretKey).toString('hex').slice(0, 32)];

// A fake Diana node. No real network request is made by these tests: every answer comes from here,
// behind the real guard. `chain` is the live state the fake reports; tests change it per scenario.
function fakeNode(overrides = {}) {
  const chain = {
    network: 'qorechain-diana', evmChainId: '0x2648', authStatus: 200, accountNumber: '16046', sequence: '0', pubKey: null,
    uqor: '100000000', pqcFound: false, minGasPrice: '0.100000000000000000', popHeight: '2000000', simulateGas: 226051, popSimulateGas: 275101,
    broadcastCode: 0, ...overrides,
  };
  const requests = [];
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = (init.method ?? 'GET').toUpperCase();
    requests.push({ method, path: u.pathname, body: init.body });
    if (u.host === new URL(EVM_RPC).host) return json(200, { jsonrpc: '2.0', id: 1, result: chain.evmChainId });
    if (u.pathname === '/cosmos/base/tendermint/v1beta1/node_info') return json(200, { default_node_info: { network: chain.network } });
    if (u.pathname.startsWith('/cosmos/auth/v1beta1/accounts/')) {
      return chain.authStatus === 200
        ? json(200, { account: { '@type': '/cosmos.auth.v1beta1.BaseAccount', address: account.cosmos, pub_key: chain.pubKey && { '@type': sdk.ETHSECP256K1_PUBKEY_TYPE, key: chain.pubKey }, account_number: chain.accountNumber, sequence: chain.sequence } })
        : json(404, { code: 5, message: 'account not found' });
    }
    if (u.pathname.includes('/by_denom')) return json(200, { balance: { denom: 'uqor', amount: chain.uqor } });
    if (u.pathname.startsWith('/qorechain/pqc/v1/account/')) return json(200, chain.pqcFound ? { found: true, account: { algorithm_id: 1, public_key: 'AA==' } } : { found: false, account: null });
    if (u.pathname === '/cosmos/evm/feemarket/v1/params') return json(200, { params: { min_gas_price: chain.minGasPrice } });
    if (u.pathname.startsWith('/cosmos/upgrade/v1beta1/applied_plan/')) return json(200, { height: chain.popHeight });
    if (u.pathname === '/cosmos/tx/v1beta1/simulate') {
      const tx = JSON.parse(init.body).tx_bytes;
      const withPop = Buffer.from(tx, 'base64').length > 5000;
      if (chain.onSimulate) chain.onSimulate(chain);
      return json(200, { gas_info: { gas_used: String(withPop ? chain.popSimulateGas : chain.simulateGas) } });
    }
    if (u.pathname === '/cosmos/tx/v1beta1/txs') {
      if (chain.broadcastMode === 'network-error') throw new TypeError('fetch failed');
      if (chain.broadcastMode === 'garbage') return new Response('<html>gateway timeout</html>', { status: 504 });
      const bytes = Buffer.from(JSON.parse(init.body).tx_bytes, 'base64');
      return json(200, { tx_response: { txhash: createHash('sha256').update(bytes).digest('hex').toUpperCase(), code: chain.broadcastCode, codespace: chain.broadcastCode ? 'sdk' : '' } });
    }
    return json(404, { message: 'not found' });
  };
  const allowBroadcast = { value: false };
  const network = { rest: REST, evmRpc: EVM_RPC, allowBroadcast, fetch: guardedFetch({ rest: REST, evmRpc: EVM_RPC }, { allowBroadcast: () => allowBroadcast.value, fetchImpl }) };
  return { chain, requests, network };
}

// Spies record every secret byte array the SDK hands out, and every signing call.
function spies() {
  const secrets = [];
  const calls = { signPop: 0, signClassical: 0 };
  return {
    secrets, calls,
    deps: {
      derive: async (mnemonic, index) => { const a = await sdk.deriveUnifiedAccount(mnemonic, index); secrets.push(a.pqc.secretKey); return a; },
      canonical: (address, mnemonic) => { const k = sdk.derivePqcCanonical(address, mnemonic); secrets.push(k.secretKey); return k; },
      signPop: input => { calls.signPop++; return sdk.signProofOfPossession(input); },
      signClassical: params => { calls.signClassical++; return sdk.signClassicalEth(params); },
    },
  };
}

async function run(node, options = {}) {
  const outputs = [];
  const prompts = [];
  const answers = [...(options.answers ?? [])];
  const s = options.spies ?? spies();
  const bytes = recordBytes();
  let error;
  let result;
  try {
    result = await runRegistration({
      recordBytes: bytes, expected: options.expected ?? EXPECTED, broadcast: options.broadcast ?? false, network: node.network,
      confirm: async phrase => { prompts.push(phrase); const answer = answers.shift() ?? ''; options.onConfirm?.(phrase, node.chain); return answer; },
      write: report => outputs.push(JSON.stringify(report)), deps: s.deps,
    });
  } catch (e) {
    error = e;
  }
  return { result, error, outputs, prompts, bytes, spies: s };
}

const posts = node => node.requests.filter(r => r.method === 'POST' && r.path !== '/');
const broadcasts = node => node.requests.filter(r => r.path === '/cosmos/tx/v1beta1/txs');

test('the plan: 600,000 gas at 0.15 uqor/gas is a 90,000 uqor (0.09 QOR) fee', () => {
  assert.equal(feeFor(PLAN.gasLimit, PLAN.gasPrice), '90000');
  assert.equal(feeFor(275101, '0.1'), '27511');
  assert.equal(PLAN.chainId, 'qorechain-diana');
  assert.equal(PLAN.evmChainId, 9800);
  assert.notEqual(SIGN_CONFIRMATION, BROADCAST_CONFIRMATION);
  assert.notEqual(PREPARE_CONFIRMATION, SIGN_CONFIRMATION);
});

test('the SDK message is MsgRegisterPQCKeyV2 with the canonical key, ML-DSA-87, hybrid, empty classical key', () => {
  const message = registrationMessage(account.cosmos, account.pqc.publicKey, new Uint8Array([1, 2]));
  assert.equal(message.typeUrl, '/qorechain.pqc.v1.MsgRegisterPQCKeyV2');
  assert.equal(message.value.sender, account.cosmos);
  assert.equal(message.value.algorithmId, 1);
  assert.equal(message.value.keyType, 'hybrid');
  assert.equal(message.value.ecdsaPubkey.length, 0);
  assert.equal(message.value.publicKey.length, 2592);
  assert.deepEqual([...message.value.proofOfPossession], [1, 2]);
  assert.equal(registrationMessage(account.cosmos, account.pqc.publicKey).value.proofOfPossession.length, 0);
});

test('the proof of possession signs the documented bytes and is refused for another chain or account', () => {
  const keypair = sdk.derivePqcCanonical(account.cosmos, PUBLIC_TEST_MNEMONIC);
  try {
    const signBytes = Buffer.from(sdk.proofOfPossessionSignBytes({ chainId: 'qorechain-diana', account: account.cosmos, publicKey: keypair.publicKey })).toString();
    assert.equal(signBytes, 'qorechain-pqc-pop-v1|qorechain-diana|1|' + account.cosmos + '|' + Buffer.from(keypair.publicKey).toString('hex'));
    const proof = signedProofOfPossession(account.cosmos, keypair);
    assert.equal(proof.length, 4627);
    assert.equal(sdk.verifyProofOfPossession({ chainId: 'qorechain-vladi', account: account.cosmos, publicKey: keypair.publicKey, proof }), false);
    const other = 'qor1dfw567en2l0edze2xqzqw8kwnrcpt3u5m9n88r';
    assert.equal(sdk.verifyProofOfPossession({ chainId: 'qorechain-diana', account: other, publicKey: keypair.publicKey, proof }), false);
    // A PoP made for the wrong chain (or a corrupted one) is refused before anything else is built.
    assert.throws(() => signedProofOfPossession(account.cosmos, keypair, PLAN, { signPop: input => sdk.signProofOfPossession({ ...input, chainId: 'qorechain-vladi' }) }), /Proof of possession does not verify/);
    assert.throws(() => signedProofOfPossession(account.cosmos, keypair, PLAN, { signPop: input => { const p = sdk.signProofOfPossession(input); p[10] ^= 1; return p; } }), /Proof of possession does not verify/);
  } finally {
    keypair.secretKey.fill(0);
  }
});

test('the unsigned simulation bytes are exactly what signClassicalEth signs', () => {
  const message = registrationMessage(account.cosmos, account.pqc.publicKey);
  const parts = unsignedTxParts({ publicKeyHex: account.publicKey, message, sequence: '0' });
  const registry = sdk.qorechainRegistry();
  const signed = sdk.signClassicalEth({
    account: { privateKey: account.privateKey, publicKey: account.publicKey }, chainId: PLAN.chainId, accountNumber: 16046n, sequence: 0n,
    messages: [message], fee: { amount: [{ denom: 'uqor', amount: '90000' }], gas: '600000' }, memo: '', encodeMessage: m => registry.encodeAsAny(m),
  });
  assert.deepEqual(Buffer.from(parts.bodyBytes), Buffer.from(signed.bodyBytes));
  assert.deepEqual(Buffer.from(parts.authInfoBytes), Buffer.from(signed.authInfoBytes));
  assert.deepEqual(Buffer.from(encodeTxRaw(signed.bodyBytes, signed.authInfoBytes, [signed.classicalSignature])), Buffer.from(signed.txRawBytes));
});

test('pre-flight passes on the expected live state and names every problem otherwise', () => {
  const good = { chainId: 'qorechain-diana', evmChainId: 9800, account: { exists: true, accountNumber: '16046', sequence: '0', pubKey: null }, uqor: '100000000', pqcRegistered: false, minGasPrice: '0.1', popSupported: true };
  assert.deepEqual(preflightFailures(good, account.publicKey), []);
  const ownKey = Buffer.from(account.publicKey.slice(2), 'hex').toString('base64');
  assert.deepEqual(preflightFailures({ ...good, account: { ...good.account, pubKey: ownKey } }, account.publicKey), []);
  const cases = [
    [{ chainId: 'qorechain-vladi' }, 'Wrong chain id'],
    [{ evmChainId: 9801 }, 'Wrong chain id'],
    [{ account: { exists: false } }, 'Account not found on chain'],
    [{ account: { ...good.account, accountNumber: '16047' } }, 'Unexpected account number'],
    [{ account: { ...good.account, sequence: '1' } }, 'Account sequence changed'],
    [{ account: { ...good.account, pubKey: 'A'.repeat(44) } }, 'On-chain classical key is a different key'],
    [{ pqcRegistered: true }, 'PQC key already registered'],
    [{ pqcRegistered: undefined }, 'PQC key already registered'],
    [{ uqor: '89999' }, 'Insufficient uqor balance'],
    [{ uqor: undefined }, 'Insufficient uqor balance'],
    [{ minGasPrice: '0.2' }, 'Gas price below the chain minimum'],
    [{ popSupported: false }, 'Chain does not support proof of possession'],
  ];
  for (const [change, failure] of cases) assert.deepEqual(preflightFailures({ ...good, ...change }, account.publicKey), [failure], failure);
  for (const [, failure] of cases) assert.ok(PREFLIGHT_FAILURES.includes(failure));
});

test('default prepare mode reads, simulates without any signature, and never signs or broadcasts', async () => {
  const node = fakeNode();
  const { result, error, outputs, prompts, bytes, spies: s } = await run(node);
  assert.equal(error, undefined);
  assert.equal(result.mode, 'prepare');
  assert.equal(result.signed, false);
  assert.equal(result.broadcast, false);
  assert.equal(result.accountNumber, '16046');
  assert.equal(result.sequence, '0');
  assert.equal(result.uqorBalance, '100000000');
  assert.equal(result.fee, '90000uqor');
  assert.equal(result.simulatedGasWithoutPop, 226051);
  assert.equal(result.estimatedGasWithPop, 286051);
  assert.equal(result.gasFitsWithHeadroom, true);
  assert.deepEqual(prompts, []);
  assert.deepEqual(s.calls, { signPop: 0, signClassical: 0 });
  assert.deepEqual(posts(node).map(r => r.path), ['/cosmos/tx/v1beta1/simulate']);
  assert.equal(broadcasts(node).length, 0);
  // The simulated tx carries an all-zero placeholder signature and no proof of possession.
  const raw = Buffer.from(JSON.parse(posts(node)[0].body).tx_bytes, 'base64');
  assert.ok(raw.subarray(raw.length - 64).every(b => b === 0));
  assert.ok(raw.length < 3000);
  assert.ok(allZero(bytes));
  for (const secret of s.secrets) assert.ok(allZero(secret), 'derived PQC secret zeroed');
  assert.ok(s.secrets.length >= 2);
  for (const text of outputs) for (const secret of SECRETS) assert.equal(text.includes(secret), false);
});

test('each failing pre-flight scenario stops before simulation and signing', async () => {
  const scenarios = [
    [{ network: 'qorechain-vladi' }, 'Wrong chain id'],
    [{ evmChainId: '0x2649' }, 'Wrong chain id'],
    [{ authStatus: 404 }, 'Account not found on chain'],
    [{ accountNumber: '99' }, 'Unexpected account number'],
    [{ sequence: '3' }, 'Account sequence changed'],
    [{ pqcFound: true }, 'PQC key already registered'],
    [{ uqor: '1000' }, 'Insufficient uqor balance'],
    [{ popHeight: '0' }, 'Chain does not support proof of possession'],
  ];
  for (const [change, failure] of scenarios) {
    const node = fakeNode(change);
    const { error, bytes, spies: s } = await run(node, { broadcast: true, answers: [SIGN_CONFIRMATION, BROADCAST_CONFIRMATION] });
    assert.ok(error instanceof PreflightError, failure);
    assert.deepEqual(error.failures, [failure]);
    assert.equal(failureMessage(error), 'Pre-flight failed: ' + failure);
    assert.equal(posts(node).filter(r => r.path.startsWith('/cosmos/tx')).length, 0, failure);
    assert.deepEqual(s.calls, { signPop: 0, signClassical: 0 });
    assert.ok(allZero(bytes));
    for (const secret of s.secrets) assert.ok(allZero(secret));
  }
});

test('a record for another account is refused before any chain request', async () => {
  const node = fakeNode();
  const { error, bytes, spies: s } = await run(node, { expected: { role: 'invoice-owner', native: 'qor1dfw567en2l0edze2xqzqw8kwnrcpt3u5m9n88r', evm: '0x6a5d4D7B3357df968b2A3004071eCe98f015C794' }, broadcast: true, answers: [SIGN_CONFIRMATION, BROADCAST_CONFIRMATION] });
  assert.equal(error.message, 'Recovery record does not derive the expected account');
  assert.equal(node.requests.length, 0);
  assert.ok(allZero(bytes));
  for (const secret of s.secrets) assert.ok(allZero(secret));
});

test('broadcast needs the first confirmation before signing and the second before sending', async () => {
  for (const answers of [[], ['sign pqc registration for 16046'], [BROADCAST_CONFIRMATION, SIGN_CONFIRMATION]]) {
    const node = fakeNode();
    const { error, spies: s } = await run(node, { broadcast: true, answers });
    assert.equal(error.message, 'Not confirmed');
    assert.equal(s.calls.signPop + s.calls.signClassical, 0, 'nothing signed without the first confirmation');
    assert.equal(broadcasts(node).length, 0);
  }
  const node = fakeNode();
  const { error, prompts, spies: s } = await run(node, { broadcast: true, answers: [SIGN_CONFIRMATION, 'yes'] });
  assert.equal(error.message, 'Not confirmed');
  assert.deepEqual(prompts, [SIGN_CONFIRMATION, BROADCAST_CONFIRMATION]);
  assert.deepEqual(s.calls, { signPop: 1, signClassical: 1 });
  assert.equal(broadcasts(node).length, 0, 'signed but never sent without the second confirmation');
  for (const secret of s.secrets) assert.ok(allZero(secret));
});

test('with both confirmations the exact simulated transaction is broadcast once', async () => {
  const node = fakeNode();
  const { result, error, outputs, bytes, spies: s } = await run(node, { broadcast: true, answers: [SIGN_CONFIRMATION, BROADCAST_CONFIRMATION] });
  assert.equal(error, undefined);
  assert.equal(result.broadcast, true);
  assert.equal(result.finalSimulatedGas, 275101);
  assert.match(result.txHash, /^[0-9A-F]{64}$/);
  const sent = broadcasts(node);
  assert.equal(sent.length, 1);
  const body = JSON.parse(sent[0].body);
  assert.equal(body.mode, 'BROADCAST_MODE_SYNC');
  assert.equal(createHash('sha256').update(Buffer.from(body.tx_bytes, 'base64')).digest('hex').toUpperCase(), result.txHash);
  assert.equal(node.network.allowBroadcast.value, false, 'broadcast route closed again');
  assert.ok(allZero(bytes));
  for (const secret of s.secrets) assert.ok(allZero(secret));
  for (const text of outputs) for (const secret of SECRETS) assert.equal(text.includes(secret), false);
});

test('a sequence that changes after the final simulation stops the broadcast', async () => {
  // The final simulation is the second one; the sequence moves right after it.
  let simulations = 0;
  const node = fakeNode({ onSimulate: chain => { if (++simulations === 2) chain.sequence = '1'; } });
  const { error, spies: s } = await run(node, { broadcast: true, answers: [SIGN_CONFIRMATION, BROADCAST_CONFIRMATION] });
  assert.ok(error instanceof PreflightError);
  assert.deepEqual(error.failures, ['Account sequence changed']);
  assert.equal(broadcasts(node).length, 0);
  for (const secret of s.secrets) assert.ok(allZero(secret));
});

test('gas that does not fit 600,000 with 1.3x headroom stops before signing', async () => {
  const node = fakeNode({ simulateGas: 420000 });
  const { error, spies: s } = await run(node, { broadcast: true, answers: [SIGN_CONFIRMATION, BROADCAST_CONFIRMATION] });
  assert.equal(error.message, 'Simulated gas exceeds the safe gas limit');
  assert.deepEqual(s.calls, { signPop: 0, signClassical: 0 });
  const late = fakeNode({ popSimulateGas: 470000 });
  const second = await run(late, { broadcast: true, answers: [SIGN_CONFIRMATION, BROADCAST_CONFIRMATION] });
  assert.equal(second.error.message, 'Simulated gas exceeds the safe gas limit');
  assert.equal(second.spies.calls.signClassical, 0);
  assert.equal(broadcasts(late).length, 0);
});

test('a refused broadcast reports only the public code', async () => {
  const node = fakeNode({ broadcastCode: 13 });
  const { error, outputs } = await run(node, { broadcast: true, answers: [SIGN_CONFIRMATION, BROADCAST_CONFIRMATION] });
  assert.equal(error.message, 'Broadcast refused by the node');
  assert.equal(JSON.parse(outputs.at(-1)).code, 13);
  for (const text of outputs) for (const secret of SECRETS) assert.equal(text.includes(secret), false);
});

test('the network guard allows only the Diana hosts, reads, simulation, and an opened broadcast', async () => {
  const seen = [];
  let open = false;
  const fetch = guardedFetch({ rest: REST, evmRpc: EVM_RPC }, { allowBroadcast: () => open, fetchImpl: async (url, init) => { seen.push([url, init.redirect, init.credentials]); return new Response('{}'); } });
  await fetch(REST + '/cosmos/auth/v1beta1/accounts/x');
  await fetch(REST + '/cosmos/tx/v1beta1/simulate', { method: 'POST', body: '{}' });
  await fetch(EVM_RPC, { method: 'POST', body: JSON.stringify({ method: 'eth_chainId' }) });
  for (const [url, init] of [
    ['https://example.com/cosmos/auth/v1beta1/accounts/x', {}],
    [REST.replace('https:', 'http:') + '/cosmos/auth/v1beta1/accounts/x', {}],
    [REST + '/cosmos/tx/v1beta1/txs', { method: 'POST', body: '{}' }],
    [EVM_RPC, { method: 'POST', body: JSON.stringify({ method: 'eth_sendRawTransaction' }) }],
    [REST + '/cosmos/bank/v1beta1/balances/x', { method: 'DELETE' }],
  ]) await assert.rejects(fetch(url, init), /Network request blocked/);
  open = true;
  await fetch(REST + '/cosmos/tx/v1beta1/txs', { method: 'POST', body: '{}' });
  assert.equal(seen.length, 4);
  for (const [, redirect, credentials] of seen) assert.deepEqual([redirect, credentials], ['error', 'omit']);
});

test('failure messages never echo SDK errors or record contents', () => {
  assert.equal(failureMessage(new Error('Account sequence changed')), 'Registration stopped');
  assert.equal(failureMessage(new PreflightError(['Account sequence changed', 'secret ' + PUBLIC_TEST_MNEMONIC])), 'Pre-flight failed: Account sequence changed');
  assert.equal(failureMessage(new Error('Invalid mnemonic: ' + PUBLIC_TEST_MNEMONIC)), 'Registration stopped');
  assert.equal(failureMessage(new Error('Simulation failed')), 'Simulation failed');
  assert.equal(failureMessage(new Error('Recovery record does not derive the expected account')), 'Recovery record does not derive the expected account');
  assert.equal(failureMessage(undefined), 'Registration stopped');
});

test('unreadable record bytes are refused with a fixed message and zeroed', async () => {
  for (const bytes of [Buffer.from('{not json'), Buffer.alloc(0), Buffer.alloc(5000, 0x20), Buffer.from('null')]) {
    const node = fakeNode();
    await assert.rejects(runRegistration({ recordBytes: bytes, expected: EXPECTED, network: node.network, confirm: async () => '', write: () => {} }), /Unreadable recovery record/);
    assert.ok(allZero(bytes));
    assert.equal(node.requests.length, 0);
  }
});

test('redirected input is refused before the vault is touched, with no output', () => {
  for (const args of [[], ['--broadcast']]) {
    const result = spawnSync(process.execPath, [scriptPath, ...args], { input: PREPARE_CONFIRMATION + '\n' + SIGN_CONFIRMATION + '\n' + BROADCAST_CONFIRMATION + '\n', encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^Diana PQC registration stopped: Interactive Windows terminal required\. No file was written\.\n$/);
  }
});

test('the tool writes no file, logs nothing, and gates the record read and the broadcast', () => {
  assert.equal(/writeFile|appendFile|createWriteStream|mkdir|rename|unlink|rmSync|copyFile|truncate|console\./.test(source), false);
  assert.equal([...source.matchAll(/allowBroadcast\.value = true/g)].length, 1);
  const main = source.slice(source.indexOf('async function main'));
  assert.ok(main.indexOf('isTTY') < main.indexOf('PREPARE_CONFIRMATION') && main.indexOf('PREPARE_CONFIRMATION') < main.indexOf('readRecordBytes(RECORD_PATH)'));
  const flow = source.slice(source.indexOf('export async function runRegistration'), source.indexOf('export function failureMessage'));
  const pick = (text, from = 0) => flow.indexOf(text, from);
  const afterBroadcastConfirm = pick('confirm(BROADCAST_CONFIRMATION)');
  const preBroadcast = pick('requirePreflight(await fetchLiveState', afterBroadcastConfirm);
  assert.ok(preBroadcast > afterBroadcastConfirm && preBroadcast < pick('allowBroadcast.value = true'), 'pre-broadcast re-check');
  const preSign = pick('requirePreflight(await fetchLiveState', pick('confirm(SIGN_CONFIRMATION)'));
  assert.ok(preSign > pick('confirm(SIGN_CONFIRMATION)') && preSign < pick('signedProofOfPossession('), 'pre-sign re-check');
  assert.equal(/for \(|while \(|retry\(/.test(flow.slice(pick('allowBroadcast.value = true'))), false, 'no retry loop around the broadcast');
  const order = ['simulateUnsigned(', 'if (!broadcast)', 'confirm(SIGN_CONFIRMATION)', 'signedProofOfPossession(', 'signClassicalEth', 'confirm(BROADCAST_CONFIRMATION)', 'allowBroadcast.value = true', '/cosmos/tx/v1beta1/txs'].map(s => flow.indexOf(s));
  assert.ok(order.every(i => i > 0));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('the signed transaction is the final simulated one; only the signature differs, and its fields are pinned', async () => {
  const { TxRaw, TxBody, AuthInfo } = await import('cosmjs-types/cosmos/tx/v1beta1/tx');
  const node = fakeNode();
  const s = spies();
  const captured = [];
  const sign = s.deps.signClassical;
  s.deps.signClassical = params => { captured.push(params); return sign(params); };
  const { error } = await run(node, { broadcast: true, answers: [SIGN_CONFIRMATION, BROADCAST_CONFIRMATION], spies: s });
  assert.equal(error, undefined);
  assert.equal(captured.length, 1);
  const p = captured[0];
  assert.equal(p.chainId, 'qorechain-diana');
  assert.equal(p.accountNumber, 16046n);
  assert.equal(p.sequence, 0n);
  assert.deepEqual(p.fee, { amount: [{ denom: 'uqor', amount: '90000' }], gas: '600000' });
  assert.equal(p.memo, '');
  assert.equal(p.account.publicKey, account.publicKey);
  assert.equal(p.messages.length, 1);
  const v = p.messages[0].value;
  assert.equal(v.sender, account.cosmos);
  assert.deepEqual(Buffer.from(v.publicKey), Buffer.from(account.pqc.publicKey));
  assert.ok(sdk.verifyProofOfPossession({ chainId: 'qorechain-diana', account: account.cosmos, publicKey: v.publicKey, proof: v.proofOfPossession }));

  const simulations = node.requests.filter(r => r.path === '/cosmos/tx/v1beta1/simulate');
  assert.equal(simulations.length, 2, 'prepare (no PoP) and final (with PoP)');
  const simulated = TxRaw.decode(Buffer.from(JSON.parse(simulations[1].body).tx_bytes, 'base64'));
  const sent = TxRaw.decode(Buffer.from(JSON.parse(broadcasts(node)[0].body).tx_bytes, 'base64'));
  // Same body (message with PoP, memo) and auth info (public key, sequence, fee, gas) ...
  assert.deepEqual(Buffer.from(sent.bodyBytes), Buffer.from(simulated.bodyBytes));
  assert.deepEqual(Buffer.from(sent.authInfoBytes), Buffer.from(simulated.authInfoBytes));
  // ... and only the signature differs: an all-zero placeholder simulated, a real one sent.
  assert.equal(simulated.signatures.length, 1);
  assert.ok(simulated.signatures[0].every(b => b === 0));
  assert.equal(sent.signatures.length, 1);
  assert.equal(sent.signatures[0].length, 64);
  assert.equal(sent.signatures[0].every(b => b === 0), false);
  const auth = AuthInfo.decode(sent.authInfoBytes);
  assert.equal(auth.signerInfos[0].sequence, 0n);
  assert.equal(auth.fee.gasLimit, 600000n);
  assert.equal(TxBody.decode(sent.bodyBytes).messages[0].typeUrl, '/qorechain.pqc.v1.MsgRegisterPQCKeyV2');
});

test('a signed transaction that differs from the simulation is never sent', async () => {
  const node = fakeNode();
  const s = spies();
  const sign = s.deps.signClassical;
  s.deps.signClassical = params => sign({ ...params, memo: 'changed' });
  const { error } = await run(node, { broadcast: true, answers: [SIGN_CONFIRMATION, BROADCAST_CONFIRMATION], spies: s });
  assert.equal(error.message, 'Signed transaction differs from the simulation');
  assert.equal(broadcasts(node).length, 0);
});

test('a PQC key or sequence change while waiting at either confirmation stops before signing or sending', async () => {
  for (const [phrase, change, failure] of [
    [SIGN_CONFIRMATION, { pqcFound: true }, 'PQC key already registered'],
    [SIGN_CONFIRMATION, { sequence: '1' }, 'Account sequence changed'],
    [BROADCAST_CONFIRMATION, { pqcFound: true }, 'PQC key already registered'],
    [BROADCAST_CONFIRMATION, { sequence: '1' }, 'Account sequence changed'],
  ]) {
    const node = fakeNode();
    const { error, spies: s } = await run(node, { broadcast: true, answers: [SIGN_CONFIRMATION, BROADCAST_CONFIRMATION], onConfirm: (p, chain) => { if (p === phrase) Object.assign(chain, change); } });
    assert.ok(error instanceof PreflightError, phrase + ' ' + failure);
    assert.deepEqual(error.failures, [failure]);
    assert.equal(broadcasts(node).length, 0);
    assert.equal(node.network.allowBroadcast.value, false);
    if (phrase === SIGN_CONFIRMATION) assert.deepEqual(s.calls, { signPop: 0, signClassical: 0 });
    for (const secret of s.secrets) assert.ok(allZero(secret));
  }
});

test('a lost or unreadable broadcast answer is reported as unknown, with the hash, and never retried', async () => {
  for (const broadcastMode of ['network-error', 'garbage']) {
    const node = fakeNode({ broadcastMode });
    const { error, outputs, spies: s } = await run(node, { broadcast: true, answers: [SIGN_CONFIRMATION, BROADCAST_CONFIRMATION] });
    assert.equal(error.message, 'Broadcast result unknown');
    assert.equal(failureMessage(error), 'Broadcast result unknown');
    assert.equal(broadcasts(node).length, 1, 'exactly one attempt');
    const last = JSON.parse(outputs.at(-1));
    assert.equal(last.broadcast, 'unknown');
    assert.match(last.txHash, /^[0-9A-F]{64}$/);
    assert.equal(node.network.allowBroadcast.value, false);
    for (const text of outputs) for (const secret of SECRETS) assert.equal(text.includes(secret), false);
    assert.equal(outputs.some(t => t.includes('gateway timeout') || t.includes('fetch failed')), false);
    for (const secret of s.secrets) assert.ok(allZero(secret));
  }
});

test('re-running after a broadcast is refused by the pre-flight', async () => {
  const node = fakeNode({ sequence: '1', pqcFound: true });
  const { error, spies: s } = await run(node, { broadcast: true, answers: [SIGN_CONFIRMATION, BROADCAST_CONFIRMATION] });
  assert.deepEqual(error.failures, ['Account sequence changed', 'PQC key already registered']);
  assert.deepEqual(s.calls, { signPop: 0, signClassical: 0 });
  assert.equal(broadcasts(node).length, 0);
});

test('the broadcast route passes at most once per guard, even while open', async () => {
  let calls = 0;
  const fetch = guardedFetch({ rest: REST, evmRpc: EVM_RPC }, { allowBroadcast: () => true, fetchImpl: async () => { calls++; return new Response('{}'); } });
  await fetch(REST + '/cosmos/tx/v1beta1/txs', { method: 'POST', body: '{}' });
  await assert.rejects(fetch(REST + '/cosmos/tx/v1beta1/txs', { method: 'POST', body: '{}' }), /Network request blocked/);
  assert.equal(calls, 1);
});
