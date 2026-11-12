// Browser tests for the offline ML-DSA-87 demo (demo/pqc-verify/index.html).
//
// The static checks run everywhere. The browser checks build the demo with Vite, serve it from a
// local HTTP server on 127.0.0.1, and drive a real Chrome or Chromium in headless mode over the
// Chrome DevTools Protocol, using only Node.js built-ins (no Puppeteer or Playwright). Set
// CHROME_PATH to choose the browser. Without one the browser checks are skipped locally, but they
// fail when ELA_REQUIRE_CHROME=1 or CI=true, so CI can never pass them silently.
// ELA_CHROME_NO_SANDBOX=1 adds --no-sandbox for environments where Chrome's sandbox cannot start.
//
// Run: node --test tests/pqc-browser.test.mjs

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { OFFICIAL_VECTOR } from '../src/pqc/demo/official-vector.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = path => readFileSync(join(ROOT, path), 'utf8');
const officialFile = JSON.parse(read('tests/vectors/qorechain-pqc/ml-dsa-87.json'));

// --- Static checks ----------------------------------------------------------------------------

test('demo vector is case 0 of the pinned official vectors, public values only', () => {
  const [first] = officialFile.cases;
  assert.deepEqual(Object.keys(OFFICIAL_VECTOR).sort(), ['message', 'publicKey', 'signature', 'source']);
  assert.equal(OFFICIAL_VECTOR.publicKey, first.publicKey);
  assert.equal(OFFICIAL_VECTOR.message, first.message);
  assert.equal(OFFICIAL_VECTOR.signature, first.signature);
  assert.ok(Object.isFrozen(OFFICIAL_VECTOR));
  const demoText = ['src/pqc/demo/official-vector.ts', 'src/pqc/demo/main.ts', 'demo/pqc-verify/index.html'].map(read).join('\n').toLowerCase();
  for (const item of officialFile.cases) {
    assert.equal(demoText.includes(item.seed.toLowerCase()), false, 'no test seed');
    // An ML-DSA secret key starts with rho, which is also the start of the public key; check the
    // secret part after it (K and tr) instead.
    assert.equal(demoText.includes(item.secretKey.slice(64, 192).toLowerCase()), false, 'no test secret key');
  }
});

test('demo code has no network, signing, or secret-key code', () => {
  const code = read('src/pqc/demo/main.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.deepEqual([...code.matchAll(/from\s+'([^']+)'/g)].map(match => match[1]), ['../verify-ml-dsa-87.ts', '../verify-ml-dsa-87.ts', './official-vector.ts']);
  assert.deepEqual([...code.matchAll(/^import\s+'([^']+)'/gm)].map(match => match[1]), ['./demo.css']);
  for (const forbidden of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'import(', 'Worker', 'localStorage', 'sessionStorage', 'indexedDB', 'cookie', 'keygen', 'secretKey', 'privateKey', 'seed', 'mnemonic', '.sign(', 'eval(', 'innerHTML']) {
    assert.equal(code.includes(forbidden), false, forbidden);
  }
});

test('demo page has a strict Content-Security-Policy and only public-value fields', () => {
  const html = read('demo/pqc-verify/index.html');
  const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] ?? '';
  for (const directive of ["default-src 'none'", "script-src 'self'", "style-src 'self'", "connect-src 'none'", "worker-src 'none'", "form-action 'none'", "base-uri 'none'"]) {
    assert.ok(policy.includes(directive), directive);
  }
  assert.equal(/https?:\/\//.test(html), false, 'no external URL');
  assert.equal(/<script(?![^>]*\bsrc=)[^>]*>/.test(html), false, 'no inline script');
  assert.equal(/<form\b|<input\b/.test(html), false, 'no form or input element');
  assert.deepEqual([...html.matchAll(/<textarea id="([^"]+)"/g)].map(match => match[1]), ['public-key', 'message', 'signature']);
});

test('the demo is separate from the ELA interface and its production build', () => {
  for (const file of ['index.html', 'src/web.ts', 'vite.config.ts']) assert.equal(/demo|pqc/i.test(read(file)), false, file);
});

// --- Real browser checks -----------------------------------------------------------------------

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  return candidates.find(path => path && existsSync(path));
}

