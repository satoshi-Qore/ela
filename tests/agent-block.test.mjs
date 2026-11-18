// 7C-30: one Diana testnet block by number, through the agent session and the tool registry.
// Read-only: only eth_chainId, eth_getBlockByNumber (without full transactions), and eth_blockNumber
// may be sent, to the fixed official Diana EVM JSON-RPC. No signing, sending, or wallet.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decideIntent, interpretCommand } from '../src/agent/intent.ts';
import { getTool, guardFetch, invokeTool, listTools } from '../src/agent/registry.ts';
import { createSession } from '../src/agent/session.ts';
import { decideBlock, recognizeBlockRequest } from '../src/agent/block.ts';
import { getEvmBlock } from '../src/qorechain/get-evm-block.ts';

const EVM = 'https://evm-testnet.qore.host/';
const NUMBER = 10275626;
const HEX = '0x9ccb2a';
const HASH = '0xee996a32a68eb1cd946db5dcf6f2d6bb42b969ccafea758e9312f8053155b0e6';
const TX = '0x37276931206bb3ba2204ea20e2911a40ec9fc194cc4a0bc1e3c040c1b8920ee0';

// The live shape of Diana block 10275626 (trimmed to the fields ELA reads, plus two it ignores).
const blockAt = (extra = {}) => ({
  number: HEX, hash: HASH, timestamp: '0x6afcbbab', gasUsed: '0x63275', gasLimit: '0xffffffff',
  transactions: [TX], miner: '0xb88aff088652cbd32932790f7bc038a0c3337328', baseFeePerGas: '0x174876e800', ...extra,
});
// The node's oldest kept block (it is pruned; "earliest" is not genesis).
const EARLIEST = blockAt({ number: '0x86230f', hash: '0x' + 'fb'.repeat(32), transactions: [], gasUsed: '0x0' });

/** A scripted Diana EVM JSON-RPC. Records every request. */
function diana({ chain = '0x2648', block = blockAt(), latest = '0x9d07c2', earliest = EARLIEST, reply } = {}) {
  const requests = [];
  const fetch = async (input, init = {}) => {
    const body = JSON.parse(init.body);
    requests.push({ url: String(input), method: init.method, credentials: init.credentials, redirect: init.redirect, rpc: body.method, params: body.params });
    if (reply) { const custom = await reply(body); if (custom) return custom; }
    const result = body.method === 'eth_chainId' ? chain
      : body.method === 'eth_blockNumber' ? latest
      : body.params[0] === 'earliest' ? earliest : block;
    return Response.json({ jsonrpc: '2.0', id: body.id, result });
  };
  return { fetch, requests };
}
const noRequest = async () => assert.fail('no request may be sent');
const classifierMustNotRun = { classify: () => assert.fail('no classifier call') };

// --- Recognition -----------------------------------------------------------------------------------

const RECOGNIZED = [
  // Turkish
  [NUMBER + ' numaralı bloğu göster', NUMBER],
  ["Diana'da " + NUMBER + ' numaralı bloğu göster.', NUMBER],
  [NUMBER + '. bloğu göster', NUMBER],
  [NUMBER + " numaralı blokta kaç işlem var?", NUMBER],
  ['Blok ' + NUMBER + ' bilgilerini getir', NUMBER],
  [NUMBER + " numaralı bloğun hash'i nedir?", NUMBER],
  ['Diana test ağında ' + NUMBER + " numaralı bloğun detaylarını göster lütfen", NUMBER],
  ['BLOK ' + NUMBER + ' GÖSTER', NUMBER],
  [NUMBER + "'inci blok", NUMBER],
  ['Blok no ' + NUMBER, NUMBER],
  ['blok 0 göster', 0],
  // English
  ['Show block ' + NUMBER, NUMBER],
  ['Block ' + NUMBER + ' details', NUMBER],
  ['What is in block ' + NUMBER + ' on Diana?', NUMBER],
  ['Get block #' + NUMBER, NUMBER],
  ['How many transactions are in block ' + NUMBER + '?', NUMBER],
  ['Block number ' + NUMBER + ' on Diana testnet, please', NUMBER],
  ['Show the hash, timestamp and gas used of block ' + NUMBER, NUMBER],
  ['Show block 9007199254740991', Number.MAX_SAFE_INTEGER],
];

