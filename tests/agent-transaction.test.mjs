// 7C-29: status of one Diana testnet transaction by hash, through the agent session and the tool
// registry. Read-only: only eth_chainId, eth_getTransactionByHash, and eth_getTransactionReceipt may
// be sent, to the fixed official Diana EVM JSON-RPC. No signing, sending, broadcasting, or wallet.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessRisk, decideIntent, interpretCommand } from '../src/agent/intent.ts';
import { getTool, guardFetch, invokeTool, listTools } from '../src/agent/registry.ts';
import { createSession } from '../src/agent/session.ts';
import { decideTransaction, recognizeTransactionRequest } from '../src/agent/transaction.ts';
import { getEvmTransaction } from '../src/qorechain/get-evm-transaction.ts';

const HASH = '0x37276931206bb3ba2204ea20e2911a40ec9fc194cc4a0bc1e3c040c1b8920ee0';
const FROM = '0xd6c6bdfbe567bce731907789800205df0b78ca52';
const TO = '0xa1378d6558b32e1f8d37b68cf90e3c93839da365';
const EVM = 'https://evm-testnet.qore.host/';
const KEY = '0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318';

// The live shape of a Diana transaction and receipt (block 0x9ccb2a), trimmed to what ELA reads.
const txAt = (blockNumber = '0x9ccb2a', extra = {}) => ({
  hash: HASH, blockNumber, from: FROM, to: TO, value: '0x0', nonce: '0x4bb', chainId: '0x2648', type: '0x2', ...extra,
});
const receiptOf = (status = '0x1', extra = {}) => ({
  transactionHash: HASH, blockNumber: '0x9ccb2a', status, gasUsed: '0x63275', contractAddress: null, from: FROM, to: TO, ...extra,
});

/** A scripted Diana EVM JSON-RPC. Records every request. */
function diana({ chain = '0x2648', tx = txAt(), receipt = receiptOf(), reply } = {}) {
  const requests = [];
  const fetch = async (input, init = {}) => {
    const body = JSON.parse(init.body);
    requests.push({ url: String(input), method: init.method, credentials: init.credentials, redirect: init.redirect, rpc: body.method, params: body.params });
    if (reply) { const custom = await reply(body); if (custom) return custom; }
    const result = { eth_chainId: chain, eth_getTransactionByHash: tx, eth_getTransactionReceipt: receipt, eth_blockNumber: '0x97e6b0' }[body.method];
    return Response.json({ jsonrpc: '2.0', id: body.id, result });
  };
  return { fetch, requests };
}
const noRequest = async () => assert.fail('no request may be sent');

// --- Recognition and the safety gate ---------------------------------------------------------------

const RECOGNIZED = [
  HASH + ' işleminin durumu nedir?',
  HASH + " hash'li işlemi sorgula.",
  'Bu işlemin durumunu göster: ' + HASH,
  'Diana test ağında ' + HASH + ' işlemi başarılı mı?',
  HASH + ' işlemi hangi blokta?',
  'İŞLEM DURUMU ' + HASH.toUpperCase().replace('0X', '0x'),
  'What is the status of transaction ' + HASH + '?',
  'Check transaction ' + HASH + ' on Diana testnet',
  'Show me the receipt for ' + HASH,
  'Did tx ' + HASH + ' succeed?',
  'Is transaction ' + HASH + ' pending?',
  'tx ' + HASH,
  HASH + ' transaction status',
];

for (const command of RECOGNIZED) {
  test('recognizes transaction query: ' + command, async () => {
    const recognized = recognizeTransactionRequest(command);
    assert.deepEqual([recognized.kind, recognized.hash], ['transaction', HASH]);
    assert.equal(recognized.rest.includes('0x'), false);
    const decision = await interpretCommand(command, undefined);
    assert.deepEqual({ ...decision }, { kind: 'run', query: 'transaction', intent: 'transaction', source: 'deterministic', hash: HASH });
    assert.ok(Object.isFrozen(decision));
  });
}

for (const value of [
  '0x' + 'a'.repeat(63), // too short
  '0x' + 'a'.repeat(65), // too long
  '0x' + 'g'.repeat(64), // not hexadecimal
  FROM, // an address, not a hash
  '0x1234abcd5678',
  '0x',
]) {
  test('invalid transaction hash is rejected before any request: ' + value, async () => {
    for (const command of ['Transaction ' + value + ' status', value + ' işleminin durumu nedir?']) {
      const session = createSession({ fetch: noRequest });
      const result = await session.handleCommand(command);
      if (value === '0x') {
        // Too short to be looked at as a hash at all: not a transaction query, and nothing is sent.
        assert.notEqual(result.kind, 'answered');
        continue;
      }
      assert.deepEqual([result.kind, result.reason, result.decision.source], ['clarify', 'invalid_hash', 'input_check'], command);
    }
  });
}