const CHROME = findChrome();
const REQUIRE_CHROME = process.env.ELA_REQUIRE_CHROME === '1' || process.env.CI === 'true';
const browserTest = (name, fn) => test(name, {
  skip: CHROME || REQUIRE_CHROME ? false : 'Chrome or Chromium not found (set CHROME_PATH)',
  timeout: 60_000,
}, async t => {
  if (!CHROME) throw new Error('Chrome or Chromium is required (ELA_REQUIRE_CHROME=1 or CI=true) but was not found. Set CHROME_PATH.');
  return fn(t);
});

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const env = { work: undefined, outDir: undefined, server: undefined, origin: undefined, chrome: undefined, page: undefined, assets: [] };
const served = [];
const requests = [];
const problems = [];
let phase = 'load';

/** Minimal Chrome DevTools Protocol client over Node's built-in WebSocket. */
async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolvePromise, reject) => {
    socket.addEventListener('open', resolvePromise, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  const listeners = new Set();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id !== undefined) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
    } else {
      for (const listener of listeners) listener(message);
    }
  });
  return {
    send: (method, params = {}) => new Promise((resolvePromise, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve: resolvePromise, reject });
      socket.send(JSON.stringify({ id, method, params }));
    }),
    on: listener => listeners.add(listener),
    once: (method, timeoutMs = 15_000) => new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => { listeners.delete(listener); reject(new Error('timeout waiting for ' + method)); }, timeoutMs);
      const listener = message => {
        if (message.method === method) { clearTimeout(timer); listeners.delete(listener); resolvePromise(message.params); }
      };
      listeners.add(listener);
    }),
    close: () => socket.close(),
  };
}

async function evaluate(expression) {
  const { result, exceptionDetails } = await env.page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
}

/** Clicks a demo button and returns the result panel state. Verification runs synchronously on click. */
const click = id => evaluate(`(() => {
  document.getElementById(${JSON.stringify(id)}).click();
  const panel = document.getElementById('result');
  return { state: panel.dataset.state, reason: panel.dataset.reason, requests: panel.dataset.requests, title: document.getElementById('result-title').textContent };
})()`);
const setField = (id, value) => evaluate(`document.getElementById(${JSON.stringify(id)}).value = ${JSON.stringify(value)}`);
const externalRequests = () => requests.filter(item => !item.url.startsWith(env.origin + '/') && !item.url.startsWith('data:'));

