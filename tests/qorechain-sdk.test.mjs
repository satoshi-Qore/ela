// Compares the official-SDK Diana EVM reader (src/qorechain/sdk-evm-reader.ts) with ELA's own reader
// (src/qorechain/get-evm-block-number.ts, built on read-client.ts) on identical mocked responses.
//
// Run: node --test tests/qorechain-sdk.test.mjs
// Live comparison against Diana (two public read-only requests per reader): ELA_LIVE=1 node --test tests/qorechain-sdk.test.mjs

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getEvmBlockNumber } from '../src/qorechain/get-evm-block-number.ts';
import { getEvmBlockNumberWithSdk } from '../src/qorechain/sdk-evm-reader.ts';
import * as sdkReader from '../src/qorechain/sdk-evm-reader.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const ok = (id, result) => Response.json({ jsonrpc: '2.0', id, result });
const readers = { ela: getEvmBlockNumber, sdk: getEvmBlockNumberWithSdk };

/** Runs one reader against a scripted fetch and records every request it sends. */
async function run(reader, respond, options = {}) {
  const requests = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({
      url: url instanceof URL ? url.href : String(url),
      method: init.method,
      credentials: init.credentials,
      redirect: init.redirect,
      contentType: new Headers(init.headers).get('content-type'),
      hasSignal: init.signal instanceof AbortSignal,
      body,
    });
    return respond(body, init);
  };
  try {
    return { result: await reader({ ...options, fetch }), requests };
  } catch (error) {
    return { error: error.name + ':' + error.code, requests };
  }
}

/** Runs both readers on the same script and asserts the same outcome and the same requests. */
async function same(respond, options) {
  const ela = await run(readers.ela, respond, options);
  const sdk = await run(readers.sdk, respond, options);
  assert.deepEqual({ result: sdk.result, error: sdk.error }, { result: ela.result, error: ela.error });
  assert.deepEqual(sdk.requests, ela.requests);
  return sdk;
}

const diana = height => body => body.id === 1 ? ok(1, '0x2648') : ok(2, height);

test('both readers return the same Diana block for the same responses', async () => {
  for (const [height, expected] of [['0x20000000000001', '9007199254740993'], ['0x0', '0'], ['0x97e6b0', '9954992'], ['0xffffffffffffffffff', '4722366482869645213695']]) {
    const { result, requests } = await same(diana(height));
    assert.deepEqual(result, { chainId: 'qorechain-diana', evmChainId: '9800', blockNumber: expected });
    assert.deepEqual(requests.map(item => item.body), [
      { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] },
      { jsonrpc: '2.0', id: 2, method: 'eth_blockNumber', params: [] },
    ]);
    for (const item of requests) {
      assert.deepEqual({ ...item, body: undefined }, { url: 'https://evm-testnet.qore.host/', method: 'POST', credentials: 'omit', redirect: 'error', contentType: 'application/json', hasSignal: true, body: undefined });
    }
  }
});

for (const chain of ['0x2649', '0x2647', '0x1', '0x02648', '0X2648', '9800', '', 9800, null]) {
  test('wrong chain ID ' + JSON.stringify(chain) + ': both refuse before asking for a block', async () => {
    const { error, requests } = await same(() => ok(1, chain));
    assert.match(error, /^QoreChainReadError:(chain_mismatch|invalid_response)$/);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.method, 'eth_chainId');
  });
}

for (const height of ['0x', '0x00', '0x3z', '-0x1', '42', '0x1\n', ' 0x1', 123, null, true, {}]) {
  test('invalid block height ' + JSON.stringify(height) + ': both report invalid_response', async () => {
    const { error } = await same(diana(height));
    assert.equal(error, 'QoreChainReadError:invalid_response');
  });
}

const malformed = {
  'wrong response ID': () => ok(2, '0x2648'),
  'string response ID': () => Response.json({ jsonrpc: '2.0', id: '1', result: '0x2648' }),
  'missing JSON-RPC version': () => Response.json({ id: 1, result: '0x2648' }),
  'JSON-RPC 1.0': () => Response.json({ jsonrpc: '1.0', id: 1, result: '0x2648' }),
  'error alongside a result': () => Response.json({ jsonrpc: '2.0', id: 1, result: '0x2648', error: { code: -32603, message: 'x' } }),
  'JSON-RPC error only': () => Response.json({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } }),
  'null error with result': () => Response.json({ jsonrpc: '2.0', id: 1, result: '0x2648', error: null }),
  'missing result': () => Response.json({ jsonrpc: '2.0', id: 1 }),
  'array body': () => Response.json([{ jsonrpc: '2.0', id: 1, result: '0x2648' }]),
  'null body': () => Response.json(null),
  'non-JSON body': () => new Response('not JSON'),
  'HTML body': () => new Response('<html>502</html>', { headers: { 'content-type': 'text/html' } }),
  'empty body': () => new Response(''),
};
for (const [name, respond] of Object.entries(malformed)) {
  test('corrupt response (' + name + '): both report invalid_response after one request', async () => {
    const { error, requests } = await same(respond);
    assert.equal(error, 'QoreChainReadError:invalid_response');
    assert.equal(requests.length, 1);
  });
}

