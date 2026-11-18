// 7C-32: read-only ERC-20 token inspection on Diana testnet, through the agent session and the tool
// registry. Only eth_chainId, eth_getCode, and eth_call may be sent, to the fixed official Diana EVM
// JSON-RPC, and eth_call only as name(), symbol(), decimals(), or totalSupply() on the one
// validated contract. No approve, transfer, transferFrom, signing, or broadcast.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessRisk, decideIntent, interpretCommand } from '../src/agent/intent.ts';
import { getTool, guardFetch, invokeTool, isAllowedRpcRequest, listTools } from '../src/agent/registry.ts';
import { createSession } from '../src/agent/session.ts';
import { recognizeTokenRequest } from '../src/agent/token.ts';
import { ERC20_CALLS, getEvmToken } from '../src/qorechain/get-evm-token.ts';
import { checkAddress, keccak256 } from '../src/qorechain/keccak.ts';

const EVM = 'https://evm-testnet.qore.host/';
// A live ERC-20 on Diana (QoreVest, QVEST, 6 decimals, 1,000,000 supply), read on 2026-11-18.
const TOKEN = '0x67e4862c388a5ead666f5ac340fe9ef2fc1f8f68';
const SELECTORS = ['0x06fdde03', '0x95d89b41', '0x313ce567', '0x18160ddd'];

const word = n => BigInt(n).toString(16).padStart(64, '0');
const abiString = text => {
  const hex = Buffer.from(text, 'utf8').toString('hex');
  return '0x' + word(32) + word(hex.length / 2) + hex.padEnd(Math.ceil(hex.length / 64) * 64, '0');
};
const LIVE = {
  '0x06fdde03': '0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000008516f726556657374000000000000000000000000000000000000000000000000',
  '0x95d89b41': '0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000055156455354000000000000000000000000000000000000000000000000000000',
  '0x313ce567': '0x0000000000000000000000000000000000000000000000000000000000000006',
  '0x18160ddd': '0x000000000000000000000000000000000000000000000000000000e8d4a51000',
};
const reverted = id => ({ jsonrpc: '2.0', id, error: { code: -32000, message: 'execution reverted' } });

/**
 * A scripted Diana EVM JSON-RPC. Records every request. In `calls`, `null` reverts and a string is
 * returned as the result.
 */
function diana({ chain = '0x2648', code = '0x6080604052', calls = {}, reply } = {}) {
  const requests = [];
  const fetch = async (input, init = {}) => {
    const body = JSON.parse(init.body);
    requests.push({ url: String(input), method: init.method, credentials: init.credentials, redirect: init.redirect, rpc: body.method, params: body.params });
    if (reply) { const custom = await reply(body); if (custom) return custom; }
    if (body.method === 'eth_chainId') return Response.json({ jsonrpc: '2.0', id: body.id, result: chain });
    if (body.method === 'eth_getCode') return Response.json({ jsonrpc: '2.0', id: body.id, result: code });
    const data = body.params[0].data;
    const result = data in calls ? calls[data] : LIVE[data];
    return Response.json(result === null ? reverted(body.id) : { jsonrpc: '2.0', id: body.id, result });
  };
  return { fetch, requests };
}
const noRequest = async () => assert.fail('no request may be sent');
const classifierMustNotRun = { classify: () => assert.fail('no classifier call') };

// --- Address checks ---------------------------------------------------------------------------------

