import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DIANA_TARGET, planCommand } from '../src/agent/planner.ts';
import { executePlan } from '../src/agent/executor.ts';
import { routeCommand } from '../src/router.ts';
import { DIANA_NETWORK, getTool, guardFetch, invokeTool, isAllowedRpcRequest, listTools, validateParams } from '../src/agent/registry.ts';
import { getEvmBlockNumber } from '../src/qorechain/get-evm-block-number.ts';

const ok = (id, result) => Response.json({ jsonrpc: '2.0', id, result });
// Live block heights change; mocks use a fresh random height instead of a fixed number.
const randomHeight = () => BigInt(1 + Math.floor(Math.random() * 2 ** 40));
const plan = planCommand('Diana ağını kontrol et.');

function rpc(handlers) {
  const methods = [];
  const fetch = async (url, init) => {
    assert.equal(String(url), 'https://evm-testnet.qore.host/');
    assert.equal(init.method, 'POST');
    const { id, method } = JSON.parse(init.body);
    methods.push(method);
    return handlers[method](id, init);
  };
  return { fetch, methods };
}

const accepted = [
  'Diana ağını kontrol et.',
  'Diana ağını kontrol et',
  '  diana   ağını   KONTROL ET!  ',
  'DİANA AĞINI KONTROL ET.',
  'DIANA AĞINI KONTROL ET.',
  'QoreChain Diana ağını kontrol et.',
  'Diana test ağını kontrol et.',
  "Diana testnet'ini kontrol et.",
];

for (const command of accepted) {
  test('plans the Diana network check for ' + JSON.stringify(command), () => {
    assert.equal(planCommand(command), plan);
  });
}

const rejected = [
  'QoreChain son blok numarasını öğren.',
  'Bu adresin QoreChain bakiyesini göster.',
  'Ana ağı kontrol et.',
  'Mainnet ağını kontrol et.',
  'Diana ağını kontrol etme.',
  'Diana ağını kontrol et ve son blok numarasını göster.',
  'Diana ağını kontrol et, bakiyeyi göster.',
  'Diana ağına transfer yap.',
  'Diana ağını sıfırla.',
  'Ağı kontrol et.',
  '',
  '   ',
];

for (const command of rejected) {
  test('does not plan ' + JSON.stringify(command), () => {
    assert.deepEqual(planCommand(command), { kind: 'no_plan' });
  });
}

test('rejects non-string input without throwing', () => {
  for (const value of [undefined, null, 42, {}]) assert.deepEqual(planCommand(value), { kind: 'no_plan' });
});

test('represents the target and ordered read-only steps explicitly', () => {
  assert.equal(plan.kind, 'plan');
  assert.equal(plan.intent, 'check_network');
  assert.equal(plan.tool, 'get_evm_block_number');
  assert.deepEqual(plan.target, {
    name: 'Diana testnet',
    chainId: 'qorechain-diana',
    evmChainId: '9800',
    evmChainHex: '0x2648',
    endpoint: 'https://evm-testnet.qore.host/',
  });
  assert.deepEqual(plan.steps.map(step => [step.id, step.rpcMethod]), [
    ['verify_chain_id', 'eth_chainId'],
    ['read_block_height', 'eth_blockNumber'],
  ]);
  assert.ok(Object.isFrozen(plan) && Object.isFrozen(plan.steps) && Object.isFrozen(DIANA_TARGET));
  assert.ok(plan.steps.every(Object.isFrozen));
});

test('leaves the existing router contract unchanged', () => {
  assert.deepEqual(routeCommand('Diana ağını kontrol et.'), { kind: 'needs_clarification', reason: 'ambiguous_command' });
  assert.deepEqual(routeCommand('QoreChain son blok numarasını öğren.'), { kind: 'route', tool: 'get_block_number' });
});

test('verifies the chain before reading the block and reports real response data', async () => {
  const height = randomHeight();
  const { fetch, methods } = rpc({
    eth_chainId: id => ok(id, '0x2648'),
    eth_blockNumber: id => ok(id, '0x' + height.toString(16)),
  });
  const result = await executePlan(plan, { fetch });
  assert.deepEqual(methods, ['eth_chainId', 'eth_blockNumber']);
  assert.equal(result.status, 'success');
  assert.deepEqual(result.data, { chainId: 'qorechain-diana', evmChainId: '9800', blockNumber: height.toString() });
  assert.deepEqual(result.steps.map(step => step.status), ['succeeded', 'succeeded']);
  assert.match(result.steps[1].detail, new RegExp(height.toString()));
  assert.equal(result.source, 'https://evm-testnet.qore.host/');
  assert.ok(!Number.isNaN(Date.parse(result.checkedAt)));
  assert.equal(result.error, undefined);
});

