import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getBlockNumber } from '../src/qorechain/get-block-number.ts';
import { getBalance } from '../src/qorechain/get-balance.ts';
import { routeCommand } from '../src/router.ts';

const faucet = 'qor178nscfyp0cq2ac5x7un4u98xrj4ayp6pt0kw08';
const status = (height = '9594600', network = 'qorechain-diana', catchingUp = false) => ({
  jsonrpc: '2.0',
  id: -1,
  result: { node_info: { network }, sync_info: { latest_block_height: height, catching_up: catchingUp } },
});
const mock = data => async () => Response.json(data);
const rejects = (promise, code) => assert.rejects(promise, { name: 'QoreChainReadError', code });

test('block tool reads the documented testnet status using one GET', async () => {
  const requests = [];
  const result = await getBlockNumber({ fetch: async (url, options) => {
    requests.push([String(url), options.method, options.redirect]);
    return Response.json(status());
  } });
  assert.deepEqual(requests, [['https://rpc-testnet.qore.host/status', 'GET', 'error']]);
  assert.deepEqual(result, { chainId: 'qorechain-diana', blockNumber: '9594600' });
});

test('RPC override preserves its configured path prefix', async () => {
  await getBlockNumber({ rpcUrl: 'https://rpc.example/proxy', fetch: async url => {
    assert.equal(String(url), 'https://rpc.example/proxy/status');
    return Response.json(status());
  } });
});

test('rejects the wrong chain', () =>
  rejects(getBlockNumber({ fetch: mock(status('42', 'qorechain-vladi')) }), 'chain_mismatch'));
test('rejects a syncing node as a source of the latest block', () =>
  rejects(getBlockNumber({ fetch: mock(status('42', 'qorechain-diana', true)) }), 'node_syncing'));

for (const bad of [null, '42', -1, '1.5', '-3', '1e3', '0']) {
  test('rejects malformed status or height ' + JSON.stringify(bad), () => {
    const body = bad === null || bad === '42' ? bad : status(bad);
    return rejects(getBlockNumber({ fetch: mock(body) }), 'invalid_response');
  });
}

test('rejects an RPC error envelope even if the result also exists', () =>
  rejects(getBlockNumber({ fetch: mock({ ...status(), error: { code: -32603 } }) }), 'invalid_response'));

test('native balance uses the REST bank query and preserves large integer precision', async () => {
  const result = await getBalance(faucet, { restUrl: 'https://lcd.example/api/', fetch: async (url, options) => {
    assert.equal(String(url), 'https://lcd.example/api/cosmos/bank/v1beta1/balances/' + faucet + '/by_denom?denom=uqor');
    assert.equal(options.method, 'GET');
    return Response.json({ balance: { denom: 'uqor', amount: '9007199254740993123456' } });
  } });
  assert.deepEqual(result, { address: faucet, denom: 'uqor', amountUqor: '9007199254740993123456', amountQor: '9007199254740993.123456' });
});

test('accepts uppercase Bech32 and preserves exact zero', async () => {
  const result = await getBalance(faucet.toUpperCase(), { fetch: async url => {
    assert.equal(url.hostname, 'api-testnet.qore.host');
    assert.ok(url.pathname.includes(faucet));
    return Response.json({ balance: { denom: 'uqor', amount: '0' } });
  } });
  assert.equal(result.address, faucet);
  assert.equal(result.amountQor, '0');
});

for (const address of ['0x' + 'a'.repeat(40), faucet.slice(0, -1) + 'q', 'Q' + faucet.slice(1), '../status', ' ' + faucet]) {
  test('rejects malformed address before calling fetch ' + address, async () => {
    let called = false;
    await rejects(getBalance(address, { fetch: async () => { called = true; return new Response(); } }), 'invalid_address');
    assert.equal(called, false);
  });
}

for (const balance of [null, { denom: 'other', amount: '1' }, { denom: 'uqor', amount: -1 }, { denom: 'uqor', amount: '1.2' }]) {
  test('rejects invalid balance ' + JSON.stringify(balance), () =>
    rejects(getBalance(faucet, { fetch: mock({ balance }) }), 'invalid_response'));
}

test('rejects network failure with a stable error code', () =>
  rejects(getBlockNumber({ fetch: async () => { throw new TypeError('transport detail'); } }), 'network_error'));
test('rejects HTTP errors with a stable error code', () =>
  rejects(getBalance(faucet, { fetch: async () => new Response('private upstream detail', { status: 503 }) }), 'http_error'));
test('rejects non-JSON bodies', () =>
  rejects(getBlockNumber({ fetch: async () => new Response('<html>') }), 'invalid_response'));
test('times out a stalled request and signals cancellation', async () => {
  let signal;
  await rejects(getBlockNumber({ timeoutMs: 15, fetch: (_, options) => {
    signal = options.signal;
    return new Promise(() => {});
  } }), 'timeout');
  assert.equal(signal.aborted, true);
});
test('times out a stalled response body', () =>
  rejects(getBalance(faucet, { timeoutMs: 15, fetch: async () => new Response(new ReadableStream()) }), 'timeout'));

test('rejects invalid endpoint and timeout configuration before making a request', async () => {
  const fetch = async () => assert.fail('Unexpected network request');
  await rejects(getBlockNumber({ rpcUrl: 'file:///status', fetch }), 'invalid_configuration');
  await rejects(getBalance(faucet, { timeoutMs: 0, fetch }), 'invalid_configuration');
});

test('router result supplies the address to the separate balance tool', async () => {
  const route = routeCommand('Bu adresin bakiyesini göster.', { address: faucet, network: 'testnet' });
  assert.equal(route.tool, 'get_balance');
  const result = await getBalance(route.address, { fetch: mock({ balance: { denom: 'uqor', amount: '1250000' } }) });
  assert.equal(result.amountQor, '1.25');
});