for (const status of [400, 404, 429, 500, 502, 503, 504]) {
  test('HTTP ' + status + ': both report http_error and send no retry', async () => {
    const { error, requests } = await same(() => new Response('upstream detail', { status }));
    assert.equal(error, 'QoreChainReadError:http_error');
    assert.equal(requests.length, 1, 'the SDK retries 5xx by default; the adapter turns retries off');
  });
}

test('HTTP failure on the block request: both stop after two requests', async () => {
  const { error, requests } = await same(body => body.id === 1 ? ok(1, '0x2648') : new Response(null, { status: 503 }));
  assert.equal(error, 'QoreChainReadError:http_error');
  assert.equal(requests.length, 2);
});

for (const [name, failure] of [['TypeError (CORS, DNS, offline)', new TypeError('Failed to fetch')], ['AbortError', new DOMException('aborted', 'AbortError')], ['plain Error', new Error('socket hang up')]]) {
  test('network failure (' + name + '): both report network_error and send no retry', async () => {
    const { error, requests } = await same(() => { throw failure; });
    assert.equal(error, 'QoreChainReadError:network_error');
    assert.equal(requests.length, 1);
  });
}

test('timeout while the response body stalls: both report timeout and abort the request', async () => {
  for (const reader of Object.values(readers)) {
    let signal;
    const { error, requests } = await run(reader, (body, init) => {
      if (body.id === 1) return ok(1, '0x2648');
      signal = init.signal;
      return new Response(new ReadableStream());
    }, { timeoutMs: 30 });
    assert.equal(error, 'QoreChainReadError:timeout');
    assert.equal(signal.aborted, true);
    assert.equal(requests.length, 2);
  }
});

test('timeout when fetch never settles: both report timeout without retrying', async () => {
  for (const reader of Object.values(readers)) {
    const started = Date.now();
    const { error, requests } = await run(reader, () => new Promise(() => {}), { timeoutMs: 30 });
    assert.equal(error, 'QoreChainReadError:timeout');
    assert.equal(requests.length, 1);
    assert.ok(Date.now() - started < 2000);
  }
});

test('invalid options are refused before any request', async () => {
  for (const options of [{ timeoutMs: 0 }, { timeoutMs: -1 }, { timeoutMs: 1.5 }, { timeoutMs: 2 ** 31 }, { fetch: 'nope' }]) {
    for (const reader of Object.values(readers)) {
      await assert.rejects(reader(options), { name: 'QoreChainReadError', code: 'invalid_configuration' });
    }
  }
});