test('the safety gate itself is unchanged: a bare 64-hex value is still key material', () => {
  assert.deepEqual(assessRisk(HASH), { risk: 'blocked', category: 'key_material' });
  assert.deepEqual(assessRisk('transaction ' + HASH), { risk: 'blocked', category: 'key_material' });
});

for (const [command, reason] of [
  // Not a transaction-lookup sentence: the gate refuses the 64-hex value as before.
  [HASH, 'key_material'],
  [HASH.slice(2), 'key_material'],
  ['Bu anahtarı kullan: ' + KEY, 'key_material'],
  ['My private key is ' + KEY + ', check its transaction', 'key_material'],
  ['Import wallet ' + KEY, 'key_material'],
  ['İşlem durumu ' + HASH.slice(2), 'key_material'], // no 0x prefix
  // Requests to act on a transaction are never lookups.
  ['Sign transaction ' + HASH, 'key_material'],
  ['Broadcast transaction ' + HASH, 'key_material'],
  ['Cancel transaction ' + HASH, 'key_material'],
  ['Speed up tx ' + HASH, 'key_material'],
  [HASH + ' işlemini onayla', 'key_material'],
  [HASH + ' işlemini yeniden gönder', 'key_material'],
  ['Check transaction ' + HASH + ' then send 5 QOR to Alice', 'key_material'],
]) {
  test('refused with no request: ' + command, async () => {
    const session = createSession({ fetch: noRequest, classifier: { classify: () => assert.fail('no classifier call') } });
    const result = await session.handleCommand(command);
    assert.deepEqual([result.kind, result.reason], ['refused', reason]);
  });
}

test('the gate still runs on the rest of a transaction sentence', () => {
  // decideTransaction is only reached for the lookup vocabulary, which has no risky verb; a risky
  // rest would be refused (checked here directly).
  assert.equal(recognizeTransactionRequest('Send transaction ' + HASH).kind, 'none');
  assert.deepEqual({ ...decideTransaction(HASH + ' işleminin durumu nedir?') }, { kind: 'run', query: 'transaction', intent: 'transaction', source: 'deterministic', hash: HASH });
  assert.equal(decideTransaction('Show the balance of qor178nscfyp0cq2ac5x7un4u98xrj4ayp6pt0kw08'), undefined);
});

for (const [command, expected] of [
  // Network words are outside the lookup vocabulary, so the gate refuses the 64-hex value; nothing is sent.
  ['Transaction ' + HASH + ' on mainnet', 'refused'],
  ['Ethereum tx ' + HASH, 'refused'],
  ['Transactions ' + HASH + ' and ' + HASH, 'refused'], // two values: not a lookup; the gate refuses
  ['What is the latest block hash?', 'unsupported'],
  ['Son işlemlerimi göster.', 'unsupported'],
]) {
  test('not run as a transaction query: ' + command, async () => {
    const result = await createSession({ fetch: noRequest }).handleCommand(command);
    assert.equal(result.kind === 'clarify' ? 'clarify:' + result.reason : result.kind, expected);
  });
}

// --- Session and status ----------------------------------------------------------------------------

test('a mined transaction sends eth_chainId, eth_getTransactionByHash, eth_getTransactionReceipt and is reported as success', async () => {
  const net = diana();
  const session = createSession({ fetch: net.fetch });
  const result = await session.handleCommand('What is the status of transaction ' + HASH.toUpperCase().replace('0X', '0x') + '?');
  assert.deepEqual([result.kind, result.query, result.outcome, result.run.kind, result.run.hash], ['answered', 'transaction', 'success', 'transaction', HASH]);
  assert.deepEqual(result.run.result, {
    ok: true, tool: 'get_transaction', network: 'qorechain-diana',
    data: {
      chainId: 'qorechain-diana', evmChainId: '9800', hash: HASH, status: 'success', blockNumber: '10275626',
      from: FROM, to: TO, valueQor: '0', nonce: '1211', gasUsed: '406133',
    },
  });
  assert.deepEqual(net.requests, [
    { url: EVM, method: 'POST', credentials: 'omit', redirect: 'error', rpc: 'eth_chainId', params: [] },
    { url: EVM, method: 'POST', credentials: 'omit', redirect: 'error', rpc: 'eth_getTransactionByHash', params: [HASH] },
    { url: EVM, method: 'POST', credentials: 'omit', redirect: 'error', rpc: 'eth_getTransactionReceipt', params: [HASH] },
  ]);
  assert.equal(session.context, undefined);
});

