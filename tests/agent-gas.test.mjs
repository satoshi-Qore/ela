// 7C-31: current gas price and fees on Diana testnet, through the agent session and the tool
// registry. Read-only: only eth_chainId, eth_gasPrice, eth_feeHistory, and eth_maxPriorityFeePerGas
// may be sent, to the fixed official Diana EVM JSON-RPC. Nothing is built, signed, or sent.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decideIntent, interpretCommand } from '../src/agent/intent.ts';
import { getTool, guardFetch, invokeTool, listTools } from '../src/agent/registry.ts';
import { createSession } from '../src/agent/session.ts';
import { isGasQuestion } from '../src/agent/gas.ts';
import { formatUnits, getEvmGas } from '../src/qorechain/get-evm-gas.ts';

const EVM = 'https://evm-testnet.qore.host/';
const METHODS = ['eth_chainId', 'eth_gasPrice', 'eth_feeHistory', 'eth_maxPriorityFeePerGas'];

// The live Diana answers on 2026-11-18 (fee history trimmed to one block, as ELA asks for it).
const GAS_PRICE = '0x1a3185c500'; // 112.5 gwei
const HISTORY = {
  oldestBlock: '0x9d0be2',
  baseFeePerGas: ['0x174876e800', '0x174876e800'], // 100 gwei
  gasUsedRatio: [0],
  baseFeePerBlobGas: ['0x1', '0x1'],
  blobGasUsedRatio: [0],
};
const PRIORITY = '0x2e90edd00'; // 12.5 gwei
const notFound = id => ({ jsonrpc: '2.0', id, error: { code: -32601, message: 'the method does not exist/is not available' } });

/** A scripted Diana EVM JSON-RPC. Records every request. `null` for a method answers "not found". */
function diana({ chain = '0x2648', price = GAS_PRICE, history = HISTORY, priority = PRIORITY, reply } = {}) {
  const requests = [];
  const fetch = async (input, init = {}) => {
    const body = JSON.parse(init.body);
    requests.push({ url: String(input), method: init.method, credentials: init.credentials, redirect: init.redirect, rpc: body.method, params: body.params });
    if (reply) { const custom = await reply(body); if (custom) return custom; }
    const result = { eth_chainId: chain, eth_gasPrice: price, eth_feeHistory: history, eth_maxPriorityFeePerGas: priority }[body.method];
    return Response.json(result === null ? notFound(body.id) : { jsonrpc: '2.0', id: body.id, result });
  };
  return { fetch, requests };
}
const noRequest = async () => assert.fail('no request may be sent');
const classifierMustNotRun = { classify: () => assert.fail('no classifier call') };

// --- Recognition -----------------------------------------------------------------------------------

const RECOGNIZED = [
  // Turkish
  'Gas ücreti ne kadar?',
  "Diana'da gas ücreti ne kadar?",
  'Diana ağında gas ücreti ne kadar?',
  'Gas ücreti kaç?',
  'Gas fiyatı ne?',
  'Güncel gas fiyatını göster',
  'Transfer ücreti ne kadar?',
  'İşlem ücreti ne kadar?',
  'Diana test ağında işlem ücretleri nedir?',
  'Şu an gas fiyatı kaç gwei?',
  'Base fee ve priority fee ne kadar?',
  'Taban ücret ve öncelik ücreti nedir?',
  'Transfer maliyeti ne kadar?',
  'GAS ÜCRETİ NE KADAR',
  'gas ucreti ne kadar',
  // English
  'What is the gas price?',
  'What is the gas fee on Diana?',
  'What is the transfer fee?',
  'How much does a transfer cost?',
  'What are the current fees on Diana testnet?',
  'Show me the gas price, please',
  'gas price',
  "What's the base fee and priority fee?",
  'What is the current gas price in gwei?',
  'Estimated transaction fee on Diana',
];