before(async () => {
  if (!CHROME) return;
  const { build } = await import('vite');
  env.work = mkdtempSync(join(tmpdir(), 'ela-pqc-browser-'));
  env.outDir = join(env.work, 'site');
  await build({
    configFile: false,
    root: ROOT,
    base: './',
    logLevel: 'silent',
    build: { outDir: env.outDir, emptyOutDir: true, modulePreload: false, rollupOptions: { input: join(ROOT, 'demo', 'pqc-verify', 'index.html') } },
  });
  env.assets = readdirSync(join(env.outDir, 'assets')).map(name => ({ name, bytes: readFileSync(join(env.outDir, 'assets', name)) }));

  env.server = createServer((request, response) => {
    served.push(request.url);
    const path = normalize(join(env.outDir, decodeURIComponent(new URL(request.url, 'http://x').pathname)));
    if (!path.startsWith(env.outDir + sep) || !existsSync(path)) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }).end(readFileSync(path));
  });
  await new Promise(resolvePromise => env.server.listen(0, '127.0.0.1', resolvePromise));
  env.origin = 'http://127.0.0.1:' + env.server.address().port;

  env.chrome = spawn(CHROME, [
    '--headless', '--remote-debugging-port=0', '--user-data-dir=' + join(env.work, 'profile'),
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync',
    '--disable-background-networking', '--disable-component-update', '--disable-default-apps',
    ...(process.env.ELA_CHROME_NO_SANDBOX === '1' ? ['--no-sandbox'] : []), 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const browserUrl = await new Promise((resolvePromise, reject) => {
    let text = '';
    const timer = setTimeout(() => reject(new Error('Chrome did not start: ' + text)), 20_000);
    env.chrome.stderr.on('data', chunk => {
      text += chunk;
      const match = text.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timer); resolvePromise(match[1]); }
    });
    env.chrome.on('exit', code => reject(new Error('Chrome exited ' + code + ': ' + text)));
  });
  const port = new URL(browserUrl).port;
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  env.page = await connect(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  env.page.on(({ method, params }) => {
    if (method === 'Network.requestWillBeSent') requests.push({ phase, url: params.request.url });
    if (method === 'Runtime.exceptionThrown') problems.push({ phase, text: params.exceptionDetails.text });
    if (method === 'Runtime.consoleAPICalled' && ['error', 'assert', 'warning'].includes(params.type)) problems.push({ phase, text: params.args.map(arg => arg.value ?? arg.description).join(' ') });
    if (method === 'Log.entryAdded' && ['error', 'warning'].includes(params.entry.level)) problems.push({ phase, text: params.entry.text });
  });
  for (const domain of ['Page', 'Runtime', 'Network', 'Log']) await env.page.send(domain + '.enable');
  await env.page.send('Network.setCacheDisabled', { cacheDisabled: true });
  const loaded = env.page.once('Page.loadEventFired');
  await env.page.send('Page.navigate', { url: env.origin + '/demo/pqc-verify/index.html' });
  await loaded;
  assert.equal(await evaluate('document.documentElement.dataset.ready'), 'true');
});