test('keccak256 matches the standard vectors', () => {
  const hash = text => keccak256(new TextEncoder().encode(text));
  assert.equal(hash(''), 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  assert.equal(hash('abc'), '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45');
  assert.equal(hash('a'.repeat(135)).length, 64);
  assert.throws(() => keccak256(new Uint8Array(136)), RangeError);
});

test('EIP-55: the specification vectors pass, one changed letter fails, single-case addresses carry no checksum', () => {
  for (const address of ['0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359', '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB', '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb']) {
    assert.equal(checkAddress(address), address.toLowerCase());
    // Flip the case of the first letter: the checksum no longer matches.
    const i = address.slice(2).search(/[a-f]/iu) + 2;
    const flipped = address.slice(0, i) + (address[i] === address[i].toLowerCase() ? address[i].toUpperCase() : address[i].toLowerCase()) + address.slice(i + 1);
    assert.equal(checkAddress(flipped), undefined, flipped);
  }
  assert.equal(checkAddress(TOKEN), TOKEN);
  assert.equal(checkAddress('0x' + TOKEN.slice(2).toUpperCase()), TOKEN);
  for (const value of ['0x' + 'a'.repeat(39), '0x' + 'a'.repeat(41), '0x' + 'g'.repeat(40), TOKEN.slice(2), '0X' + TOKEN.slice(2), '0x' + 'a'.repeat(64)]) assert.equal(checkAddress(value), undefined, value);
});

// --- Recognition -----------------------------------------------------------------------------------

const RECOGNIZED = [
  // Turkish
  TOKEN + ' tokenini incele',
  TOKEN + ' adresindeki tokenin adı ve sembolü nedir?',
  "Diana'da " + TOKEN + ' token bilgilerini göster',
  TOKEN + ' tokeninin toplam arzı ne?',
  'Token ' + TOKEN + ' ondalık sayısı kaç?',
  TOKEN + ' ERC-20 kontratını incele lütfen',
  'TOKEN ' + TOKEN + ' GÖSTER',
  // English
  'Inspect token ' + TOKEN,
  'Show token ' + TOKEN,
  'What is the total supply of token ' + TOKEN + ' on Diana?',
  'ERC-20 token at ' + TOKEN + ': name, symbol and decimals',
  'Check the ERC20 contract ' + TOKEN + ' please',
  'Token info for 0x67E4862C388A5EAD666F5AC340FE9EF2FC1F8F68',
];

for (const command of RECOGNIZED) {
  test('recognizes token query: ' + command.slice(0, 60), async () => {
    assert.deepEqual(recognizeTokenRequest(command), { kind: 'token', address: TOKEN });
    const decision = await interpretCommand(command, undefined, { classifier: classifierMustNotRun });
    assert.deepEqual({ ...decision }, { kind: 'run', query: 'token', intent: 'token', source: 'deterministic', address: TOKEN });
    assert.ok(Object.isFrozen(decision));
  });
}

for (const command of [
  'Inspect token 0x' + 'a'.repeat(39),
  'Inspect token 0x' + 'a'.repeat(41),
  'Inspect token 0x67e4862c388a5ead666f5ac340fe9ef2fc1f8fZZ',
  'Inspect token 0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD', // one letter's case changed
  'Tokens ' + TOKEN + ' and 0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed',
  TOKEN + ' ve ' + TOKEN + ' tokenlerini incele',
  'Inspect token 0x',
]) {
  test('invalid token address is refused before any request: ' + command.slice(0, 52), async () => {
    const session = createSession({ fetch: noRequest, classifier: classifierMustNotRun });
    const result = await session.handleCommand(command);
    assert.deepEqual([result.kind, result.reason, result.decision.source], ['clarify', 'invalid_token_address', 'input_check'], command);
  });
}

// A 64-hex value may be a private key: the existing behaviour stays (refused, or a transaction
// lookup waiting for confirmation), and the token rules never see it.
test('a 64-hex value is never taken as a token address', async () => {
  const key = '0x' + '4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318';
  for (const command of ['Inspect token ' + key, key + ' tokenini incele', 'Token ' + key.slice(2)]) {
    const session = createSession({ fetch: noRequest, classifier: classifierMustNotRun });
    const result = await session.handleCommand(command);
    assert.deepEqual([result.kind, result.reason], ['refused', 'key_material'], command);
  }
  const lookup = await createSession({ fetch: noRequest }).handleCommand('What is the status of transaction ' + key + '?');
  assert.equal(lookup.kind, 'confirm');
});

// Function calls, other networks, and requests that change state never reach the token tool.
for (const [command, kind, reason] of [
  ['Approve token ' + TOKEN, 'refused', 'signing'],
  ['Send 5 tokens to ' + TOKEN, 'refused', 'transfer'],
  ['Transfer token ' + TOKEN + ' to Alice', 'refused', 'transfer'],
  [TOKEN + ' tokenini transfer et', 'refused', 'transfer'],
  ['Call transferFrom on token ' + TOKEN, 'clarify', 'unsupported_parameters'],
  ['Show balanceOf for token ' + TOKEN, 'clarify', 'unsupported_parameters'],
  ['Read allowance of token ' + TOKEN, 'clarify', 'unsupported_parameters'],
  ['Inspect token ' + TOKEN + ' on Ethereum', 'clarify', 'unsupported_network'],
  ['Mainnet token ' + TOKEN + ' incele', 'clarify', 'unsupported_network'],
  ['Show contract ' + TOKEN, 'clarify', 'unsupported_parameters'],
  ['Show the balance of 0x742d35Cc6634C0532925a3b844Bc454e4438f44e', 'clarify', 'unsupported_parameters'],
]) {
  test('not a token inspection, nothing is sent: ' + command.slice(0, 52), async () => {
    const session = createSession({ fetch: noRequest, classifier: classifierMustNotRun });
    const result = await session.handleCommand(command);
    assert.deepEqual([result.kind, result.reason], [kind, reason], command);
    assert.equal(session.context, undefined);
  });
}

// --- Reading ------------------------------------------------------------------------------------------

test('a token query reads name, symbol, decimals, and total supply with exactly the allowed calls', async () => {
  const net = diana();
  const session = createSession({ fetch: net.fetch, classifier: classifierMustNotRun });
  const result = await session.handleCommand(TOKEN + ' tokenini incele');
  assert.deepEqual([result.kind, result.outcome, result.query], ['answered', 'success', 'token']);
  assert.deepEqual(result.run.result, {
    ok: true,
    tool: 'get_token',
    network: 'qorechain-diana',
    data: {
      chainId: 'qorechain-diana', evmChainId: '9800', address: TOKEN, status: 'found',
      name: 'QoreVest', symbol: 'QVEST', decimals: '6', totalSupplyRaw: '1000000000000', totalSupply: '1000000',
    },
  });
  const call = data => ({ url: EVM, method: 'POST', credentials: 'omit', redirect: 'error', rpc: 'eth_call', params: [{ to: TOKEN, data }, 'latest'] });
  assert.deepEqual(net.requests, [
    { url: EVM, method: 'POST', credentials: 'omit', redirect: 'error', rpc: 'eth_chainId', params: [] },
    { url: EVM, method: 'POST', credentials: 'omit', redirect: 'error', rpc: 'eth_getCode', params: [TOKEN, 'latest'] },
    call('0x18160ddd'), call('0x06fdde03'), call('0x95d89b41'), call('0x313ce567'),
  ]);
  // A token query never becomes the conversation context.
  assert.equal(session.context, undefined);
});

test('a mixed-case checksummed address is read in lower case', async () => {
  const net = diana();
  const result = await createSession({ fetch: net.fetch }).handleCommand('Inspect token 0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');
  assert.equal(result.run.result.data.address, '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed');
  assert.ok(net.requests.slice(2).every(request => request.params[0].to === '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed'));
});

for (const [name, options, expected, rpc] of [
  ['an address without code is not a token, and nothing else is read', { code: '0x' },
    { status: 'no_contract', name: undefined, totalSupply: undefined }, ['eth_chainId', 'eth_getCode']],
  ['a contract that reverts totalSupply() is not a token', { calls: { '0x18160ddd': null } },
    { status: 'not_token', totalSupply: undefined }, ['eth_chainId', 'eth_getCode', 'eth_call']],
  ['a contract that returns nothing for totalSupply() is not a token', { calls: { '0x18160ddd': '0x' } },
    { status: 'not_token' }, ['eth_chainId', 'eth_getCode', 'eth_call']],
  ['optional functions that revert are listed and left out', { calls: { '0x06fdde03': null, '0x313ce567': null } },
    { status: 'found', name: undefined, symbol: 'QVEST', decimals: undefined, missing: 'name(), decimals()', totalSupply: '1000000000000', totalSupplyRaw: '1000000000000' }, ['eth_chainId', 'eth_getCode', 'eth_call', 'eth_call', 'eth_call', 'eth_call']],
  ['an empty name counts as not answered', { calls: { '0x06fdde03': abiString('') } },
    { status: 'found', name: undefined, missing: 'name()' }, ['eth_chainId', 'eth_getCode', 'eth_call', 'eth_call', 'eth_call', 'eth_call']],
  ['a legacy bytes32 name and symbol are read', { calls: { '0x06fdde03': '0x' + Buffer.from('Maker').toString('hex').padEnd(64, '0'), '0x95d89b41': '0x' + Buffer.from('MKR').toString('hex').padEnd(64, '0'), '0x313ce567': '0x' + word(18) } },
    { status: 'found', name: 'Maker', symbol: 'MKR', decimals: '18', totalSupply: '0.000001' }, ['eth_chainId', 'eth_getCode', 'eth_call', 'eth_call', 'eth_call', 'eth_call']],
  ['zero decimals and a zero supply', { calls: { '0x313ce567': '0x' + word(0), '0x18160ddd': '0x' + word(0) } },
    { status: 'found', decimals: '0', totalSupply: '0', totalSupplyRaw: '0' }, ['eth_chainId', 'eth_getCode', 'eth_call', 'eth_call', 'eth_call', 'eth_call']],
  ['Turkish letters in a name are kept', { calls: { '0x06fdde03': abiString('Çağrı Şeker Ünü') } },
    { status: 'found', name: 'Çağrı Şeker Ünü' }, ['eth_chainId', 'eth_getCode', 'eth_call', 'eth_call', 'eth_call', 'eth_call']],
]) {
  test('token read: ' + name, async () => {
    const net = diana(options);
    const result = await createSession({ fetch: net.fetch }).handleCommand('Inspect token ' + TOKEN);
    assert.equal(result.outcome, 'success');
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(result.run.result.data[key], value, key);
    if (!('missing' in expected)) assert.equal('missing' in result.run.result.data, false);
    assert.deepEqual(net.requests.map(request => request.rpc), rpc);
  });
}

const rpcError = (id, code = -32603) => ({ jsonrpc: '2.0', id, error: { code, message: 'private upstream detail' } });
for (const [name, options, code, sent] of [
  ['the endpoint reports another chain', { chain: '0x1' }, 'chain_mismatch', 1],
  ['the endpoint is unreachable', { reply: () => { throw new TypeError('Failed to fetch'); } }, 'network_error', 1],
  ['the endpoint fails', { reply: () => new Response('private upstream detail', { status: 503 }) }, 'http_error', 1],
  ['eth_getCode returns an error', { reply: body => body.method === 'eth_getCode' && Response.json(rpcError(2)) }, 'invalid_response', 2],
  ['eth_getCode returns malformed code', { code: '0x6' }, 'invalid_response', 2],
  ['an eth_call fails with an error that is not a revert', { reply: body => body.method === 'eth_call' && Response.json(rpcError(3)) }, 'invalid_response', 3],
  ['a -32000 error that is not a revert', { reply: body => body.method === 'eth_call' && Response.json(rpcError(3, -32000)) }, 'invalid_response', 3],
  ['the total supply is not one word', { calls: { '0x18160ddd': '0x' + word(1) + word(1) } }, 'invalid_response', 3],
  ['the total supply is not hex', { calls: { '0x18160ddd': '0xzz' } }, 'invalid_response', 3],
  ['the total supply has odd length', { calls: { '0x18160ddd': '0x123' } }, 'invalid_response', 3],
  ['the name has a wrong offset', { calls: { '0x06fdde03': '0x' + word(64) + word(3) + '616263'.padEnd(64, '0') } }, 'invalid_response', 4],
  ['the name is longer than its data', { calls: { '0x06fdde03': '0x' + word(32) + word(40) + '61'.repeat(32) } }, 'invalid_response', 4],
  ['the name has extra words', { calls: { '0x06fdde03': abiString('abc') + word(0) } }, 'invalid_response', 4],
  ['the name padding is not zero', { calls: { '0x06fdde03': '0x' + word(32) + word(3) + '616263'.padEnd(62, '0') + '01' } }, 'invalid_response', 4],
  ['the name is too long', { calls: { '0x06fdde03': abiString('a'.repeat(257)) } }, 'invalid_response', 4],
  ['the name is not UTF-8', { calls: { '0x06fdde03': '0x' + word(32) + word(2) + 'c328'.padEnd(64, '0') } }, 'invalid_response', 4],
  ['the name has a control character', { calls: { '0x06fdde03': abiString('Qore\nVest') } }, 'invalid_response', 4],
  ['the name has a bidirectional override', { calls: { '0x06fdde03': abiString('Qore‮Vest') } }, 'invalid_response', 4],
  // A uint word where text is expected: read as bytes32 it starts with zero bytes, which are refused.
  ['the symbol is a number word', { calls: { '0x95d89b41': '0x' + word(32) } }, 'invalid_response', 5],
  ['decimals do not fit a uint8', { calls: { '0x313ce567': '0x' + word(256) } }, 'invalid_response', 6],
  ['decimals are a string', { calls: { '0x313ce567': abiString('6') } }, 'invalid_response', 6],
  ['the body is not JSON', { reply: body => body.method === 'eth_call' && new Response('<html>') }, 'invalid_response', 3],
  ['the response has another id', { reply: body => body.method === 'eth_call' && Response.json({ jsonrpc: '2.0', id: 99, result: LIVE['0x18160ddd'] }) }, 'invalid_response', 3],
  ['a response has both a result and a revert', { reply: body => body.method === 'eth_call' && Response.json({ ...reverted(3), result: '0x' }) }, 'invalid_response', 3],
]) {
  test('token read fails safely when ' + name, async () => {
    const net = diana(options);
    const session = createSession({ fetch: net.fetch });
    const result = await session.handleCommand('Inspect token ' + TOKEN);
    assert.deepEqual([result.kind, result.outcome], ['answered', 'failed']);
    assert.deepEqual([result.run.result.ok, result.run.result.error.stage, result.run.result.error.code], [false, 'execution', code]);
    assert.equal('data' in result.run.result, false);
    assert.equal(result.run.result.error.message.includes('private upstream detail'), false);
    assert.equal(net.requests.length, sent);
    assert.equal(session.context, undefined);
  });
}

test('token read times out safely', async () => {
  const result = await createSession({ timeoutMs: 20, fetch: async () => new Response(new ReadableStream()) }).handleCommand('Inspect token ' + TOKEN);
  assert.deepEqual([result.outcome, result.run.result.error.code], ['failed', 'timeout']);
});

test('a stalled eth_call times out instead of being reported as not answered', async () => {
  const net = diana({ reply: body => body.method === 'eth_call' && new Promise(() => {}) });
  const result = await createSession({ timeoutMs: 20, fetch: net.fetch }).handleCommand('Inspect token ' + TOKEN);
  assert.deepEqual([result.outcome, result.run.result.error.code], ['failed', 'timeout']);
});

test('getEvmToken refuses an address that is not 0x and 40 lower-case hex digits before any request', async () => {
  for (const value of [TOKEN.toUpperCase(), '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', TOKEN.slice(0, -1), '0x' + 'a'.repeat(64), 42, undefined]) {
    await assert.rejects(getEvmToken(value, { fetch: noRequest }), { code: 'invalid_address' });
  }
});

// --- Registry and the eth_call scope -------------------------------------------------------------

test('get_token is a frozen, read-only Diana tool with three read methods and four fixed selectors', () => {
  const tool = getTool('get_token');
  assert.deepEqual([tool.id, tool.network, tool.readOnly], ['get_token', 'qorechain-diana', true]);
  assert.deepEqual(tool.rpcMethods, ['eth_chainId', 'eth_getCode', 'eth_call']);
  assert.deepEqual(tool.callSelectors, SELECTORS);
  assert.deepEqual([...tool.callSelectors].sort(), Object.values(ERC20_CALLS).sort());
  assert.deepEqual(Object.keys(tool.params), ['address']);
  assert.ok(Object.isFrozen(tool) && Object.isFrozen(tool.rpcMethods) && Object.isFrozen(tool.callSelectors) && Object.isFrozen(tool.params));
  for (const entry of listTools()) assert.doesNotMatch(entry.id, /sign|send|transfer|approve|wallet|broadcast/u);
  // No other tool can send eth_call or read contract code.
  for (const entry of listTools().filter(entry => entry.id !== 'get_token')) {
    assert.equal(entry.rpcMethods.includes('eth_call') || entry.rpcMethods.includes('eth_getCode') || 'callSelectors' in entry, false, entry.id);
  }
});

const tokenRequest = (overrides = {}) => ({ tool: 'get_token', network: 'qorechain-diana', params: { address: TOKEN }, rpcMethods: ['eth_chainId', 'eth_getCode', 'eth_call'], ...overrides });

for (const [name, overrides, code] of [
  ['another network', { network: 'qorechain-mainnet' }, 'network_not_allowed'],
  ['a broadcast method', { rpcMethods: ['eth_sendRawTransaction'] }, 'method_not_allowed'],
  ['a gas estimate', { rpcMethods: ['eth_estimateGas'] }, 'method_not_allowed'],
  ['a storage read', { rpcMethods: ['eth_getStorageAt'] }, 'method_not_allowed'],
  ['no address', { params: {} }, 'invalid_params'],
  ['a checksummed address (the tool takes lower case only)', { params: { address: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed' } }, 'invalid_params'],
  ['a 64-hex value', { params: { address: '0x' + 'a'.repeat(64) } }, 'invalid_params'],
  ['a qor1 address', { params: { address: 'qor1qqrsu9guyv4rzwplgex4gkmzd9c8wl593jfe4g' } }, 'invalid_params'],
  ['calldata', { params: { address: TOKEN, data: '0xa9059cbb' } }, 'invalid_params'],
  ['a selector', { params: { address: TOKEN, selector: '0x095ea7b3' } }, 'invalid_params'],
  ['an endpoint', { params: { address: TOKEN, url: 'https://evil.example' } }, 'invalid_params'],
]) {
  test('get_token refuses ' + name + ' before any request', async () => {
    const result = await invokeTool(tokenRequest(overrides), { fetch: noRequest });
    assert.deepEqual([result.ok, result.error.stage, result.error.code], [false, 'validation', code]);
  });
}

test('runtime options cannot redirect the token tool to another endpoint', async () => {
  const net = diana();
  const result = await invokeTool(tokenRequest(), { fetch: net.fetch, rpcUrl: 'https://evil.example', restUrl: 'https://evil.example' });
  assert.equal(result.ok, true);
  assert.ok(net.requests.every(request => request.url === EVM));
});

const SCOPE = { to: TOKEN, selectors: SELECTORS };
const body = (method, params) => JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
const callBody = (call, block = 'latest') => body('eth_call', [call, block]);
const ALLOWED = ['eth_chainId', 'eth_getCode', 'eth_call'];

test('the eth_call scope lets through only the four selectors, to the one contract, at latest', () => {
  for (const data of SELECTORS) assert.equal(isAllowedRpcRequest(callBody({ to: TOKEN, data }), ALLOWED, SCOPE), true, data);
  for (const [name, request] of [
    ['approve(address,uint256)', callBody({ to: TOKEN, data: '0x095ea7b3' + word(1) + word(1) })],
    ['transfer(address,uint256)', callBody({ to: TOKEN, data: '0xa9059cbb' + word(1) + word(1) })],
    ['transferFrom(address,address,uint256)', callBody({ to: TOKEN, data: '0x23b872dd' + word(1) + word(1) + word(1) })],
    ['balanceOf(address)', callBody({ to: TOKEN, data: '0x70a08231' + word(1) })],
    ['allowance(address,address)', callBody({ to: TOKEN, data: '0xdd62ed3e' + word(1) + word(2) })],
    ['a selector with arguments', callBody({ to: TOKEN, data: '0x06fdde03' + word(1) })],
    ['an upper-case selector', callBody({ to: TOKEN, data: '0x06FDDE03' })],
    ['no data', callBody({ to: TOKEN })],
    ['input instead of data', callBody({ to: TOKEN, input: '0x06fdde03' })],
    ['another contract', callBody({ to: '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed', data: '0x06fdde03' })],
    ['a checksummed contract', callBody({ to: '0x67E4862C388A5EAD666F5AC340FE9EF2FC1F8F68', data: '0x06fdde03' })],
    ['a from field', callBody({ to: TOKEN, data: '0x06fdde03', from: TOKEN })],
    ['a value field', callBody({ to: TOKEN, data: '0x06fdde03', value: '0x1' })],
    ['a gas field', callBody({ to: TOKEN, data: '0x06fdde03', gas: '0x5208' })],
    ['another block', callBody({ to: TOKEN, data: '0x06fdde03' }, 'pending')],
    ['a block number', callBody({ to: TOKEN, data: '0x06fdde03' }, '0x1')],
    ['state overrides', body('eth_call', [{ to: TOKEN, data: '0x06fdde03' }, 'latest', { [TOKEN]: { code: '0x00' } }])],
    ['no block', body('eth_call', [{ to: TOKEN, data: '0x06fdde03' }])],
    ['a call list', body('eth_call', [[{ to: TOKEN, data: '0x06fdde03' }], 'latest'])],
    ['no params', body('eth_call', undefined)],
    ['a batch', JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: TOKEN, data: '0x06fdde03' }, 'latest'] }])],
    ['not JSON', 'eth_call'],
  ]) assert.equal(isAllowedRpcRequest(request, ALLOWED, SCOPE), false, name);
  // Without a scope, eth_call is never allowed, even when the method is listed.
  assert.equal(isAllowedRpcRequest(callBody({ to: TOKEN, data: '0x06fdde03' }), ALLOWED), false);
  // Other methods are checked by name as before.
  assert.equal(isAllowedRpcRequest(body('eth_getCode', [TOKEN, 'latest']), ALLOWED, SCOPE), true);
  assert.equal(isAllowedRpcRequest(body('eth_sendRawTransaction', ['0x00']), ALLOWED, SCOPE), false);
});

