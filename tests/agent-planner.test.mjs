import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DIANA_TARGET, planCommand } from '../src/agent/planner.ts';
import { executePlan } from '../src/agent/executor.ts';
import { routeCommand } from '../src/router.ts';

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