for (const command of RECOGNIZED) {
  test('recognizes fee question: ' + command, async () => {
    assert.equal(isGasQuestion(command), true);
    const decision = await interpretCommand(command, undefined, { classifier: classifierMustNotRun });
    assert.deepEqual({ ...decision }, { kind: 'run', query: 'gas', intent: 'gas', source: 'deterministic' });
    assert.ok(Object.isFrozen(decision));
  });
}

// Fee words with other topics, numbers, or parameters are not a gas-price question: they keep the
// existing answers and send nothing.
for (const [command, kind, reason] of [
  ['Swap ücreti nedir?', 'unsupported', undefined],
  ['What is the swap fee?', 'unsupported', undefined],
  ['Staking ücreti ne kadar?', 'unsupported', undefined],
  ['What is the validator fee?', 'unsupported', undefined],
  ['Bakiyem ve gas ücreti ne kadar?', 'unsupported', undefined],
  ['21000 gas kaç QOR?', 'unsupported', undefined],
  ['What is the gas price on Ethereum?', 'clarify', 'unsupported_network'],
  ['Mainnet gas ücreti ne kadar?', 'clarify', 'unsupported_network'],
  ['What is the gas fee for 0x742d35Cc6634C0532925a3b844Bc454e4438f44e?', 'clarify', 'unsupported_parameters'],
  ['Send 5 QOR and tell me the gas fee.', 'refused', 'transfer'],
  ['Transfer et, ücreti ne kadar?', 'refused', 'transfer'],
  ['Sign a transaction with the current gas price.', 'refused', 'signing'],
  ['Gazete ne kadar?', 'clarify', 'unknown_intent'],
]) {
  test('not a gas-price question, nothing is sent: ' + command, async () => {
    // A request is refused by the safety gate, which runs before the fee rules on the whole command.
    if (kind !== 'refused') assert.equal(isGasQuestion(command), false);
    const session = createSession({ fetch: noRequest });
    const result = await session.handleCommand(command);
    assert.deepEqual([result.kind, result.reason], [kind, reason], command);
    assert.equal(session.context, undefined);
  });
}

// --- Reading ------------------------------------------------------------------------------------------

test('a fee question reads the gas price, base fee, and priority fee once each, on the fixed endpoint', async () => {
  const net = diana();
  const session = createSession({ fetch: net.fetch, classifier: classifierMustNotRun });
  const result = await session.handleCommand("Diana'da gas ücreti ne kadar?");
  assert.deepEqual([result.kind, result.outcome, result.query], ['answered', 'success', 'gas']);
  assert.deepEqual(result.run.result, {
    ok: true,
    tool: 'get_gas_fees',
    network: 'qorechain-diana',
    data: {
      chainId: 'qorechain-diana',
      evmChainId: '9800',
      status: 'full',
      gasPriceWei: '112500000000',
      gasPriceGwei: '112.5',
      blockNumber: '10292194',
      baseFeeWei: '100000000000',
      baseFeeGwei: '100',
      priorityFeeWei: '12500000000',
      priorityFeeGwei: '12.5',
      transferGas: '21000',
      transferFeeWei: '2362500000000000',
      transferFeeGwei: '2362500',
      transferFeeQor: '0.0023625',
    },
  });
  assert.deepEqual(net.requests, [
    { url: EVM, method: 'POST', credentials: 'omit', redirect: 'error', rpc: 'eth_chainId', params: [] },
    { url: EVM, method: 'POST', credentials: 'omit', redirect: 'error', rpc: 'eth_gasPrice', params: [] },
    { url: EVM, method: 'POST', credentials: 'omit', redirect: 'error', rpc: 'eth_feeHistory', params: ['0x1', 'latest', []] },
    { url: EVM, method: 'POST', credentials: 'omit', redirect: 'error', rpc: 'eth_maxPriorityFeePerGas', params: [] },
  ]);
  // A fee query never becomes the conversation context.
  assert.equal(session.context, undefined);
});