test('the token guard sends only scoped calls; every other request is refused before fetch', async () => {
  let sent = 0;
  const guarded = guardFetch(async () => { sent++; return Response.json({}); }, getTool('get_token').rpcMethods, SCOPE);
  for (const data of SELECTORS) await guarded(EVM, { method: 'POST', body: callBody({ to: TOKEN, data }) });
  await guarded(EVM, { method: 'POST', body: body('eth_chainId', []) });
  await guarded(EVM, { method: 'POST', body: body('eth_getCode', [TOKEN, 'latest']) });
  for (const request of [
    callBody({ to: TOKEN, data: '0x095ea7b3' + word(1) + word(1) }),
    callBody({ to: TOKEN, data: '0xa9059cbb' + word(1) + word(1) }),
    body('eth_sendRawTransaction', ['0x00']), body('eth_sendTransaction', [{}]), body('eth_sign', []), body('personal_sign', []),
    body('eth_estimateGas', [{ to: TOKEN, data: '0x06fdde03' }]), body('eth_getStorageAt', [TOKEN, '0x0', 'latest']),
  ]) await assert.rejects(guarded(EVM, { method: 'POST', body: request }), TypeError);
  assert.equal(sent, 6);
});

test('the registry gives each token read the scope of its own validated address', async () => {
  const seen = [];
  const fetch = async (_url, init) => { const parsed = JSON.parse(init.body); seen.push(parsed.params?.[0]?.to ?? parsed.params?.[0]); return diana().fetch(_url, init); };
  const result = await invokeTool(tokenRequest(), { fetch });
  assert.equal(result.ok, true);
  assert.ok(seen.slice(1).every(value => value === TOKEN));
});

test('no other tool can send eth_call, even with a well-formed call body', async () => {
  for (const id of ['get_evm_block_number', 'get_balance', 'get_transaction', 'get_block', 'get_gas_fees']) {
    const tool = getTool(id);
    const guarded = guardFetch(async () => assert.fail('sent'), tool.rpcMethods);
    await assert.rejects(guarded(EVM, { method: 'POST', body: callBody({ to: TOKEN, data: '0x06fdde03' }) }), TypeError, id);
  }
});

test('a classifier has no token label and cannot supply an address or calldata', () => {
  for (const output of [[{ label: 'token', score: 0.99 }], [{ label: 'get_token', score: 0.99 }], [{ label: 'network_check', score: 0.99, address: TOKEN }], [{ label: 'block_number', score: 0.99, data: '0x06fdde03' }]]) {
    assert.deepEqual({ ...decideIntent(output, undefined) }, { kind: 'clarify', reason: 'invalid_classifier_output', source: 'classifier' });
  }
});

test('a 40-hex contract address alone is not key material for the safety gate', () => {
  assert.deepEqual(assessRisk('Inspect token ' + TOKEN), { risk: 'none' });
});