for (const [command, number] of RECOGNIZED) {
  test('recognizes block query: ' + command, async () => {
    assert.deepEqual(recognizeBlockRequest(command), { kind: 'block', number });
    const decision = await interpretCommand(command, undefined);
    assert.deepEqual({ ...decision }, { kind: 'run', query: 'block', intent: 'block', source: 'deterministic', blockNumber: number });
    assert.ok(Object.isFrozen(decision));
  });
}

for (const command of [
  'Show block -5',
  'Blok −5 göster',
  'block number +5',
  'Show block 1.5',
  'Blok 10.275.626 göster',
  'Get block 10,275,626',
  'block number 1_000',
  'Block 007 details',
  'Show block 9007199254740992', // 2^53, one above the largest safe integer
  'Show block 99999999999999999999999999999',
  'Blok ' + '1'.repeat(80) + ' göster',
  'Blocks 10 and 11',
  'blok 10 ve 20',
]) {
  test('invalid block number is refused before any request: ' + command.slice(0, 48), async () => {
    assert.equal(recognizeBlockRequest(command).kind, 'invalid_block_number');
    const session = createSession({ fetch: noRequest, classifier: classifierMustNotRun });
    const result = await session.handleCommand(command);
    assert.deepEqual([result.kind, result.reason, result.decision.source], ['clarify', 'invalid_block_number', 'input_check'], command);
  });
}

for (const [command, expected] of [
  // Another network: the network check on the whole command runs before the block rules.
  ['Show Ethereum block ' + NUMBER, 'clarify:unsupported_network'],
  ['Mainnet block ' + NUMBER, 'clarify:unsupported_network'],
  ["Ana ağda " + NUMBER + ' numaralı bloğu göster', 'clarify:unsupported_network'],
  ['Show block ' + NUMBER + ' on Bitcoin', 'clarify:unsupported_network'],
  // The safety gate on the whole command runs before the block rules.
  ['Send 5 QOR in block ' + NUMBER, 'refused'],
  ['Blok ' + NUMBER + ' için cüzdanımı bağla', 'refused'],
  ['Sign block ' + NUMBER, 'not answered'], // no signing request to the gate, but outside the block vocabulary
  // Not a block-by-number sentence: unchanged behavior, nothing is sent.
  ['Show the last 5 blocks', 'not answered'],
  ['Son 5 blok', 'not answered'],
  ['Block ' + NUMBER + ' transfer', 'not answered'],
  ['Blok ' + NUMBER + ' kimin?', 'not answered'],
  ['Block 0x9ccb2a', 'not answered'],
  ['Show block abc', 'not answered'],
  // A bare block word and number stays ambiguous, as the evaluation sets label "Block 100.".
  ['Block 100.', 'not answered'],
  ['blok ' + NUMBER, 'not answered'],
  [NUMBER + '. blok', 'not answered'],
  [String(NUMBER), 'not answered'],
]) {
  test('not run as a block query: ' + command, async () => {
    const result = await createSession({ fetch: noRequest }).handleCommand(command);
    const kind = result.kind === 'clarify' ? 'clarify:' + result.reason : result.kind;
    if (expected === 'not answered') assert.notEqual(result.kind, 'answered', command);
    else assert.equal(kind, expected, command);
  });
}

test('the latest-block queries are unchanged', async () => {
  for (const command of ['Son blok kaç?', "What's the latest block?", 'son blok numarası nedir']) {
    const net = diana();
    const result = await createSession({ fetch: net.fetch }).handleCommand(command);
    assert.deepEqual([result.kind, result.query], ['answered', 'block_number'], command);
    assert.deepEqual(net.requests.map(request => request.rpc), ['eth_chainId', 'eth_blockNumber']);
  }
});

test('decideBlock ignores any other command', () => {
  assert.equal(decideBlock('Son blok kaç?'), undefined);
  assert.equal(decideBlock('Show the balance of qor178nscfyp0cq2ac5x7un4u98xrj4ayp6pt0kw08'), undefined);
  assert.equal(recognizeBlockRequest(42).kind, 'none');
});