test('every fee question reads fresh data, and the context of an earlier block query stays', async () => {
  const net = diana();
  const session = createSession({ fetch: net.fetch });
  await session.handleCommand('Son blok kaç?');
  const before = session.context;
  net.requests.length = 0;
  await session.handleCommand('What is the gas price?');
  await session.handleCommand('What is the gas price?');
  assert.equal(net.requests.filter(request => request.rpc === 'eth_gasPrice').length, 2);
  assert.equal(session.context, before);
});

// A node that does not provide a method: ELA reports only the values it did return.
for (const [name, options, status, absent] of [
  ['the node has no eth_feeHistory', { history: null }, 'priority', ['blockNumber', 'baseFeeWei', 'baseFeeGwei']],
  ['the node has no eth_maxPriorityFeePerGas', { priority: null }, 'base', ['priorityFeeWei', 'priorityFeeGwei']],
  ['the node has neither', { history: null, priority: null }, 'price', ['blockNumber', 'baseFeeWei', 'baseFeeGwei', 'priorityFeeWei', 'priorityFeeGwei']],
]) {
  test('only verified values are shown when ' + name, async () => {
    const net = diana(options);
    const result = await createSession({ fetch: net.fetch }).handleCommand('What is the gas price?');
    assert.equal(result.outcome, 'success');
    const data = result.run.result.data;
    assert.equal(data.status, status);
    for (const key of absent) assert.equal(key in data, false, key);
    // The gas price and the 21,000-gas estimate do not depend on the missing values.
    assert.deepEqual([data.gasPriceWei, data.transferFeeWei], ['112500000000', '2362500000000000']);
    assert.deepEqual(net.requests.map(request => request.rpc), METHODS);
  });
}

test('a zero gas price on a testnet is reported as zero, not as missing', async () => {
  const net = diana({ price: '0x0', priority: '0x0', history: { ...HISTORY, baseFeePerGas: ['0x0', '0x0'] } });
  const data = (await createSession({ fetch: net.fetch }).handleCommand('gas price')).run.result.data;
  assert.deepEqual([data.gasPriceGwei, data.baseFeeGwei, data.priorityFeeGwei, data.transferFeeWei, data.transferFeeQor], ['0', '0', '0', '0', '0']);
});