test('does not present the check as a network health guarantee', async () => {
  const { fetch } = rpc({ eth_chainId: id => ok(id, '0x2648'), eth_blockNumber: id => ok(id, '0x1') });
  const { summary } = await executePlan(plan, { fetch });
  assert.match(summary, /not a full network health check/);
  assert.doesNotMatch(summary, /\bhealthy\b|fully operational|guarantee/i);
});

for (const chain of ['0x2649', '0x1', '0X2648', '9800', null]) {
  test('stops on wrong chain ID ' + JSON.stringify(chain) + ' without reading a block', async () => {
    const { fetch, methods } = rpc({
      eth_chainId: id => ok(id, chain),
      eth_blockNumber: () => assert.fail('block must not be requested'),
    });
    const result = await executePlan(plan, { fetch });
    assert.deepEqual(methods, ['eth_chainId']);
    assert.equal(result.status, 'failed');
    assert.equal(result.data, undefined);
    assert.equal(result.error.code, chain === null ? 'invalid_response' : 'chain_mismatch');
    assert.deepEqual(result.steps.map(step => step.status), ['failed', 'skipped']);
  });
}

test('names the reported and expected chain IDs on mismatch', async () => {
  const { fetch } = rpc({ eth_chainId: id => ok(id, '0x2649') });
  const result = await executePlan(plan, { fetch });
  assert.equal(result.steps[0].detail, 'Endpoint reported 9801 (0x2649); expected 9800 (0x2648).');
  assert.match(result.summary, /did not identify as Diana testnet/);
});

test('reports an RPC outage as a failed first step', async () => {
  const result = await executePlan(plan, { fetch: async () => { throw new TypeError('Failed to fetch'); } });
  assert.equal(result.status, 'failed');
  assert.equal(result.error.code, 'network_error');
  assert.deepEqual(result.steps.map(step => step.status), ['failed', 'skipped']);
  assert.equal(result.data, undefined);
});

test('reports an HTTP error on the first step', async () => {
  const result = await executePlan(plan, { fetch: async () => new Response('busy', { status: 503 }) });
  assert.equal(result.status, 'failed');
  assert.equal(result.error.code, 'http_error');
  assert.match(result.steps[0].detail, /HTTP 503/);
});

for (const [name, handler, code] of [
  ['an outage', () => { throw new TypeError('Failed to fetch'); }, 'network_error'],
  ['HTTP 502', () => new Response('bad gateway', { status: 502 }), 'http_error'],
  ['an invalid height', id => ok(id, '0x'), 'invalid_response'],
  ['a JSON-RPC error', id => Response.json({ jsonrpc: '2.0', id, error: { code: -32000, message: 'down' } }), 'invalid_response'],
]) {
  test('reports partial failure when the block read hits ' + name, async () => {
    const { fetch, methods } = rpc({ eth_chainId: id => ok(id, '0x2648'), eth_blockNumber: handler });
    const result = await executePlan(plan, { fetch });
    assert.deepEqual(methods, ['eth_chainId', 'eth_blockNumber']);
    assert.equal(result.status, 'partial');
    assert.equal(result.error.code, code);
    assert.equal(result.data, undefined);
    assert.deepEqual(result.steps.map(step => step.status), ['succeeded', 'failed']);
    assert.match(result.steps[0].detail, /9800 \(0x2648\)/);
    assert.match(result.summary, /No block height is reported/);
  });
}

test('reports a timeout on the step that was waiting', async () => {
  const fetch = async (_, init) => {
    if (JSON.parse(init.body).method === 'eth_chainId') return ok(1, '0x2648');
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  };
  const result = await executePlan(plan, { fetch, timeoutMs: 20 });
  assert.equal(result.status, 'partial');
  assert.equal(result.error.code, 'timeout');
  assert.deepEqual(result.steps.map(step => step.status), ['succeeded', 'failed']);
});

