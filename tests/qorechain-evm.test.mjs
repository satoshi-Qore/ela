import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getEvmBlockNumber } from '../src/qorechain/get-evm-block-number.ts';

const ok = (id, result) => Response.json({ jsonrpc: '2.0', id, result });
const fails = (promise, code) => assert.rejects(promise, { name: 'QoreChainReadError', code });

test('verifies Diana before requesting the block and preserves large integer precision', async () => {
  const requests = [];
  const result = await getEvmBlockNumber({ fetch: async (url, init) => {
    assert.equal(url.href, 'https://evm-testnet.qore.host/');
    assert.equal(init.method, 'POST');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    assert.equal(new Headers(init.headers).get('content-type'), 'application/json');
    const request = JSON.parse(init.body);
    requests.push(request);
    return request.id === 1 ? ok(1, '0x2648') : ok(2, '0x20000000000001');
  } });
  assert.deepEqual(requests, [
    { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] },
    { jsonrpc: '2.0', id: 2, method: 'eth_blockNumber', params: [] },
  ]);
  assert.deepEqual(result, { chainId: 'qorechain-diana', evmChainId: '9800', blockNumber: '9007199254740993' });
});

for (const chain of ['0x2649', '0x02648', '0X2648', '9800']) {
  test('rejects chain ' + chain + ' before requesting a block', async () => {
    let requests = 0;
    await fails(getEvmBlockNumber({ fetch: async () => {
      requests++;
      return ok(1, chain);
    } }), 'chain_mismatch');
    assert.equal(requests, 1);
  });
}

for (const height of ['0x', '0x00', '0x3z', '-0x1', '42', '0x1\n', 123, null]) {
  test('rejects invalid block quantity ' + JSON.stringify(height), () =>
    fails(getEvmBlockNumber({ fetch: async (_, init) => JSON.parse(init.body).id === 1 ? ok(1, '0x2648') : ok(2, height) }), 'invalid_response'));
}

test('accepts canonical zero block height', async () => {
  const result = await getEvmBlockNumber({
    fetch: async (_, init) => JSON.parse(init.body).id === 1 ? ok(1, '0x2648') : ok(2, '0x0'),
  });
  assert.equal(result.blockNumber, '0');
});

test('rejects wrong response ID before requesting a block', () =>
  fails(getEvmBlockNumber({ fetch: async () => ok(2, '0x2648') }), 'invalid_response'));
test('rejects a JSON-RPC error even alongside a result', () =>
  fails(getEvmBlockNumber({ fetch: async () => Response.json({
    jsonrpc: '2.0', id: 1, result: '0x2648', error: { code: -32603, message: 'Upstream detail' },
  }) }), 'invalid_response'));
test('rejects missing JSON-RPC version', () =>
  fails(getEvmBlockNumber({ fetch: async () => Response.json({ id: 1, result: '0x2648' }) }), 'invalid_response'));
test('rejects malformed JSON', () =>
  fails(getEvmBlockNumber({ fetch: async () => new Response('not JSON') }), 'invalid_response'));
test('reports HTTP failures', () =>
  fails(getEvmBlockNumber({ fetch: async () => new Response(null, { status: 503 }) }), 'http_error'));
test('reports CORS or network rejection', () =>
  fails(getEvmBlockNumber({ fetch: async () => { throw new TypeError('Failed to fetch'); } }), 'network_error'));
test('times out and aborts a stalled block response after chain validation', async () => {
  let signal;
  await fails(getEvmBlockNumber({ timeoutMs: 20, fetch: async (_, init) => {
    if (JSON.parse(init.body).id === 1) return ok(1, '0x2648');
    signal = init.signal;
    return new Response(new ReadableStream());
  } }), 'timeout');
  assert.equal(signal.aborted, true);
});