for (const [name, options, expected, sent] of [
  ['a reverted transaction is failed', { receipt: receiptOf('0x0') }, { status: 'failed', blockNumber: '10275626' }, 3],
  ['a transaction outside a block is pending (no receipt read)', { tx: txAt(null), receipt: null }, { status: 'pending', blockNumber: undefined }, 2],
  ['an unknown hash is not found (no receipt read)', { tx: null, receipt: null }, { status: 'not_found', from: undefined }, 2],
  ['a contract creation has no recipient', { tx: txAt('0x9ccb2a', { to: null }), receipt: receiptOf('0x1', { contractAddress: TO }) }, { status: 'success', to: undefined, contractAddress: TO }, 3],
  ['a value is shown exactly in QOR', { tx: txAt('0x9ccb2a', { value: '0xde0b6b3a7640001' }) }, { valueQor: '1.000000000000000001' }, 3],
  ['a legacy transaction without chainId is accepted', { tx: txAt('0x9ccb2a', { chainId: undefined }) }, { status: 'success' }, 3],
]) {
  test(name, async () => {
    const net = diana(options);
    const result = await createSession({ fetch: net.fetch }).handleCommand('tx ' + HASH);
    assert.equal(result.outcome, 'success');
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(result.run.result.data[key], value, key);
    assert.equal(net.requests.length, sent);
  });
}

test('a transaction query never changes the conversation context', async () => {
  const net = diana();
  const session = createSession({ fetch: net.fetch });
  await session.handleCommand('Son blok kaç?');
  const before = session.context;
  await session.handleCommand('tx ' + HASH);
  assert.equal(session.context, before);
  net.requests.length = 0;
  const next = await session.handleCommand('Peki şimdi kaç oldu?');
  assert.deepEqual([next.query, net.requests.map(request => request.rpc)], ['block_number', ['eth_chainId', 'eth_blockNumber']]);
});

const rpcError = id => ({ jsonrpc: '2.0', id, error: { code: -32000, message: 'private upstream detail' } });
for (const [name, options, code, sent] of [
  ['the endpoint reports another chain', { chain: '0x1' }, 'chain_mismatch', 1],
  ['the transaction was signed for another chain', { tx: txAt('0x9ccb2a', { chainId: '0x1' }) }, 'chain_mismatch', 2],
  ['the endpoint is unreachable', { reply: () => { throw new TypeError('Failed to fetch'); } }, 'network_error', 1],
  ['the endpoint fails', { reply: () => new Response('private upstream detail', { status: 503 }) }, 'http_error', 1],
  ['the transaction read returns a JSON-RPC error', { reply: body => body.method === 'eth_getTransactionByHash' && Response.json(rpcError(2)) }, 'invalid_response', 2],
  ['the receipt read returns a JSON-RPC error', { reply: body => body.method === 'eth_getTransactionReceipt' && Response.json(rpcError(3)) }, 'invalid_response', 3],
  ['the receipt is missing for a mined transaction', { receipt: null }, 'invalid_response', 3],
  ['the node returns another transaction', { tx: txAt('0x9ccb2a', { hash: '0x' + 'cd'.repeat(32) }) }, 'invalid_response', 2],
  ['the receipt is for another transaction', { receipt: receiptOf('0x1', { transactionHash: '0x' + 'cd'.repeat(32) }) }, 'invalid_response', 3],
  ['the receipt is in another block', { receipt: receiptOf('0x1', { blockNumber: '0x9ccb2b' }) }, 'invalid_response', 3],
  ['the receipt status is unknown', { receipt: receiptOf('0x2') }, 'invalid_response', 3],
  ['the receipt has no status', { receipt: receiptOf('0x1', { status: undefined }) }, 'invalid_response', 3],
  ['the sender is malformed', { tx: txAt('0x9ccb2a', { from: '0x12' }) }, 'invalid_response', 2],
  ['the block number has leading zeros', { tx: txAt('0x09ccb2a') }, 'invalid_response', 2],
  ['the value is negative', { tx: txAt('0x9ccb2a', { value: '-0x1' }) }, 'invalid_response', 2],
  ['the transaction is not an object', { tx: 'pending' }, 'invalid_response', 2],
  ['the body is not JSON', { reply: body => body.method === 'eth_getTransactionByHash' && new Response('<html>') }, 'invalid_response', 2],
]) {
  test('transaction read fails safely when ' + name, async () => {
    const net = diana(options);
    const session = createSession({ fetch: net.fetch });
    const result = await session.handleCommand('tx ' + HASH);
    assert.deepEqual([result.kind, result.outcome], ['answered', 'failed']);
    assert.deepEqual([result.run.result.ok, result.run.result.error.stage, result.run.result.error.code], [false, 'execution', code]);
    assert.equal(result.run.result.error.message.includes('private upstream detail'), false);
    assert.equal(net.requests.length, sent);
    assert.equal(session.context, undefined);
  });
}