// --- Session and the read ----------------------------------------------------------------------------

test('a block is read with eth_chainId then eth_getBlockByNumber (hashes only) and fully reported', async () => {
  const net = diana();
  const session = createSession({ fetch: net.fetch });
  const result = await session.handleCommand("Diana'da " + NUMBER + ' numaralı bloğu göster');
  assert.deepEqual([result.kind, result.query, result.outcome, result.run.kind, result.run.blockNumber], ['answered', 'block', 'success', 'block', NUMBER]);
  assert.deepEqual(result.run.result, {
    ok: true, tool: 'get_block', network: 'qorechain-diana',
    data: {
      chainId: 'qorechain-diana', evmChainId: '9800', requested: '10275626', status: 'found', blockNumber: '10275626', hash: HASH,
      timestamp: String(0x6afcbbab), time: new Date(0x6afcbbab * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
      transactionCount: '1', gasUsed: '406133', gasLimit: '4294967295',
    },
  });
  assert.deepEqual(net.requests, [
    { url: EVM, method: 'POST', credentials: 'omit', redirect: 'error', rpc: 'eth_chainId', params: [] },
    { url: EVM, method: 'POST', credentials: 'omit', redirect: 'error', rpc: 'eth_getBlockByNumber', params: [HEX, false] },
  ]);
  assert.equal(session.context, undefined);
});

test('the block number is sent as canonical hex', async () => {
  for (const [number, hex] of [[0, '0x0'], [1, '0x1'], [255, '0xff'], [Number.MAX_SAFE_INTEGER, '0x1fffffffffffff']]) {
    const net = diana({ block: blockAt({ number: hex }) });
    const result = await createSession({ fetch: net.fetch }).handleCommand('Show block ' + number);
    assert.equal(result.run.result.data.blockNumber, String(number));
    assert.deepEqual(net.requests[1].params, [hex, false]);
  }
});

for (const [name, options, number, expected, rpc] of [
  ['a block above the latest is reported as not produced yet', { block: null, latest: '0x9d07c2' }, 10291139,
    { status: 'future', latest: '10291138', blockNumber: undefined }, ['eth_chainId', 'eth_getBlockByNumber', 'eth_blockNumber']],
  ['a block below the oldest kept block is reported as pruned', { block: null }, 100,
    { status: 'pruned', earliest: '8790799', blockNumber: undefined }, ['eth_chainId', 'eth_getBlockByNumber', 'eth_blockNumber', 'eth_getBlockByNumber']],
  ['a missing block inside the kept range is not found', { block: null }, 9000000,
    { status: 'not_found', blockNumber: undefined, earliest: undefined, latest: undefined }, ['eth_chainId', 'eth_getBlockByNumber', 'eth_blockNumber', 'eth_getBlockByNumber']],
  ['an empty block has zero transactions', { block: blockAt({ transactions: [], gasUsed: '0x0' }) }, NUMBER,
    { status: 'found', transactionCount: '0', gasUsed: '0' }, ['eth_chainId', 'eth_getBlockByNumber']],
]) {
  test(name, async () => {
    const net = diana(options);
    const result = await createSession({ fetch: net.fetch }).handleCommand('Show block ' + number);
    assert.equal(result.outcome, 'success');
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(result.run.result.data[key], value, key);
    assert.deepEqual(net.requests.map(request => request.rpc), rpc);
    if (rpc.length === 4) assert.deepEqual(net.requests[3].params, ['earliest', false]);
  });
}

test('a block query never changes the conversation context', async () => {
  const net = diana();
  const session = createSession({ fetch: net.fetch });
  assert.equal((await session.handleCommand('blok ' + NUMBER + ' göster')).kind, 'answered');
  assert.equal(session.context, undefined);
  await session.handleCommand('Son blok kaç?');
  const before = session.context;
  await session.handleCommand('Show block ' + NUMBER);
  assert.equal(session.context, before);
  net.requests.length = 0;
  const next = await session.handleCommand('Peki şimdi kaç oldu?');
  assert.deepEqual([next.query, net.requests.map(request => request.rpc)], ['block_number', ['eth_chainId', 'eth_blockNumber']]);
});

const rpcError = id => ({ jsonrpc: '2.0', id, error: { code: -32602, message: 'private upstream detail' } });
for (const [name, options, code, sent] of [
  ['the endpoint reports another chain', { chain: '0x1' }, 'chain_mismatch', 1],
  ['the endpoint is unreachable', { reply: () => { throw new TypeError('Failed to fetch'); } }, 'network_error', 1],
  ['the endpoint fails', { reply: () => new Response('private upstream detail', { status: 503 }) }, 'http_error', 1],
  ['the block read returns a JSON-RPC error', { reply: body => body.method === 'eth_getBlockByNumber' && Response.json(rpcError(2)) }, 'invalid_response', 2],
  ['the latest-block read returns a JSON-RPC error', { block: null, reply: body => body.method === 'eth_blockNumber' && Response.json(rpcError(3)) }, 'invalid_response', 3],
  ['the earliest block is malformed', { block: null, earliest: { number: 'x' } }, 'invalid_response', 4],
  ['the node returns another block', { block: blockAt({ number: '0x9ccb2b' }) }, 'invalid_response', 2],
  ['the block number has leading zeros', { block: blockAt({ number: '0x09ccb2a' }) }, 'invalid_response', 2],
  ['the hash is malformed', { block: blockAt({ hash: '0x12' }) }, 'invalid_response', 2],
  ['the hash is missing', { block: blockAt({ hash: undefined }) }, 'invalid_response', 2],
  ['the timestamp is malformed', { block: blockAt({ timestamp: 'yesterday' }) }, 'invalid_response', 2],
  ['the timestamp is past year 9999', { block: blockAt({ timestamp: '0x' + (253402300800).toString(16) }) }, 'invalid_response', 2],
  ['gas used is above the gas limit', { block: blockAt({ gasUsed: '0x10', gasLimit: '0xf' }) }, 'invalid_response', 2],
  ['the gas limit is missing', { block: blockAt({ gasLimit: undefined }) }, 'invalid_response', 2],
  ['transactions are full objects', { block: blockAt({ transactions: [{ hash: TX }] }) }, 'invalid_response', 2],
  ['transactions are not a list', { block: blockAt({ transactions: 1 }) }, 'invalid_response', 2],
  ['the block is not an object', { block: 'latest' }, 'invalid_response', 2],
  ['the body is not JSON', { reply: body => body.method === 'eth_getBlockByNumber' && new Response('<html>') }, 'invalid_response', 2],
  ['the response has another id', { reply: body => body.method === 'eth_getBlockByNumber' && Response.json({ jsonrpc: '2.0', id: 99, result: blockAt() }) }, 'invalid_response', 2],
]) {
  test('block read fails safely when ' + name, async () => {
    const net = diana(options);
    const session = createSession({ fetch: net.fetch });
    const result = await session.handleCommand('Show block ' + (options.block === null ? 100 : NUMBER));
    assert.deepEqual([result.kind, result.outcome], ['answered', 'failed']);
    assert.deepEqual([result.run.result.ok, result.run.result.error.stage, result.run.result.error.code], [false, 'execution', code]);
    assert.equal(result.run.result.error.message.includes('private upstream detail'), false);
    assert.equal(net.requests.length, sent);
    assert.equal(session.context, undefined);
  });
}

test('block read times out safely', async () => {
  const result = await createSession({ timeoutMs: 20, fetch: async () => new Response(new ReadableStream()) }).handleCommand('Show block ' + NUMBER);
  assert.deepEqual([result.outcome, result.run.result.error.code], ['failed', 'timeout']);
});

// --- Registry and guard ------------------------------------------------------------------------------

test('get_block is a frozen, read-only Diana tool with three read methods', () => {
  const tool = getTool('get_block');
  assert.deepEqual([tool.id, tool.network, tool.readOnly], ['get_block', 'qorechain-diana', true]);
  assert.deepEqual(tool.rpcMethods, ['eth_chainId', 'eth_getBlockByNumber', 'eth_blockNumber']);
  assert.deepEqual(Object.keys(tool.params), ['number']);
  assert.ok(Object.isFrozen(tool) && Object.isFrozen(tool.rpcMethods) && Object.isFrozen(tool.params));
  for (const entry of listTools()) assert.doesNotMatch(entry.id, /sign|send|transfer|wallet|broadcast/u);
  // The other tools still cannot read blocks by number.
  for (const id of ['get_evm_block_number', 'get_balance', 'get_transaction']) assert.equal(getTool(id).rpcMethods.includes('eth_getBlockByNumber'), false);
});

const blockRequest = (overrides = {}) => ({
  tool: 'get_block', network: 'qorechain-diana', params: { number: NUMBER },
  rpcMethods: ['eth_chainId', 'eth_getBlockByNumber', 'eth_blockNumber'], ...overrides,
});

for (const [name, overrides, code] of [
  ['another network', { network: 'qorechain-mainnet' }, 'network_not_allowed'],
  ['a broadcast method', { rpcMethods: ['eth_sendRawTransaction'] }, 'method_not_allowed'],
  ['a call method', { rpcMethods: ['eth_call'] }, 'method_not_allowed'],
  ['a transaction method', { rpcMethods: ['eth_getTransactionByHash'] }, 'method_not_allowed'],
  ['no number', { params: {} }, 'invalid_params'],
  ['a string number', { params: { number: String(NUMBER) } }, 'invalid_params'],
  ['a hex number', { params: { number: HEX } }, 'invalid_params'],
  ['a block tag', { params: { number: 'latest' } }, 'invalid_params'],
  ['a negative number', { params: { number: -1 } }, 'invalid_params'],
  ['a fraction', { params: { number: 1.5 } }, 'invalid_params'],
  ['an unsafe integer', { params: { number: 2 ** 53 } }, 'invalid_params'],
  ['a big integer', { params: { number: 10n } }, 'invalid_params'],
  ['an extra parameter', { params: { number: NUMBER, full: true } }, 'invalid_params'],
]) {
  test('get_block refuses ' + name + ' before any request', async () => {
    const result = await invokeTool(blockRequest(overrides), { fetch: noRequest });
    assert.deepEqual([result.ok, result.error.stage, result.error.code], [false, 'validation', code]);
  });
}

test('runtime options cannot redirect the block tool to another endpoint', async () => {
  const net = diana();
  const result = await invokeTool(blockRequest(), { fetch: net.fetch, rpcUrl: 'https://evil.example', restUrl: 'https://evil.example' });
  assert.equal(result.ok, true);
  assert.ok(net.requests.every(request => request.url === EVM));
});

test('the block guard lets only its three read methods through', async () => {
  let sent = 0;
  const guarded = guardFetch(async () => { sent++; return Response.json({}); }, getTool('get_block').rpcMethods);
  const rpc = method => JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] });
  for (const method of ['eth_chainId', 'eth_getBlockByNumber', 'eth_blockNumber']) await guarded(EVM, { method: 'POST', body: rpc(method) });
  for (const method of ['eth_sendRawTransaction', 'eth_sendTransaction', 'eth_signTransaction', 'eth_sign', 'personal_sign', 'eth_call', 'eth_getBalance', 'eth_getBlockByHash', 'debug_traceBlockByNumber']) {
    await assert.rejects(guarded(EVM, { method: 'POST', body: rpc(method) }), TypeError, method);
  }
  await assert.rejects(guarded(EVM, { method: 'POST', body: JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'eth_getBlockByNumber', params: [] }]) }), TypeError);
  assert.equal(sent, 3);
});

test('getEvmBlock refuses an invalid number before any request', async () => {
  for (const number of [-1, 1.5, 2 ** 53, '1', '0x1', 'latest', NaN, Infinity, 10n]) {
    await assert.rejects(getEvmBlock(number, { fetch: noRequest }), { name: 'QoreChainReadError' });
  }
});

test('a classifier has no block label and cannot supply a block number', () => {
  for (const output of [[{ label: 'block', score: 0.99 }], [{ label: 'get_block', score: 0.99 }], [{ label: 'block_number', score: 0.99, blockNumber: NUMBER }]]) {
    assert.deepEqual({ ...decideIntent(output, undefined) }, { kind: 'clarify', reason: 'invalid_classifier_output', source: 'classifier' });
  }
});