after(async () => {
  try { env.page?.close(); } catch {}
  if (env.chrome && env.chrome.exitCode === null) {
    const exited = new Promise(resolvePromise => env.chrome.once('exit', resolvePromise));
    env.chrome.kill();
    await Promise.race([exited, new Promise(resolvePromise => setTimeout(resolvePromise, 5_000))]);
  }
  if (env.server?.listening) await new Promise(resolvePromise => env.server.close(resolvePromise));
  if (env.work && resolve(env.work).startsWith(resolve(tmpdir()))) {
    try { rmSync(env.work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch {}
  }
});

browserTest('Chrome loads the demo from this origin only, as one script, under the CSP, with a clean console', async t => {
  const policy = await evaluate(`document.querySelector('meta[http-equiv="Content-Security-Policy"]').content`);
  assert.ok(policy.includes("connect-src 'none'"));
  assert.deepEqual(externalRequests(), []);
  assert.deepEqual(served.sort(), [...new Set(served)].sort(), 'each file requested once');
  const scripts = env.assets.filter(asset => asset.name.endsWith('.js'));
  assert.equal(scripts.length, 1, 'a single script: nothing is loaded later');
  assert.deepEqual(problems, []);
  for (const asset of env.assets) t.diagnostic(`${asset.name}: ${asset.bytes.length} bytes, gzip ${gzipSync(asset.bytes).length} bytes`);
  t.diagnostic('browser: ' + (await env.page.send('Runtime.evaluate', { expression: 'navigator.userAgent', returnByValue: true })).result.value);
});

browserTest('the official test vector verifies in Chrome with no network request', async () => {
  phase = 'verify';
  const before = requests.length;
  const outcome = await click('load-vector');
  assert.deepEqual({ state: outcome.state, reason: outcome.reason, requests: outcome.requests }, { state: 'valid', reason: '', requests: '0' });
  assert.match(outcome.title, /valid/);
  assert.equal(requests.length, before, 'no request seen by Chrome');
  assert.deepEqual(await evaluate(`document.querySelector('#cmp-original .outcome').textContent`), 'Valid');
});

browserTest('changing one message byte makes the same signature fail', async () => {
  const before = requests.length;
  const lastBefore = await evaluate(`document.getElementById('message').value.slice(-2)`);
  const outcome = await click('flip-byte');
  const lastAfter = await evaluate(`document.getElementById('message').value.slice(-2)`);
  assert.equal(Number.parseInt(lastAfter, 16), Number.parseInt(lastBefore, 16) ^ 1);
  assert.deepEqual({ state: outcome.state, reason: outcome.reason, requests: outcome.requests }, { state: 'invalid', reason: 'signature_mismatch', requests: '0' });
  const rows = await evaluate(`[...document.querySelectorAll('#comparison tbody tr')].map(row => [row.querySelector('.byte').textContent, row.querySelector('.outcome').textContent])`);
  assert.deepEqual(rows, [['0x' + lastBefore, 'Valid'], ['0x' + lastAfter, 'Not valid (signature_mismatch)']]);
  assert.equal(requests.length, before);
});

browserTest('malformed and oversized input is refused in Chrome', async () => {
  await click('load-vector');
  const cases = [
    ['public-key', 'zz', 'invalid_encoding'],
    ['public-key', '0x' + OFFICIAL_VECTOR.publicKey.slice(2), 'invalid_encoding'],
    ['public-key', OFFICIAL_VECTOR.publicKey.slice(0, -2), 'invalid_public_key_length'],
    ['signature', OFFICIAL_VECTOR.signature + '00', 'invalid_signature_length'],
    ['signature', '', 'invalid_signature_length'],
    ['message', OFFICIAL_VECTOR.message.slice(0, 10) + ' ' + OFFICIAL_VECTOR.message.slice(10), 'invalid_encoding'],
    ['message', OFFICIAL_VECTOR.message + '0', 'invalid_encoding'],
  ];
  for (const [field, value, reason] of cases) {
    await click('load-vector');
    await setField(field, value);
    const outcome = await click('verify');
    assert.deepEqual({ state: outcome.state, reason: outcome.reason }, { state: 'invalid', reason }, field + ' ' + value.slice(0, 12));
  }
  await click('load-vector');
  const oversized = await click('oversized');
  assert.deepEqual({ state: oversized.state, reason: oversized.reason }, { state: 'invalid', reason: 'message_too_large' });
  await click('load-vector');
  await setField('message', '\n' + OFFICIAL_VECTOR.message + '\n');
  assert.equal((await click('verify')).state, 'valid', 'a pasted outer newline is ignored');
  assert.deepEqual(problems, []);
  assert.deepEqual(externalRequests(), []);
});

browserTest('the page cannot open a network connection (CSP connect-src none)', async () => {
  phase = 'csp-probe';
  const outcome = await evaluate(`fetch('https://example.com/').then(() => 'reached', () => 'blocked')`);
  assert.equal(outcome, 'blocked');
  assert.equal(requests.some(item => item.url.startsWith('https://example.com')), false, 'Chrome did not send it');
  assert.ok(problems.some(item => item.phase === 'csp-probe' && /Content Security Policy/i.test(item.text)), 'Chrome reported the CSP block');
});

browserTest('after loading, verification keeps working with the network off and the server stopped', async () => {
  phase = 'offline';
  await env.page.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await new Promise(resolvePromise => env.server.close(resolvePromise));
  assert.equal(await evaluate('navigator.onLine'), false);
  const before = requests.length;
  assert.equal((await click('load-vector')).state, 'valid');
  assert.deepEqual(await click('flip-byte').then(({ state, reason }) => ({ state, reason })), { state: 'invalid', reason: 'signature_mismatch' });
  assert.equal(requests.length, before);
  assert.deepEqual(problems.filter(item => item.phase === 'offline'), []);
});

browserTest('opening the page cold while offline fails: preloaded is not the same as offline-installed', async () => {
  phase = 'cold-offline';
  const { errorText } = await env.page.send('Page.navigate', { url: env.origin + '/demo/pqc-verify/index.html' });
  assert.match(errorText ?? '', /ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_REFUSED/);
});