test('refuses a plan whose tool is not on the read-only allow list', async () => {
  let requests = 0;
  const tampered = { ...plan, tool: 'prepare_transfer' };
  const result = await executePlan(tampered, { fetch: async () => { requests++; return ok(1, '0x2648'); } });
  assert.equal(requests, 0);
  assert.equal(result.status, 'failed');
  assert.equal(result.error.code, 'tool_not_allowed');
  assert.deepEqual(result.steps.map(step => step.status), ['skipped', 'skipped']);
});

test('refuses a plan step that uses a non-allowed RPC method', async () => {
  let requests = 0;
  const tampered = { ...plan, steps: [...plan.steps, { id: 'send', title: 'Send', rpcMethod: 'eth_sendRawTransaction' }] };
  const result = await executePlan(tampered, { fetch: async () => { requests++; return ok(1, '0x2648'); } });
  assert.equal(requests, 0);
  assert.equal(result.error.code, 'tool_not_allowed');
});

test('does not inherit tools from the object prototype', async () => {
  const result = await executePlan({ ...plan, tool: 'toString' }, { fetch: async () => assert.fail('no request') });
  assert.equal(result.error.code, 'tool_not_allowed');
});

// --- Tool registry -------------------------------------------------------------------------

const request = (overrides = {}) => ({ tool: 'get_evm_block_number', network: 'qorechain-diana', params: {}, ...overrides });
const noRequest = async () => assert.fail('no request may be sent');

test('registry finds the registered read-only Diana tool', () => {
  const tool = getTool('get_evm_block_number');
  assert.equal(tool.id, 'get_evm_block_number');
  assert.equal(tool.network, 'qorechain-diana');
  assert.equal(DIANA_NETWORK, 'qorechain-diana');
  assert.equal(tool.readOnly, true);
  assert.deepEqual(tool.rpcMethods, ['eth_chainId', 'eth_blockNumber']);
  assert.deepEqual(tool.params, {});
  assert.equal(typeof tool.description, 'string');
  assert.equal(typeof tool.run, 'function');
  assert.deepEqual(listTools().map(entry => entry.id), ['get_evm_block_number']);
});

test('registry entries and the tool list are immutable', () => {
  const tool = getTool('get_evm_block_number');
  assert.ok(Object.isFrozen(tool) && Object.isFrozen(tool.rpcMethods) && Object.isFrozen(tool.params));
  assert.ok(Object.isFrozen(listTools()));
  assert.throws(() => { tool.rpcMethods.push('eth_sendRawTransaction'); }, TypeError);
  assert.throws(() => { tool.network = 'mainnet'; }, TypeError);
});

for (const id of ['prepare_transfer', 'eth_sendRawTransaction', 'toString', '__proto__', 'constructor', 'GET_EVM_BLOCK_NUMBER', '', null, undefined, 42]) {
  test('registry rejects unknown tool ' + String(id) + ' before any request', async () => {
    assert.equal(getTool(id), undefined);
    const result = await invokeTool(request({ tool: id }), { fetch: noRequest });
    assert.equal(result.ok, false);
    assert.deepEqual([result.error.stage, result.error.code], ['validation', 'unknown_tool']);
  });
}

for (const [label, params] of [
  ['an address', { address: 'qor1abc' }],
  ['an RPC method', { method: 'eth_sendRawTransaction' }],
  ['an array', []],
  ['a string', 'eth_chainId'],
  ['a number', 42],
  ['null', null],
  ['an object with a custom prototype', Object.create({ inherited: 1 })],
]) {
  test('registry rejects ' + label + ' as params before any request', async () => {
    const result = await invokeTool(request({ params }), { fetch: noRequest });
    assert.equal(result.ok, false);
    assert.deepEqual([result.error.stage, result.error.code], ['validation', 'invalid_params']);
  });
}

for (const network of ['mainnet', 'testnet', 'qorechain-mainnet', 'QORECHAIN-DIANA', 9800, undefined]) {
  test('registry rejects network ' + String(network) + ' before any request', async () => {
    const result = await invokeTool(request({ network }), { fetch: noRequest });
    assert.equal(result.ok, false);
    assert.deepEqual([result.error.stage, result.error.code], ['validation', 'network_not_allowed']);
  });
}