const rpcError = id => ({ jsonrpc: '2.0', id, error: { code: -32000, message: 'private upstream detail' } });
for (const [name, options, code, sent] of [
  ['the endpoint reports another chain', { chain: '0x1' }, 'chain_mismatch', 1],
  ['the endpoint reports Ethereum mainnet', { chain: '0x1', price: '0x1' }, 'chain_mismatch', 1],
  ['the endpoint is unreachable', { reply: () => { throw new TypeError('Failed to fetch'); } }, 'network_error', 1],
  ['the endpoint fails', { reply: () => new Response('private upstream detail', { status: 503 }) }, 'http_error', 1],
  ['the gas price read returns a JSON-RPC error', { reply: body => body.method === 'eth_gasPrice' && Response.json(rpcError(2)) }, 'invalid_response', 2],
  ['the gas price is not supported', { price: null }, 'invalid_response', 2],
  ['the gas price is malformed', { price: '112.5 gwei' }, 'invalid_response', 2],
  ['the gas price has leading zeros', { price: '0x01a3185c500' }, 'invalid_response', 2],
  ['the gas price is a number', { price: 112500000000 }, 'invalid_response', 2],
  ['the gas price is missing', { reply: body => body.method === 'eth_gasPrice' && Response.json({ jsonrpc: '2.0', id: 2 }) }, 'invalid_response', 2],
  ['the fee history is not an object', { history: [] }, 'invalid_response', 3],
  ['the fee history has no base fees', { history: { ...HISTORY, baseFeePerGas: undefined } }, 'invalid_response', 3],
  ['the fee history has too many base fees', { history: { ...HISTORY, baseFeePerGas: ['0x1', '0x1', '0x1'] } }, 'invalid_response', 3],
  ['the base fee is malformed', { history: { ...HISTORY, baseFeePerGas: ['-1', '0x1'] } }, 'invalid_response', 3],
  ['the next base fee is malformed', { history: { ...HISTORY, baseFeePerGas: ['0x1', null] } }, 'invalid_response', 3],
  ['the block of the fee history is malformed', { history: { ...HISTORY, oldestBlock: 'latest' } }, 'invalid_response', 3],
  ['the gas used ratio is out of range', { history: { ...HISTORY, gasUsedRatio: [1.5] } }, 'invalid_response', 3],
  ['the gas used ratio is missing', { history: { ...HISTORY, gasUsedRatio: [] } }, 'invalid_response', 3],
  ['the fee history error is malformed', { reply: body => body.method === 'eth_feeHistory' && Response.json({ jsonrpc: '2.0', id: 3, error: 'nope' }) }, 'invalid_response', 3],
  ['the priority fee is malformed', { priority: '0xZZ' }, 'invalid_response', 4],
  ['a response has both a result and an error', { reply: body => body.method === 'eth_maxPriorityFeePerGas' && Response.json({ ...rpcError(4), result: PRIORITY }) }, 'invalid_response', 4],
  ['the body is not JSON', { reply: body => body.method === 'eth_gasPrice' && new Response('<html>') }, 'invalid_response', 2],
  ['the response has another id', { reply: body => body.method === 'eth_gasPrice' && Response.json({ jsonrpc: '2.0', id: 99, result: GAS_PRICE }) }, 'invalid_response', 2],
  ['the response is not JSON-RPC 2.0', { reply: body => body.method === 'eth_gasPrice' && Response.json({ id: 2, result: GAS_PRICE }) }, 'invalid_response', 2],
]) {
  test('fee read fails safely when ' + name, async () => {
    const net = diana(options);
    const session = createSession({ fetch: net.fetch });
    const result = await session.handleCommand('Gas ücreti ne kadar?');
    assert.deepEqual([result.kind, result.outcome], ['answered', 'failed']);
    assert.deepEqual([result.run.result.ok, result.run.result.error.stage, result.run.result.error.code], [false, 'execution', code]);
    assert.equal('data' in result.run.result, false);
    assert.equal(result.run.result.error.message.includes('private upstream detail'), false);
    assert.equal(net.requests.length, sent);
    assert.equal(session.context, undefined);
  });
}

test('fee read times out safely', async () => {
  const result = await createSession({ timeoutMs: 20, fetch: async () => new Response(new ReadableStream()) }).handleCommand('What is the gas price?');
  assert.deepEqual([result.outcome, result.run.result.error.code], ['failed', 'timeout']);
});

test('a stalled optional read times out instead of being reported as unsupported', async () => {
  const net = diana({ reply: body => body.method === 'eth_feeHistory' && new Promise(() => {}) });
  const result = await createSession({ timeoutMs: 20, fetch: net.fetch }).handleCommand('What is the gas price?');
  assert.deepEqual([result.outcome, result.run.result.error.code], ['failed', 'timeout']);
});

test('formatUnits gives exact decimals without trailing zeros', () => {
  for (const [value, decimals, text] of [[0n, 9, '0'], [1n, 9, '0.000000001'], [112500000000n, 9, '112.5'], [10n ** 18n, 18, '1'], [2362500000000000n, 18, '0.0023625'], [2n ** 256n - 1n, 18, '115792089237316195423570985008687907853269984665640564039457.584007913129639935']]) {
    assert.equal(formatUnits(value, decimals), text);
  }
});

// --- Registry and guard ------------------------------------------------------------------------------