test('the adapter uses only the SDK transport and network preset, no signing, wallet, or transaction code', () => {
  assert.deepEqual(Object.keys(sdkReader), ['getEvmBlockNumberWithSdk']);
  const code = read('src/qorechain/sdk-evm-reader.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const sdkImports = [...code.matchAll(/import\s+(type\s+)?\{([^}]+)\}\s+from\s+'@qorechain\/sdk'/g)].flatMap(match => match[2].split(',').map(name => (match[1] ? 'type ' : '') + name.trim()));
  assert.deepEqual(sdkImports.sort(), ['QoreHttpError', 'getNetwork', 'postJsonRpc', 'type FetchLike'].sort());
  assert.deepEqual([...new Set([...code.matchAll(/'((?:eth|net|web3|qor|debug|personal|txpool)_\w+)'/g)].map(match => match[1]))].sort(), ['eth_blockNumber', 'eth_chainId']);
  for (const forbidden of ['createClient', 'connectTx', 'Signer', 'mnemonic', 'Wallet', 'wallet', 'broadcast', 'privateKey', 'secret', 'viem', 'import(', 'eth_send', 'eth_sign']) {
    assert.equal(code.includes(forbidden), false, forbidden);
  }
  assert.equal(/\bsign\w*\s*\(/i.test(code), false, 'no signing call');
});

test('the SDK testnet preset matches ELA\'s Diana configuration', async () => {
  const { getNetwork } = await import('@qorechain/sdk');
  const network = getNetwork('testnet');
  assert.equal(network.chainId, 'qorechain-diana');
  assert.equal(network.evmChainId, 9800);
  assert.equal(new URL(network.endpoints.evmRpc).href, 'https://evm-testnet.qore.host/');
});

test('importing the SDK loads viem, but running the adapter opens no other network channel', () => {
  // @qorechain/sdk re-exports from @qorechain/evm, which imports viem statically, so viem (a peer
  // dependency of @qorechain/evm) is needed at runtime. Every built-in network API is trapped here:
  // the only traffic must be the two requests through the injected fetch.
  const script = `
    import { registerHooks } from 'node:module';
    import http from 'node:http';
    import https from 'node:https';
    import net from 'node:net';
    const seen = [];
    const blocked = [];
    registerHooks({ resolve(specifier, context, next) { seen.push(specifier); return next(specifier, context); } });
    const trap = name => function () { blocked.push(name); throw new Error('network access: ' + name); };
    globalThis.fetch = trap('fetch');
    globalThis.WebSocket = trap('WebSocket');
    globalThis.XMLHttpRequest = trap('XMLHttpRequest');
    globalThis.EventSource = trap('EventSource');
    for (const [module, name] of [[http, 'http'], [https, 'https']]) { module.request = trap(name + '.request'); module.get = trap(name + '.get'); }
    net.connect = trap('net.connect');
    net.createConnection = trap('net.createConnection');
    const { getEvmBlockNumberWithSdk } = await import(${JSON.stringify(new URL('../src/qorechain/sdk-evm-reader.ts', import.meta.url).href)});
    const ok = (id, result) => Response.json({ jsonrpc: '2.0', id, result });
    const methods = [];
    const result = await getEvmBlockNumberWithSdk({ fetch: async (_, init) => {
      const body = JSON.parse(init.body);
      methods.push(body.method);
      return body.id === 1 ? ok(1, '0x2648') : ok(2, '0x10');
    } });
    process.stdout.write(JSON.stringify({ result, methods, blocked, seen }));
  `;
  const output = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: ROOT, encoding: 'utf8' }));
  assert.deepEqual(output.result, { chainId: 'qorechain-diana', evmChainId: '9800', blockNumber: '16' });
  assert.deepEqual(output.methods, ['eth_chainId', 'eth_blockNumber']);
  assert.deepEqual(output.blocked, []);
  assert.ok(output.seen.includes('@qorechain/sdk'));
  assert.ok(output.seen.includes('viem'), 'viem is loaded through @qorechain/evm');
});

test('the SDK adapter is not used by the registry, the agent, or the interface', () => {
  for (const file of ['src/web.ts', 'src/router.ts', 'src/agent/registry.ts', 'src/agent/planner.ts', 'src/agent/conversation.ts', 'src/agent/executor.ts', 'src/agent/intent.ts', 'src/agent/lexicon.ts', 'index.html', 'vite.config.ts']) {
    assert.equal(/sdk-evm-reader|@qorechain\/sdk|WithSdk/.test(read(file)), false, file);
  }
  assert.match(read('src/agent/registry.ts'), /import \{ getEvmBlockNumber \} from '\.\.\/qorechain\/get-evm-block-number\.ts';/);
});

test('live Diana: both readers agree on the chain and on a nearby block height', { skip: process.env.ELA_LIVE === '1' ? false : 'set ELA_LIVE=1 to query Diana', timeout: 60_000 }, async t => {
  const first = await getEvmBlockNumber({ timeoutMs: 15_000 });
  const viaSdk = await getEvmBlockNumberWithSdk({ timeoutMs: 15_000 });
  const second = await getEvmBlockNumber({ timeoutMs: 15_000 });
  for (const result of [first, viaSdk, second]) assert.deepEqual({ ...result, blockNumber: undefined }, { chainId: 'qorechain-diana', evmChainId: '9800', blockNumber: undefined });
  const [a, b, c] = [first, viaSdk, second].map(result => BigInt(result.blockNumber));
  t.diagnostic(`ELA ${a}, SDK ${b}, ELA again ${c}`);
  assert.ok(a > 0n);
  // Blocks keep coming between the requests, so heights are compared as an ordered window.
  assert.ok(a <= b && b <= c, 'SDK height lies between two ELA reads');
  assert.ok(c - a < 100n, 'the reads are close in time');
});