for (const rpcMethods of [['eth_sendRawTransaction'], ['eth_chainId', 'eth_getBalance'], ['personal_sign'], [42], 'eth_chainId']) {
  test('registry rejects RPC methods ' + JSON.stringify(rpcMethods) + ' before any request', async () => {
    const result = await invokeTool(request({ rpcMethods }), { fetch: noRequest });
    assert.equal(result.ok, false);
    assert.deepEqual([result.error.stage, result.error.code], ['validation', 'method_not_allowed']);
  });
}

test('registry validates params against declared rules', () => {
  const spec = {
    address: { type: 'string', required: true, pattern: /^qor1[a-z0-9]+$/u },
    limit: { type: 'integer', required: false, min: 1, max: 10 },
    verbose: { type: 'boolean', required: false },
  };
  assert.equal(validateParams(spec, { address: 'qor1abc' }), undefined);
  assert.equal(validateParams(spec, { address: 'qor1abc', limit: 10, verbose: true }), undefined);
  assert.match(validateParams(spec, {}), /Missing required parameter "address"/);
  assert.match(validateParams(spec, { address: 'cosmos1abc' }), /invalid format/);
  assert.match(validateParams(spec, { address: 'qor1abc', limit: 11 }), /out of range/);
  assert.match(validateParams(spec, { address: 'qor1abc', limit: 1.5 }), /must be a integer/);
  assert.match(validateParams(spec, { address: 'qor1abc', verbose: 'yes' }), /must be a boolean/);
  assert.match(validateParams(spec, { address: 'qor1abc', extra: 1 }), /Unknown parameter "extra"/);
  assert.equal(validateParams({}, undefined), undefined);
});

test('registry passes trusted runtime options to the real tool and returns its data', async () => {
  const height = randomHeight();
  const { fetch, methods } = rpc({
    eth_chainId: id => ok(id, '0x2648'),
    eth_blockNumber: id => ok(id, '0x' + height.toString(16)),
  });
  const result = await invokeTool(request({ rpcMethods: ['eth_chainId', 'eth_blockNumber'] }), { fetch });
  assert.deepEqual(methods, ['eth_chainId', 'eth_blockNumber']);
  assert.deepEqual(result, {
    ok: true,
    tool: 'get_evm_block_number',
    network: 'qorechain-diana',
    data: { chainId: 'qorechain-diana', evmChainId: '9800', blockNumber: height.toString() },
  });
});

test('registry forwards the runtime timeout to the tool', async () => {
  const fetch = (_, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const result = await invokeTool(request(), { fetch, timeoutMs: 15 });
  assert.equal(result.ok, false);
  assert.deepEqual([result.error.stage, result.error.code], ['execution', 'timeout']);
});

for (const [name, fetch, code] of [
  ['an outage', async () => { throw new TypeError('Failed to fetch'); }, 'network_error'],
  ['HTTP 503', async () => new Response('busy', { status: 503 }), 'http_error'],
  ['a wrong chain ID', async (_, init) => ok(JSON.parse(init.body).id, '0x2649'), 'chain_mismatch'],
  ['a malformed body', async () => new Response('not json', { status: 200 }), 'invalid_response'],
]) {
  test('registry reports ' + name + ' as an execution error without data', async () => {
    const result = await invokeTool(request(), { fetch });
    assert.equal(result.ok, false);
    assert.equal(result.data, undefined);
    assert.deepEqual([result.error.stage, result.error.code], ['execution', code]);
    assert.equal(typeof result.error.message, 'string');
  });
}

test('planner output and plan execution are unchanged by the registry', async () => {
  assert.equal(planCommand('Diana ağını kontrol et.'), plan);
  const tool = getTool(plan.tool);
  assert.equal(tool.network, plan.target.chainId);
  assert.ok(plan.steps.every(step => tool.rpcMethods.includes(step.rpcMethod)));
  const height = randomHeight();
  const { fetch, methods } = rpc({ eth_chainId: id => ok(id, '0x2648'), eth_blockNumber: id => ok(id, '0x' + height.toString(16)) });
  const result = await executePlan(plan, { fetch });
  assert.deepEqual(methods, ['eth_chainId', 'eth_blockNumber']);
  assert.equal(result.status, 'success');
  assert.deepEqual(result.data, { chainId: 'qorechain-diana', evmChainId: '9800', blockNumber: height.toString() });
});

// --- Runtime RPC guard ---------------------------------------------------------------------

const allowedMethods = getTool('get_evm_block_number').rpcMethods;
const rpcBody = method => JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] });
const forbiddenMethods = [
  'eth_sendRawTransaction',
  'personal_sign',
  'eth_sendTransaction',
  'eth_sign',
  'eth_signTypedData_v4',
  'eth_accounts',
  'eth_getBalance',
  'eth_call',
  'debug_traceTransaction',
  'ETH_CHAINID',
  ' eth_chainId',
];