test('transaction read times out safely', async () => {
  const result = await createSession({ timeoutMs: 20, fetch: async () => new Response(new ReadableStream()) }).handleCommand('tx ' + HASH);
  assert.deepEqual([result.outcome, result.run.result.error.code], ['failed', 'timeout']);
});

// --- Registry and guard ------------------------------------------------------------------------------

test('get_transaction is a frozen, read-only Diana tool with three read methods', () => {
  const tool = getTool('get_transaction');
  assert.deepEqual([tool.id, tool.network, tool.readOnly], ['get_transaction', 'qorechain-diana', true]);
  assert.deepEqual(tool.rpcMethods, ['eth_chainId', 'eth_getTransactionByHash', 'eth_getTransactionReceipt']);
  assert.deepEqual(Object.keys(tool.params), ['hash']);
  assert.ok(Object.isFrozen(tool) && Object.isFrozen(tool.rpcMethods) && Object.isFrozen(tool.params));
  for (const entry of listTools()) assert.doesNotMatch(entry.id, /sign|send|transfer|wallet|broadcast/u);
  // The other tools still cannot read transactions.
  for (const id of ['get_evm_block_number', 'get_balance']) assert.equal(getTool(id).rpcMethods.some(method => method.includes('Transaction')), false);
});

const txRequest = (overrides = {}) => ({
  tool: 'get_transaction', network: 'qorechain-diana', params: { hash: HASH },
  rpcMethods: ['eth_chainId', 'eth_getTransactionByHash', 'eth_getTransactionReceipt'], ...overrides,
});

for (const [name, overrides, code] of [
  ['another network', { network: 'qorechain-mainnet' }, 'network_not_allowed'],
  ['a broadcast method', { rpcMethods: ['eth_sendRawTransaction'] }, 'method_not_allowed'],
  ['a signing method', { rpcMethods: ['eth_signTransaction'] }, 'method_not_allowed'],
  ['a call method', { rpcMethods: ['eth_call'] }, 'method_not_allowed'],
  ['no hash', { params: {} }, 'invalid_params'],
  ['an upper-case hash', { params: { hash: HASH.toUpperCase() } }, 'invalid_params'],
  ['a short hash', { params: { hash: HASH.slice(0, -1) } }, 'invalid_params'],
  ['an address', { params: { hash: FROM } }, 'invalid_params'],
  ['an extra parameter', { params: { hash: HASH, url: 'https://evil.example' } }, 'invalid_params'],
]) {
  test('get_transaction refuses ' + name + ' before any request', async () => {
    const result = await invokeTool(txRequest(overrides), { fetch: noRequest });
    assert.deepEqual([result.ok, result.error.stage, result.error.code], [false, 'validation', code]);
  });
}

test('runtime options cannot redirect the transaction tool to another endpoint', async () => {
  const net = diana();
  const result = await invokeTool(txRequest(), { fetch: net.fetch, rpcUrl: 'https://evil.example', restUrl: 'https://evil.example' });
  assert.equal(result.ok, true);
  assert.ok(net.requests.every(request => request.url === EVM));
});

test('the transaction guard lets only its three read methods through', async () => {
  let sent = 0;
  const guarded = guardFetch(async () => { sent++; return Response.json({}); }, getTool('get_transaction').rpcMethods);
  const rpc = method => JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] });
  for (const method of ['eth_chainId', 'eth_getTransactionByHash', 'eth_getTransactionReceipt']) await guarded(EVM, { method: 'POST', body: rpc(method) });
  for (const method of ['eth_sendRawTransaction', 'eth_sendTransaction', 'eth_signTransaction', 'eth_sign', 'personal_sign', 'eth_call', 'eth_getBalance', 'txpool_content']) {
    await assert.rejects(guarded(EVM, { method: 'POST', body: rpc(method) }), TypeError, method);
  }
  await assert.rejects(guarded(EVM, { method: 'POST', body: JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionByHash', params: [] }]) }), TypeError);
  assert.equal(sent, 3);
});

test('getEvmTransaction refuses an invalid hash before any request', async () => {
  for (const hash of [HASH.slice(0, -1), FROM, 'abc', 42]) {
    await assert.rejects(getEvmTransaction(hash, { fetch: noRequest }), { name: 'QoreChainReadError' });
  }
});

test('a classifier has no transaction label and cannot supply a hash', () => {
  for (const output of [[{ label: 'transaction', score: 0.99 }], [{ label: 'get_transaction', score: 0.99 }], [{ label: 'block_number', score: 0.99, hash: HASH }]]) {
    assert.deepEqual({ ...decideIntent(output, undefined) }, { kind: 'clarify', reason: 'invalid_classifier_output', source: 'classifier' });
  }
});