test('get_gas_fees is a frozen, read-only Diana tool with four read methods and no parameters', () => {
  const tool = getTool('get_gas_fees');
  assert.deepEqual([tool.id, tool.network, tool.readOnly], ['get_gas_fees', 'qorechain-diana', true]);
  assert.deepEqual(tool.rpcMethods, METHODS);
  assert.deepEqual(Object.keys(tool.params), []);
  assert.ok(Object.isFrozen(tool) && Object.isFrozen(tool.rpcMethods) && Object.isFrozen(tool.params));
  for (const entry of listTools()) assert.doesNotMatch(entry.id, /sign|send|transfer|wallet|broadcast/u);
  // The other tools still cannot read fees.
  for (const id of ['get_evm_block_number', 'get_balance', 'get_transaction', 'get_block']) {
    assert.equal(getTool(id).rpcMethods.some(method => METHODS.slice(1).includes(method)), false, id);
  }
});

const gasRequest = (overrides = {}) => ({ tool: 'get_gas_fees', network: 'qorechain-diana', params: {}, rpcMethods: METHODS, ...overrides });

for (const [name, overrides, code] of [
  ['another network', { network: 'qorechain-mainnet' }, 'network_not_allowed'],
  ['Ethereum', { network: 'ethereum' }, 'network_not_allowed'],
  ['a broadcast method', { rpcMethods: ['eth_sendRawTransaction'] }, 'method_not_allowed'],
  ['a gas estimate for a call', { rpcMethods: ['eth_estimateGas'] }, 'method_not_allowed'],
  ['a call method', { rpcMethods: ['eth_call'] }, 'method_not_allowed'],
  ['any parameter', { params: { gas: 21000 } }, 'invalid_params'],
  ['an endpoint parameter', { params: { url: 'https://evil.example' } }, 'invalid_params'],
]) {
  test('get_gas_fees refuses ' + name + ' before any request', async () => {
    const result = await invokeTool(gasRequest(overrides), { fetch: noRequest });
    assert.deepEqual([result.ok, result.error.stage, result.error.code], [false, 'validation', code]);
  });
}

test('runtime options cannot redirect the fee tool to another endpoint', async () => {
  const net = diana();
  const result = await invokeTool(gasRequest(), { fetch: net.fetch, rpcUrl: 'https://evil.example', restUrl: 'https://evil.example' });
  assert.equal(result.ok, true);
  assert.ok(net.requests.every(request => request.url === EVM));
});

test('the fee guard lets only its four read methods through', async () => {
  let sent = 0;
  const guarded = guardFetch(async () => { sent++; return Response.json({}); }, getTool('get_gas_fees').rpcMethods);
  const rpc = method => JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] });
  for (const method of METHODS) await guarded(EVM, { method: 'POST', body: rpc(method) });
  for (const method of ['eth_sendRawTransaction', 'eth_sendTransaction', 'eth_signTransaction', 'eth_sign', 'personal_sign', 'eth_call', 'eth_estimateGas', 'eth_getBalance', 'eth_blockNumber', 'eth_createAccessList']) {
    await assert.rejects(guarded(EVM, { method: 'POST', body: rpc(method) }), TypeError, method);
  }
  await assert.rejects(guarded(EVM, { method: 'POST', body: JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'eth_gasPrice', params: [] }]) }), TypeError);
  assert.equal(sent, 4);
});

test('getEvmGas checks the chain before reading any fee', async () => {
  const net = diana({ chain: '0x2649' });
  await assert.rejects(getEvmGas({ fetch: net.fetch }), { name: 'QoreChainReadError', code: 'chain_mismatch' });
  assert.deepEqual(net.requests.map(request => request.rpc), ['eth_chainId']);
});

test('a classifier has no fee label and cannot start a fee read', () => {
  for (const output of [[{ label: 'gas', score: 0.99 }], [{ label: 'get_gas_fees', score: 0.99 }], [{ label: 'network_check', score: 0.99, rpcMethods: ['eth_gasPrice'] }]]) {
    assert.deepEqual({ ...decideIntent(output, undefined) }, { kind: 'clarify', reason: 'invalid_classifier_output', source: 'classifier' });
  }
});