for (const method of allowedMethods) {
  test('guard accepts allowed method ' + method, () => {
    assert.equal(isAllowedRpcRequest(rpcBody(method), allowedMethods), true);
  });
}

for (const method of forbiddenMethods) {
  test('guard rejects method ' + JSON.stringify(method), () => {
    assert.equal(isAllowedRpcRequest(rpcBody(method), allowedMethods), false);
  });
}

for (const [label, body] of [
  ['a missing body', undefined],
  ['a null body', null],
  ['an empty body', ''],
  ['a non-JSON body', 'eth_chainId'],
  ['a body without a method', JSON.stringify({ jsonrpc: '2.0', id: 1, params: [] })],
  ['a numeric method', JSON.stringify({ jsonrpc: '2.0', id: 1, method: 42 })],
  ['a null method', JSON.stringify({ jsonrpc: '2.0', id: 1, method: null })],
  ['a JSON-RPC batch', JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'eth_chainId' }])],
  ['a non-string body', new URLSearchParams({ method: 'eth_chainId' })],
]) {
  test('guard rejects ' + label, () => {
    assert.equal(isAllowedRpcRequest(body, allowedMethods), false);
  });
}

test('guarded fetch forwards allowed requests unchanged to the network', async () => {
  const calls = [];
  const response = ok(1, '0x2648');
  const guarded = guardFetch(async (input, init) => { calls.push([input, init]); return response; }, allowedMethods);
  for (const method of allowedMethods) {
    const init = { method: 'POST', body: rpcBody(method) };
    assert.equal(await guarded('https://evm-testnet.qore.host/', init), response);
    assert.deepEqual(calls.at(-1), ['https://evm-testnet.qore.host/', init]);
  }
  assert.equal(calls.length, 2);
});

for (const method of [...forbiddenMethods, undefined]) {
  test('guarded fetch blocks ' + (method ?? 'a request without a method') + ' before any network request', async () => {
    let requests = 0;
    const guarded = guardFetch(async () => { requests++; return ok(1, '0x1'); }, allowedMethods);
    const init = { method: 'POST', body: method === undefined ? undefined : rpcBody(method) };
    await assert.rejects(guarded('https://evm-testnet.qore.host/', init), TypeError);
    assert.equal(requests, 0);
  });
}

test('guard keeps its own copy of the allow list', async () => {
  const list = ['eth_chainId'];
  let requests = 0;
  const guarded = guardFetch(async () => { requests++; return ok(1, '0x2648'); }, list);
  list.push('eth_sendRawTransaction');
  await assert.rejects(guarded('https://evm-testnet.qore.host/', { body: rpcBody('eth_sendRawTransaction') }), TypeError);
  assert.equal(requests, 0);
});

test('guard stops the real EVM reader before an unlisted request reaches the network', async () => {
  const sent = [];
  const network = async (_, init) => {
    const { id, method } = JSON.parse(init.body);
    sent.push(method);
    return method === 'eth_chainId' ? ok(id, '0x2648') : ok(id, '0x1');
  };
  // Allow only eth_chainId so the real tool's eth_blockNumber request must be blocked by the guard.
  await assert.rejects(getEvmBlockNumber({ fetch: guardFetch(network, ['eth_chainId']) }),
    { name: 'QoreChainReadError', code: 'network_error' });
  assert.deepEqual(sent, ['eth_chainId']);
});

test('registry invocations still send only the tool methods through the guard', async () => {
  const sent = [];
  const network = async (_, init) => {
    const { id, method } = JSON.parse(init.body);
    sent.push(method);
    return method === 'eth_chainId' ? ok(id, '0x2648') : ok(id, '0x' + randomHeight().toString(16));
  };
  const result = await invokeTool(request(), { fetch: network });
  assert.equal(result.ok, true);
  assert.deepEqual(sent, ['eth_chainId', 'eth_blockNumber']);
  assert.ok(sent.every(method => allowedMethods.includes(method)));
});
