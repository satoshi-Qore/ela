// Characterization tests for the live ELA interface (index.html + src/web.ts).
//
// They pin observable behavior: which commands run which read-only query, which are refused or only
// get a clarification, what the status messages say, and how the conversation context changes.
// Written in 7A against the interface before the agent integration. In 7C the interface was moved
// onto the agent session (src/agent/session.ts); tests whose expectations changed on purpose say
// "Changed in 7C" and describe the old behavior. Everything else is unchanged from 7A.
//
// The production page is built with the project's Vite config, served from 127.0.0.1, and driven
// in a real headless Chrome or Chromium over the DevTools Protocol (Node.js built-ins only). RPC
// responses are scripted by a fetch stub injected before the page's own scripts; Chrome also blocks
// every *.qore.host URL, so the tests never reach the live network.
//
// Without a browser the checks are skipped locally; with ELA_REQUIRE_CHROME=1 or CI=true they fail.
// ELA_CHROME_START_TIMEOUT_MS works as in tests/pqc-browser.test.mjs (default 60000).
//
// Run: node --test tests/ui-characterization.test.mjs
// Print observed behavior instead of asserting it: ELA_UI_PROBE=1 node --test tests/ui-characterization.test.mjs

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { intentEvalSet } from './intent-eval-set.mjs';
import { intentEvalSetEn } from './intent-eval-set-en.mjs';
import { intentHeldoutSet } from './intent-heldout-set.mjs';
import { GATE_LEAKS_7G, gateAttacks, gateSafe } from './safety-gate-set.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROBE = process.env.ELA_UI_PROBE === '1';

// --- Browser and server setup ------------------------------------------------------------------

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
const SKIP = CHROME || REQUIRE_CHROME ? false : 'Chrome or Chromium not found (set CHROME_PATH)';

function chromeStartTimeout(value = process.env.ELA_CHROME_START_TIMEOUT_MS) {
  if (value === undefined) return 60_000;
  const ms = /^[1-9][0-9]{0,8}$/.test(value) ? Number(value) : Number.NaN;
  if (!(ms >= 1_000 && ms <= 600_000)) throw new Error(`ELA_CHROME_START_TIMEOUT_MS must be whole milliseconds from 1000 to 600000, got ${JSON.stringify(value)}.`);
  return ms;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const env = { work: undefined, outDir: undefined, server: undefined, origin: undefined, chrome: undefined, page: undefined, startMs: undefined };
const networkLog = [];
const problems = [];

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

// Scripted EVM JSON-RPC, installed before the page's own scripts. Every call is recorded.
const RPC_STUB = `(() => {
  const rpc = { mode: 'ok', height: '0x97e6b0', calls: [] };
  Object.defineProperty(window, '__rpc', { value: rpc });
  const reply = (id, result) => new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { headers: { 'content-type': 'application/json' } });
  window.fetch = (input, init = {}) => {
    let body = null;
    try { body = JSON.parse(init.body); } catch {}
    rpc.calls.push({ url: String(input), httpMethod: init.method, credentials: init.credentials, redirect: init.redirect, method: body && body.method });
    const id = body && body.id;
    const isChain = body && body.method === 'eth_chainId';
    switch (rpc.mode) {
      case 'network_error': return Promise.reject(new TypeError('Failed to fetch'));
      case 'http_500': return Promise.resolve(new Response('upstream detail', { status: 500 }));
      case 'bad_json': return Promise.resolve(new Response('<html>not json</html>'));
      case 'wrong_chain': return Promise.resolve(reply(id, isChain ? '0x1' : rpc.height));
      case 'block_fails': return Promise.resolve(isChain ? reply(id, '0x2648') : new Response(null, { status: 503 }));
      case 'stall': return new Promise((_, reject) => {
        if (init.signal) init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      });
      default: return Promise.resolve(reply(id, isChain ? '0x2648' : rpc.height));
    }
  };
})();`;

async function startBrowser() {
  if (!CHROME) throw new Error('Chrome or Chromium is required (ELA_REQUIRE_CHROME=1 or CI=true) but was not found. Set CHROME_PATH.');
  const startLimitMs = chromeStartTimeout();
  const { build } = await import('vite');
  env.work = mkdtempSync(join(tmpdir(), 'ela-ui-characterization-'));
  env.outDir = join(env.work, 'site');
  // The production build: the project's own vite.config.ts (base /ela/).
  await build({ configFile: join(ROOT, 'vite.config.ts'), root: ROOT, logLevel: 'silent', build: { outDir: env.outDir, emptyOutDir: true } });

  env.server = createServer((request, response) => {
    let pathname = decodeURIComponent(new URL(request.url, 'http://x').pathname);
    if (pathname === '/ela' || pathname === '/ela/') pathname = '/index.html';
    else if (pathname.startsWith('/ela/')) pathname = pathname.slice(4);
    const path = normalize(join(env.outDir, pathname));
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
  const started = performance.now();
  const browserUrl = await new Promise((resolvePromise, reject) => {
    let text = '';
    const timer = setTimeout(() => reject(new Error(`Chrome did not start within ${startLimitMs} ms (ELA_CHROME_START_TIMEOUT_MS). Output: ${text}`)), startLimitMs);
    env.chrome.stderr.on('data', chunk => {
      text += chunk;
      const match = text.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timer); resolvePromise(match[1]); }
    });
    env.chrome.on('error', error => { clearTimeout(timer); reject(new Error('Chrome could not be started: ' + error.message)); });
    env.chrome.on('exit', code => { clearTimeout(timer); reject(new Error('Chrome exited ' + code + ': ' + text)); });
  });
  env.startMs = Math.round(performance.now() - started);
  const port = new URL(browserUrl).port;
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  env.page = await connect(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  env.page.on(({ method, params }) => {
    if (method === 'Network.requestWillBeSent') networkLog.push(params.request.url);
    if (method === 'Runtime.exceptionThrown') problems.push(params.exceptionDetails.text);
    if (method === 'Runtime.consoleAPICalled' && ['error', 'assert', 'warning'].includes(params.type)) problems.push(params.args.map(arg => arg.value ?? arg.description).join(' '));
    if (method === 'Log.entryAdded' && ['error', 'warning'].includes(params.entry.level)) problems.push(params.entry.text + (params.entry.url ? ' ' + new URL(params.entry.url).pathname : ''));
  });
  for (const domain of ['Page', 'Runtime', 'Network', 'Log']) await env.page.send(domain + '.enable');
  await env.page.send('Network.setCacheDisabled', { cacheDisabled: true });
  // Defense in depth: even if the stub failed, no request may reach the real endpoints.
  await env.page.send('Network.setBlockedURLs', { urls: ['*qore.host*'] });
  await env.page.send('Page.addScriptToEvaluateOnNewDocument', { source: RPC_STUB });
}

async function stopBrowser() {
  try { env.page?.close(); } catch {}
  env.page = undefined;
  if (env.chrome && env.chrome.exitCode === null && env.chrome.signalCode === null) {
    const exited = new Promise(resolvePromise => env.chrome.once('exit', resolvePromise));
    env.chrome.kill();
    await Promise.race([exited, new Promise(resolvePromise => setTimeout(resolvePromise, 5_000))]);
  }
  if (env.server?.listening) await new Promise(resolvePromise => env.server.close(resolvePromise));
  if (env.work && resolve(env.work).startsWith(resolve(tmpdir()))) {
    try { rmSync(env.work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch {}
  }
  env.work = undefined;
}

// --- Page helpers --------------------------------------------------------------------------------

/** Opens a fresh page session (new conversation, no context) with the given RPC mode. */
async function openPage(mode = 'ok') {
  const loaded = env.page.once('Page.loadEventFired');
  await env.page.send('Page.navigate', { url: env.origin + '/ela/' });
  await loaded;
  await evaluate(`window.__rpc.mode = ${JSON.stringify(mode)}`);
}

const setMode = mode => evaluate(`window.__rpc.mode = ${JSON.stringify(mode)}`);

const READ_VIEW = `(() => {
  const text = id => document.getElementById(id).textContent;
  const state = document.getElementById('query-state');
  return {
    state: state.textContent,
    stateKey: state.dataset.state,
    message: text('query-message'),
    block: text('block-number'),
    chain: text('chain-id'),
    evmChain: text('evm-chain-id'),
    planVisible: !document.getElementById('plan').hidden,
    planTarget: text('plan-target'),
    steps: [...document.querySelectorAll('#plan-steps li')].map(item => [item.dataset.status, item.querySelector('code').textContent]),
    context: text('context-status'),
    clearEnabled: !document.getElementById('clear-context').disabled,
    runEnabled: !document.getElementById('run').disabled,
    rpc: window.__rpc.calls.map(call => call.method),
  };
})()`;

/** Submits a command through the real form and waits until the interface is idle again. */
async function submit(command, { timeoutMs = 20_000 } = {}) {
  await evaluate(`window.__rpc.calls.length = 0`);
  return evaluate(`(async () => {
    document.getElementById('command').value = ${JSON.stringify(command)};
    document.getElementById('command-form').requestSubmit();
    const started = Date.now();
    await new Promise(resolve => setTimeout(resolve, 0));
    while (document.getElementById('run').disabled || document.getElementById('query-state').dataset.state === 'querying') {
      if (Date.now() - started > ${timeoutMs}) throw new Error('interface did not settle');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    return ${READ_VIEW};
  })()`);
}

const view = () => evaluate(READ_VIEW);

/** In probe mode, prints the observation; otherwise asserts the expected subset of fields. */
function expectView(t, observed, expected, label = '') {
  if (PROBE) {
    t.diagnostic((label ? label + ' ' : '') + JSON.stringify(observed));
    return;
  }
  const subset = Object.fromEntries(Object.keys(expected).map(key => [key, observed[key]]));
  assert.deepEqual(subset, expected, label);
}

// --- Expected texts (as shown today) ----------------------------------------------------------------

const MSG = {
  ready: 'Waiting for a command.',
  blockSuccess: 'Latest block received from Diana testnet via EVM JSON-RPC.',
  clarifyGeneric: 'Ask for the latest block number on Diana testnet, ask ELA to check the Diana network, or use an example command.',
  clarifyNoContext: 'There is no earlier successful query in this page session to follow up on. Ask for the latest block number on Diana testnet or ask ELA to check the Diana network first.',
  networkError: 'The browser could not read the testnet EVM JSON-RPC. Check your connection. The endpoint may restrict cross-origin requests (CORS).',
  // New in 7C.
  clarifyNetwork: 'This interface only reads Diana testnet. Other networks, such as mainnet, are not supported.',
  clarifyEmpty: 'Type a command, for example "Check Diana network." or "Diana ağını kontrol et."',
  unsupported: 'ELA can only check the Diana network and read its latest block. Balances, fees, transactions, and other data are not supported yet.',
};
const REFUSAL_TAIL = ' Nothing was sent. Ask for the latest block or a Diana network check instead.';
const REFUSED = {
  transfer: 'ELA is read-only and cannot send, transfer, or withdraw funds.' + REFUSAL_TAIL,
  signing: 'ELA does not sign or approve messages or transactions.' + REFUSAL_TAIL,
  key_material: 'ELA never asks for or handles private keys, seed phrases, recovery phrases, or passwords. Do not share them. The command field was cleared.' + REFUSAL_TAIL,
  wallet_control: 'ELA does not connect to, create, or control wallets.' + REFUSAL_TAIL,
  state_change: 'ELA cannot deploy, stake, swap, mint, or otherwise change chain state; it only reads Diana testnet.' + REFUSAL_TAIL,
};
const RISKY = [...intentEvalSet, ...intentEvalSetEn, ...intentHeldoutSet].filter(item => item.gate || item.expect.startsWith('refuse:'));
const CONTEXT_NONE = 'Context: none';
const CONTEXT_BLOCK = 'Context: last successful latest block query · Diana testnet';
const CONTEXT_NETWORK = 'Context: last successful Diana network check · Diana testnet';
const BOTH = ['eth_chainId', 'eth_blockNumber'];

// --- Characterization ------------------------------------------------------------------------------

describe('live interface today (mocked RPC, real Chrome)', () => {
  let startError;
  before(async () => {
    if (SKIP) return;
    try {
      await startBrowser();
    } catch (error) {
      startError = error;
      await stopBrowser();
    }
  });
  after(stopBrowser);

  const uiTest = (name, fn, options = {}) => test(name, { skip: SKIP, timeout: 60_000, ...options }, async t => {
    if (startError) throw startError;
    return fn(t);
  });

  uiTest('initial page state', async t => {
    await openPage();
    expectView(t, await view(), { state: 'Ready', stateKey: 'ready', message: MSG.ready, block: '—', planVisible: false, context: CONTEXT_NONE, clearEnabled: false, runEnabled: true, rpc: [] });
    if (!PROBE) t.diagnostic(`chrome start: ${env.startMs} ms`);
  });

  // New in 7D: English-first copy with Turkish support, and the form's accessibility wiring.
  uiTest('English-first page: language, label, help text, placeholder, and example order', async t => {
    await openPage();
    const page = await evaluate(`(() => {
      const command = document.getElementById('command');
      const help = document.getElementById(command.getAttribute('aria-describedby'));
      const group = document.querySelector('.examples');
      return {
        lang: document.documentElement.lang,
        intro: document.querySelector('.intro-copy').textContent,
        labels: [...command.labels].map(label => label.textContent),
        textareaLang: command.getAttribute('lang'),
        required: command.required,
        placeholder: command.placeholder,
        help: help && help.textContent,
        groupRole: group.getAttribute('role'),
        groupLabel: group.getAttribute('aria-label'),
        examples: [...group.querySelectorAll('button')].map(button => [button.textContent, button.dataset.example, button.getAttribute('lang'), button.type]),
        buttonsWithoutName: [...document.querySelectorAll('button')].filter(button => !button.textContent.trim() && !button.getAttribute('aria-label')).length,
        status: [document.getElementById('query-message').getAttribute('role'), document.getElementById('context-status').getAttribute('aria-live')],
        icon: document.querySelector('link[rel="icon"]')?.getAttribute('href'),
        // Changed in 7F: the post-quantum panel is a separate card; the claim check covers the rest.
        text: (() => { const copy = document.body.cloneNode(true); copy.querySelector('#pqc-panel')?.remove(); return copy.textContent; })(),
      };
    })()`);
    if (PROBE) { t.diagnostic(JSON.stringify({ ...page, text: undefined })); return; }
    assert.equal(page.lang, 'en');
    assert.equal(page.intro, 'A read-only agent for the QoreChain Diana testnet. Ask in English or Turkish to check the network or read the latest block.');
    assert.deepEqual(page.labels, ['Command (English or Turkish)']);
    assert.equal(page.textareaLang, null, 'the field accepts both languages, so it has no lang of its own');
    assert.equal(page.required, true);
    assert.equal(page.placeholder, "What's the latest block?");
    assert.equal(page.help, 'ELA only reads Diana testnet: it checks the network and reads the latest block. It never sends funds, signs transactions, or handles keys.');
    assert.deepEqual([page.groupRole, page.groupLabel], ['group', 'Example commands']);
    assert.deepEqual(page.examples, [
      ["What's the latest block?", "What's the latest block?", null, 'button'],
      ['Check Diana network.', 'Check Diana network.', null, 'button'],
      ['Son blok kaç?', 'Son blok kaç?', 'tr', 'button'],
      ['Diana ağını kontrol et.', 'Diana ağını kontrol et.', 'tr', 'button'],
    ]);
    assert.equal(page.buttonsWithoutName, 0);
    assert.deepEqual(page.status, ['status', 'polite']);
    assert.equal(page.icon, 'data:,');
    // The page claims no capability ELA does not have.
    assert.doesNotMatch(page.text, /\bAI model\b|machine learning|post-quantum|PQC|ML-DSA|in Turkish\./i);
    assert.match(page.text, /Read-only/);
  });

  // New in 7D: blue identity. Colors come from central tokens; text keeps WCAG AA contrast, the
  // status colors keep their meaning, focus stays visible, and nothing overflows at 320 px.
  uiTest('blue theme: palette tokens, status colors, contrast, focus ring, and no overflow at 320 px', async t => {
    const measure = `(async () => {
      const css = getComputedStyle(document.documentElement);
      const token = name => css.getPropertyValue(name).trim().toLowerCase();
      const rgb = value => value.match(/[0-9.]+/g).slice(0, 3).map(Number);
      const lum = ([r, g, b]) => [r, g, b].map(c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
      const ratio = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p); return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100; };
      const style = selector => getComputedStyle(document.querySelector(selector));
      const badge = async text => {
        document.getElementById('command').value = text;
        document.getElementById('command-form').requestSubmit();
        await new Promise(resolve => setTimeout(resolve, 0));
        while (document.getElementById('run').disabled) await new Promise(resolve => setTimeout(resolve, 5));
        const s = style('#query-state');
        return [document.getElementById('query-state').textContent, s.color, s.backgroundColor, ratio(s.color, s.backgroundColor)];
      };
      const run = style('#run');
      const card = style('.result');
      const page = {
        tokens: ['--night', '--navy', '--sapphire', '--electric', '--ice', '--text'].map(token),
        bodyBackground: getComputedStyle(document.documentElement).backgroundColor,
        run: [run.backgroundColor, ratio(run.color, run.backgroundColor)],
        textOnCard: ratio(card.color, card.backgroundColor),
        mutedOnCard: ratio(style('.message').color, card.backgroundColor),
        linkOnCard: ratio(style('.example').color, getComputedStyle(document.querySelector('.command-panel')).backgroundImage.match(/rgb[^)]*\\)/)[0]),
        badges: [await badge('Send 10 QOR.'), await badge('What is the gas price?'), await badge('Merhaba')],
      };
      window.__rpc.mode = 'block_fails';
      page.badges.push(await badge('Check Diana network.'));
      window.__rpc.mode = 'http_500';
      page.badges.push(await badge("What's the latest block?"));
      window.__rpc.mode = 'ok';
      page.badges.push(await badge("What's the latest block?"));
      return page;
    })()`;
    await openPage();
    const desktop = await evaluate(measure);
    // Keyboard focus, as a user tabs: body → command field → first example button.
    await evaluate(`document.activeElement.blur(); window.scrollTo(0, 0)`);
    for (let press = 0; press < 2; press++) {
      for (const type of ['keyDown', 'keyUp']) await env.page.send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    }
    desktop.focus = await evaluate(`(() => {
      const element = document.activeElement;
      const style = getComputedStyle(element);
      return [element.textContent, element.matches(':focus-visible'), style.outlineStyle, style.outlineWidth, style.outlineColor];
    })()`);
    await env.page.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 760, deviceScaleFactor: 1, mobile: true });
    try {
      await openPage();
      await submit('Diana ağını kontrol et.');
      const narrow = await evaluate(`(() => {
        const width = document.documentElement.clientWidth;
        const outside = [...document.querySelectorAll('body *')].filter(element => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && (box.right > width + 0.5 || box.left < -0.5);
        }).map(element => element.tagName + '.' + element.className);
        return { width, scrollWidth: document.documentElement.scrollWidth, outside, run: Math.round(document.getElementById('run').getBoundingClientRect().width) };
      })()`);
      if (PROBE) { t.diagnostic(JSON.stringify({ desktop, narrow })); return; }
      assert.deepEqual(desktop.tokens, ['#080f20', '#102547', '#1d4680', '#2889e8', '#a6dcff', '#f0f7ff']);
      assert.equal(desktop.bodyBackground, 'rgb(8, 15, 32)');
      assert.equal(desktop.run[0], 'rgb(40, 137, 232)');
      for (const [name, value] of [['run button text', desktop.run[1]], ['text on card', desktop.textOnCard], ['muted text on card', desktop.mutedOnCard], ['example link', desktop.linkOnCard]]) {
        assert.ok(value >= 4.5, `${name}: ${value}`);
      }
      const red = ['rgb(255, 195, 205)', 'rgb(74, 29, 42)'];
      const amber = ['rgb(255, 224, 162)', 'rgb(70, 54, 26)'];
      const green = ['rgb(142, 240, 212)', 'rgb(14, 59, 52)'];
      assert.deepEqual(desktop.badges.map(([state, color, background]) => [state, color, background]), [
        ['Refused', ...red], ['Unsupported', ...amber], ['Needs clarification', ...amber], ['Partial', ...amber], ['Error', ...red], ['Success', ...green],
      ]);
      for (const [state, , , contrast] of desktop.badges) assert.ok(contrast >= 4.5, `${state}: ${contrast}`);
      assert.deepEqual(desktop.focus, ["What's the latest block?", true, 'solid', '2px', 'rgb(166, 220, 255)']);
      assert.equal(narrow.width, 320);
      assert.equal(narrow.scrollWidth, 320);
      assert.deepEqual(narrow.outside, []);
      assert.ok(narrow.run > 250, 'Run query spans the narrow card: ' + narrow.run);
    } finally {
      await env.page.send('Emulation.clearDeviceMetricsOverride');
    }
  });

  // --- New in 7F: post-quantum verification panel -------------------------------------------------

  const assetsSince = start => networkLog.slice(start).map(url => new URL(url)).filter(url => url.pathname.startsWith('/ela/assets/')).map(url => url.pathname.slice('/ela/assets/'.length));
  const openPanel = () => evaluate(`(async () => {
    document.getElementById('pqc-toggle').click();
    const started = Date.now();
    while (document.getElementById('pqc-body').dataset.ready !== 'true') {
      if (Date.now() - started > 10000) throw new Error('the verifier did not load');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    return true;
  })()`);
  const pqc = (action, fields = {}) => evaluate(`(() => {
    for (const [id, value] of Object.entries(${JSON.stringify(fields)})) document.getElementById(id).value = value;
    ${action ? `document.getElementById(${JSON.stringify(action)}).click();` : ''}
    const result = document.getElementById('pqc-result');
    return {
      state: result.dataset.state, reason: result.dataset.reason,
      title: document.getElementById('pqc-result-title').textContent,
      detail: document.getElementById('pqc-result-detail').textContent,
      meta: document.getElementById('pqc-result-meta').textContent,
      original: document.getElementById('pqc-cmp-original').textContent,
      changed: document.getElementById('pqc-cmp-changed').textContent,
      lastByte: document.getElementById('pqc-message').value.slice(-2),
    };
  })()`);

  uiTest('post-quantum panel: closed at first, its chunk is downloaded only when opened, and it closes and reopens', async t => {
    const start = networkLog.length;
    await openPage();
    const closed = await evaluate(`({ hidden: document.getElementById('pqc-body').hidden, expanded: document.getElementById('pqc-toggle').getAttribute('aria-expanded'), label: document.getElementById('pqc-toggle').textContent, controls: document.getElementById('pqc-toggle').getAttribute('aria-controls'), heading: document.getElementById('pqc-heading').textContent })`);
    const atLoad = assetsSince(start);
    const beforeOpen = networkLog.length;
    await openPanel();
    const opened = await evaluate(`({ hidden: document.getElementById('pqc-body').hidden, expanded: document.getElementById('pqc-toggle').getAttribute('aria-expanded'), label: document.getElementById('pqc-toggle').textContent, form: !document.getElementById('pqc-form').hidden, loading: !document.getElementById('pqc-loading').hidden })`);
    const onOpen = assetsSince(beforeOpen);
    await evaluate(`document.getElementById('pqc-toggle').click()`);
    const reclosed = await evaluate(`({ hidden: document.getElementById('pqc-body').hidden, expanded: document.getElementById('pqc-toggle').getAttribute('aria-expanded') })`);
    const beforeReopen = networkLog.length;
    await openPanel();
    const onReopen = assetsSince(beforeReopen);
    if (PROBE) { t.diagnostic(JSON.stringify({ closed, atLoad, opened, onOpen, reclosed, onReopen })); return; }
    assert.deepEqual(closed, { hidden: true, expanded: 'false', label: 'Open verifier', controls: 'pqc-body', heading: 'Post-Quantum Signature Verification' });
    assert.equal(atLoad.length, 2, atLoad.join(', '));
    assert.ok(atLoad.every(name => /^index-[\w-]+\.(js|css)$/.test(name)), 'no panel chunk before opening: ' + atLoad.join(', '));
    assert.deepEqual(opened, { hidden: false, expanded: 'true', label: 'Close verifier', form: true, loading: false });
    assert.equal(onOpen.length, 1, onOpen.join(', '));
    assert.match(onOpen[0], /^panel-[\w-]+\.js$/);
    assert.deepEqual(reclosed, { hidden: true, expanded: 'false' });
    assert.deepEqual(onReopen, [], 'the module is loaded once');
  });

  uiTest('post-quantum panel: valid vector accepted, one changed byte rejected, bad input refused, all in the browser', async t => {
    await openPage();
    await openPanel();
    await evaluate(`window.__rpc.calls.length = 0`);
    const start = networkLog.length;
    const steps = {
      valid: await pqc('pqc-load'),
      flipped: await pqc('pqc-flip'),
      badHex: await pqc('pqc-verify', { 'pqc-public-key': 'zz' }),
    };
    await pqc('pqc-load');
    steps.shortKey = await pqc('pqc-verify', { 'pqc-public-key': (await evaluate(`document.getElementById('pqc-public-key').value`)).slice(0, -2) });
    await pqc('pqc-load');
    steps.longSignature = await pqc('pqc-verify', { 'pqc-signature': (await evaluate(`document.getElementById('pqc-signature').value`)) + '00' });
    await pqc('pqc-load');
    steps.prefixed = await pqc('pqc-verify', { 'pqc-message': '0x' + (await evaluate(`document.getElementById('pqc-message').value`)) });
    await pqc('pqc-load');
    steps.oversized = await pqc('pqc-oversized');
    steps.missing = await pqc('pqc-verify', { 'pqc-public-key': '', 'pqc-signature': '' });
    steps.cleared = await pqc('pqc-clear');
    const traffic = { rpc: await evaluate(`window.__rpc.calls.length`), requests: networkLog.slice(start) };
    if (PROBE) { t.diagnostic(JSON.stringify({ steps, traffic })); return; }
    assert.deepEqual([steps.valid.state, steps.valid.title, steps.valid.original], ['valid', '✓ Valid signature', 'Valid']);
    assert.match(steps.valid.meta, /network requests during the check: 0$/);
    assert.deepEqual([steps.flipped.state, steps.flipped.reason, steps.flipped.changed, steps.flipped.lastByte], ['invalid', 'signature_mismatch', 'Not valid (signature_mismatch)', '31']);
    assert.equal(steps.flipped.detail, 'The signature does not match this public key and message.');
    assert.deepEqual([steps.badHex.state, steps.badHex.reason], ['invalid', 'invalid_encoding']);
    assert.deepEqual([steps.shortKey.state, steps.shortKey.reason], ['invalid', 'invalid_public_key_length']);
    assert.deepEqual([steps.longSignature.state, steps.longSignature.reason], ['invalid', 'invalid_signature_length']);
    assert.deepEqual([steps.prefixed.state, steps.prefixed.reason], ['invalid', 'invalid_encoding']);
    assert.deepEqual([steps.oversized.state, steps.oversized.reason], ['invalid', 'message_too_large']);
    assert.deepEqual([steps.missing.state, steps.missing.reason], ['invalid', 'missing_input']);
    assert.deepEqual([steps.cleared.state, steps.cleared.title], ['idle', 'No verification yet']);
    assert.equal(traffic.rpc, 0, 'no RPC call');
    assert.deepEqual(traffic.requests, [], 'no request of any kind while verifying');
    // The command form still works next to the panel.
    expectView(t, await submit("What's the latest block?"), { state: 'Success', rpc: BOTH, context: CONTEXT_BLOCK }, 'command after panel use');
  });

  uiTest('post-quantum panel at 320 px and with the keyboard', async t => {
    await env.page.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 760, deviceScaleFactor: 1, mobile: true });
    try {
      await openPage();
      await evaluate(`document.activeElement.blur(); window.scrollTo(0, 0)`);
      const press = async (key, code, keyCode, text) => {
        await env.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, ...(text ? { text } : {}) });
        await env.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode });
      };
      let focused = '';
      for (let i = 0; i < 30 && focused !== 'pqc-toggle'; i++) {
        await press('Tab', 'Tab', 9);
        focused = await evaluate(`document.activeElement.id`);
      }
      const toggleFocus = await evaluate(`(() => { const s = getComputedStyle(document.activeElement); return [document.activeElement.matches(':focus-visible'), s.outlineStyle, s.outlineWidth, s.outlineColor]; })()`);
      await press('Enter', 'Enter', 13, '\r');
      await evaluate(`(async () => { const t = Date.now(); while (document.getElementById('pqc-body').dataset.ready !== 'true') { if (Date.now() - t > 10000) throw new Error('not loaded'); await new Promise(r => setTimeout(r, 20)); } })()`);
      const expanded = await evaluate(`document.getElementById('pqc-toggle').getAttribute('aria-expanded')`);
      await press('Tab', 'Tab', 9);
      const next = await evaluate(`document.activeElement.id`);
      await pqc('pqc-load');
      await pqc('pqc-flip');
      const layout = await evaluate(`(() => {
        const width = document.documentElement.clientWidth;
        const outside = [...document.querySelectorAll('body *')].filter(element => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && (box.right > width + 0.5 || box.left < -0.5);
        }).map(element => element.tagName + '#' + element.id + '.' + element.className);
        const labels = ['pqc-public-key', 'pqc-message', 'pqc-signature'].map(id => document.getElementById(id).labels.length);
        return { width, scrollWidth: document.documentElement.scrollWidth, outside, labels };
      })()`);
      if (PROBE) { t.diagnostic(JSON.stringify({ focused, toggleFocus, expanded, next, layout })); return; }
      assert.equal(focused, 'pqc-toggle', 'the toggle is reachable with Tab');
      assert.deepEqual(toggleFocus, [true, 'solid', '2px', 'rgb(166, 220, 255)']);
      assert.equal(expanded, 'true', 'Enter opens the panel');
      assert.equal(next, 'pqc-public-key', 'Tab moves into the opened panel');
      assert.deepEqual(layout, { width: 320, scrollWidth: 320, outside: [], labels: [1, 1, 1] });
    } finally {
      await env.page.send('Emulation.clearDeviceMetricsOverride');
    }
  });

  uiTest('build budget: main JS stays small; PQC code ships only in the lazily loaded panel chunk', async t => {
    const assets = readdirSync(join(env.outDir, 'assets'));
    const html = readFileSync(join(env.outDir, 'index.html'), 'utf8');
    const main = html.match(/assets\/(index-[\w-]+\.js)/)[1];
    const scripts = assets.filter(name => name.endsWith('.js'));
    const sizes = Object.fromEntries(scripts.map(name => { const bytes = readFileSync(join(env.outDir, 'assets', name)); return [name, { bytes: bytes.length, gzip: gzipSync(bytes).length }]; }));
    const panel = scripts.find(name => name.startsWith('panel-'));
    const mainCode = readFileSync(join(env.outDir, 'assets', main), 'utf8');
    const panelCode = panel ? readFileSync(join(env.outDir, 'assets', panel), 'utf8') : '';
    for (const [name, size] of Object.entries(sizes)) t.diagnostic(`${name}: ${size.bytes} bytes, gzip ${size.gzip} bytes`);
    if (PROBE) return;
    assert.equal(scripts.length, 2, scripts.join(', '));
    assert.ok(panel, 'a separate panel chunk');
    assert.ok(sizes[main].gzip <= 13 * 1024, `main JS gzip ${sizes[main].gzip} bytes exceeds the 13 KiB budget`);
    assert.ok(sizes[main].bytes <= 36 * 1024, `main JS ${sizes[main].bytes} bytes exceeds the 36 KiB budget`);
    assert.equal(/modulepreload|panel-/.test(html), false, 'index.html does not preload the panel');
    const vectorStart = 'f96bc953da4e941be8354a22';
    assert.equal(mainCode.includes(vectorStart), false, 'the test vector is not in the main chunk');
    assert.ok(panelCode.includes(vectorStart), 'the test vector ships with the panel');
    for (const marker of ['@qorechain/sdk', 'cosmjs', 'viem', 'postJsonRpc']) assert.equal(mainCode.includes(marker) || panelCode.includes(marker), false, marker);
    assert.ok(panelCode.length > 30 * 1024, 'the verifier lives in the panel chunk');
  });

  uiTest('each example button fills the field without submitting, and the example then runs', async t => {
    for (const [example, query] of [["What's the latest block?", 'block'], ['Check Diana network.', 'network'], ['Son blok kaç?', 'block'], ['Diana ağını kontrol et.', 'network']]) {
      await openPage();
      await evaluate(`window.__rpc.calls.length = 0`);
      const filled = await evaluate(`(() => {
        document.querySelector('button[data-example=' + JSON.stringify(${JSON.stringify(example)}) + ']').click();
        return { value: document.getElementById('command').value, focused: document.activeElement.id, state: document.getElementById('query-state').textContent, calls: window.__rpc.calls.length };
      })()`);
      if (!PROBE) assert.deepEqual(filled, { value: example, focused: 'command', state: 'Ready', calls: 0 }, example);
      expectView(t, await submit(example), { state: 'Success', rpc: BOTH, context: query === 'block' ? CONTEXT_BLOCK : CONTEXT_NETWORK, planVisible: query === 'network' }, example);
    }
  });

  uiTest('Turkish latest-block command runs eth_chainId then eth_blockNumber and records context', async t => {
    await openPage();
    expectView(t, await submit('QoreChain son blok numarasını öğren.'), {
      state: 'Success', message: MSG.blockSuccess, block: '9954992', chain: 'qorechain-diana', evmChain: '9800',
      planVisible: false, context: CONTEXT_BLOCK, clearEnabled: true, rpc: BOTH,
    });
  });

  uiTest('Diana network check shows the two-step plan and records context', async t => {
    await openPage();
    const observed = await submit('Diana ağını kontrol et.');
    expectView(t, observed, {
      state: 'Success', block: '9954992', chain: 'qorechain-diana', evmChain: '9800', planVisible: true,
      planTarget: 'Target: Diana testnet · EVM chain 9800',
      steps: [['succeeded', 'eth_chainId'], ['succeeded', 'eth_blockNumber']], context: CONTEXT_NETWORK, rpc: BOTH,
    });
    if (!PROBE) assert.match(observed.message, /chain ID 9800 verified, latest block 9954992/);
  });

  uiTest('every read sends exactly the two allowed methods, POST, without credentials or redirects', async t => {
    await openPage();
    await submit('Diana ağını kontrol et.');
    const calls = await evaluate('window.__rpc.calls');
    if (PROBE) { t.diagnostic(JSON.stringify(calls)); return; }
    assert.deepEqual(calls.map(call => [call.method, call.httpMethod, call.credentials, call.redirect]), [
      ['eth_chainId', 'POST', 'omit', 'error'],
      ['eth_blockNumber', 'POST', 'omit', 'error'],
    ]);
    assert.ok(calls.every(call => call.url === 'https://evm-testnet.qore.host/'));
  });

  uiTest('recognized Turkish variants', async t => {
    for (const [command, expected] of [
      ['Son blok numarası kaç?', 'block'], ['son blok numarasını göster', 'block'], ['Testnette son blok numarasını öğren.', 'block'],
      ['DIANA AĞINI KONTROL ET', 'network'], ['diana ağını kontrol et', 'network'], ['QoreChain Diana test ağını kontrol et.', 'network'],
      ['Son blok numarasını öğren, transfer yapma.', 'block'],
    ]) {
      await openPage();
      const observed = await submit(command);
      expectView(t, observed, { state: 'Success', rpc: BOTH, context: expected === 'block' ? CONTEXT_BLOCK : CONTEXT_NETWORK, planVisible: expected === 'network' }, command);
    }
  });

  uiTest('Turkish follow-ups re-read fresh data after a successful query', async t => {
    await openPage();
    await submit('Diana ağını kontrol et.');
    await evaluate(`window.__rpc.height = '0x97e6b5'`);
    const current = await submit('Peki şimdi kaç oldu?');
    expectView(t, current, {
      state: 'Success', block: '9954997', planVisible: false, rpc: BOTH, context: CONTEXT_BLOCK,
      message: 'Follow-up to your last successful Diana network check; fresh data requested. ' + MSG.blockSuccess,
    }, 'kaç oldu after network check');
    const repeat = await submit('Tekrar kontrol et.');
    expectView(t, repeat, {
      state: 'Success', planVisible: false, rpc: BOTH, context: CONTEXT_BLOCK,
      message: 'Follow-up to your last successful latest block query; fresh data requested. ' + MSG.blockSuccess,
    }, 'tekrar after block query');
    await submit('Diana ağını kontrol et.');
    expectView(t, await submit('Bir daha kontrol et'), { state: 'Success', planVisible: true, rpc: BOTH, context: CONTEXT_NETWORK }, 'bir daha after network check');
  });

  uiTest('follow-ups without context ask for clarification and send nothing', async t => {
    for (const command of ['Peki şimdi kaç oldu?', 'Tekrar kontrol et.', 'şimdi kaç']) {
      await openPage();
      expectView(t, await submit(command), { state: 'Needs clarification', message: MSG.clarifyNoContext, context: CONTEXT_NONE, rpc: [] }, command);
    }
  });

  uiTest('Clear context removes the context; the next follow-up needs clarification', async t => {
    await openPage();
    await submit('QoreChain son blok numarasını öğren.');
    await evaluate(`document.getElementById('clear-context').click()`);
    expectView(t, await view(), { context: CONTEXT_NONE, clearEnabled: false }, 'after clear');
    expectView(t, await submit('Tekrar kontrol et.'), { state: 'Needs clarification', message: MSG.clarifyNoContext, rpc: [] }, 'follow-up after clear');
  });

  // Changed in 7C: before, every English command got the generic clarification and sent nothing.
  uiTest('English network and block commands run and record context', async t => {
    for (const [command, expected] of [
      ['Check Diana network.', 'network'], ['Is QoreChain testnet working?', 'network'],
      ["What's the latest block?", 'block'], ['Show me the current block height.', 'block'],
    ]) {
      await openPage();
      expectView(t, await submit(command), {
        state: 'Success', block: '9954992', rpc: BOTH, planVisible: expected === 'network',
        context: expected === 'block' ? CONTEXT_BLOCK : CONTEXT_NETWORK,
        ...(expected === 'block' ? { message: MSG.blockSuccess } : {}),
      }, command);
    }
  });

  // Changed in 7C: English follow-ups were not recognized, even with a context.
  uiTest('English follow-ups use the session context and read fresh data; without context they need clarification', async t => {
    for (const command of ['Check again.', 'What about now?']) {
      await openPage();
      expectView(t, await submit(command), { state: 'Needs clarification', message: MSG.clarifyNoContext, context: CONTEXT_NONE, rpc: [] }, command + ' without context');
    }
    await openPage();
    await submit('Check Diana network.');
    await evaluate(`window.__rpc.height = '0x97e6b1'`);
    expectView(t, await submit('Check again.'), {
      state: 'Success', block: '9954993', planVisible: true, rpc: BOTH, context: CONTEXT_NETWORK,
    }, 'Check again. after network check');
    await evaluate(`window.__rpc.height = '0x97e6b2'`);
    expectView(t, await submit('What about now?'), {
      state: 'Success', block: '9954994', planVisible: false, rpc: BOTH, context: CONTEXT_BLOCK,
      message: 'Follow-up to your last successful Diana network check; fresh data requested. ' + MSG.blockSuccess,
    }, 'What about now? after network check');
  });

  // Changed in 7C: risky commands got the generic clarification; now the safety gate refuses them
  // with a reason. Unsupported reads have their own message; unknown commands keep the generic one.
  uiTest('risky commands are refused with a reason; unsupported and unknown commands are explained; nothing is sent', async t => {
    for (const [command, state, message] of [
      ['10 QOR gönder.', 'Refused', REFUSED.transfer],
      ['Send 10 QOR.', 'Refused', REFUSED.transfer],
      ['Transfer my tokens.', 'Refused', REFUSED.transfer],
      ['10 QOR transferi için işlem taslağı hazırla.', 'Refused', REFUSED.transfer],
      ['Diana ağını kontrol et ve 10 QOR gönder.', 'Refused', REFUSED.transfer],
      ['Sign this transaction.', 'Refused', REFUSED.signing],
      ['Show my private key.', 'Refused', REFUSED.key_material],
      ['Connect my wallet.', 'Refused', REFUSED.wallet_control],
      ['Deploy this contract.', 'Refused', REFUSED.state_change],
      ['Bakiyeyi göster.', 'Unsupported', MSG.unsupported],
      ['What is the gas price?', 'Unsupported', MSG.unsupported],
      ['Son blok numarasını öğren ve bakiyeyi göster.', 'Unsupported', MSG.unsupported],
      ['Diana kimdir?', 'Needs clarification', MSG.clarifyGeneric],
      ['Who is Diana?', 'Needs clarification', MSG.clarifyGeneric],
      ['Merhaba', 'Needs clarification', MSG.clarifyGeneric],
    ]) {
      await openPage();
      expectView(t, await submit(command), { state, message, context: CONTEXT_NONE, rpc: [] }, command);
    }
  });

  uiTest('all 107 risky evaluation sentences are refused in the interface without any RPC request', async t => {
    if (!PROBE) assert.equal(RISKY.length, 107);
    await openPage();
    await evaluate(`window.__rpc.calls.length = 0`);
    const outcomes = await evaluate(`(async () => {
      const results = [];
      for (const text of ${JSON.stringify(RISKY.map(item => item.text))}) {
        document.getElementById('command').value = text;
        document.getElementById('command-form').requestSubmit();
        await new Promise(resolve => setTimeout(resolve, 0));
        while (document.getElementById('run').disabled) await new Promise(resolve => setTimeout(resolve, 5));
        results.push([text, document.getElementById('query-state').textContent]);
      }
      return { results, calls: window.__rpc.calls.length, context: document.getElementById('context-status').textContent };
    })()`);
    if (PROBE) { t.diagnostic(JSON.stringify(outcomes.results.filter(([, state]) => state !== 'Refused'))); return; }
    assert.deepEqual(outcomes.results.filter(([, state]) => state !== 'Refused'), []);
    assert.equal(outcomes.calls, 0);
    assert.equal(outcomes.context, CONTEXT_NONE);
  });

  // Added in 7G-S: the five gate misses found in 7G and the hardening set (tests/safety-gate-set.mjs).
  uiTest('forbidden actions after a safe query, role play, or a fake grant are refused; negated mentions are not', async t => {
    await openPage();
    await submit('Diana ağını kontrol et.');
    await evaluate(`window.__rpc.calls.length = 0`);
    const run = texts => evaluate(`(async () => {
      const results = [];
      for (const text of ${JSON.stringify(texts)}) {
        document.getElementById('command').value = text;
        document.getElementById('command-form').requestSubmit();
        await new Promise(resolve => setTimeout(resolve, 0));
        while (document.getElementById('run').disabled) await new Promise(resolve => setTimeout(resolve, 5));
        results.push([text, document.getElementById('query-state').textContent]);
      }
      return { results, calls: window.__rpc.calls.map(call => call.method), context: document.getElementById('context-status').textContent };
    })()`);
    const attacks = await run(gateAttacks.map(item => item.text));
    const safe = await run(gateSafe.map(item => item.text));
    if (PROBE) { t.diagnostic(JSON.stringify({ attacks: attacks.results.filter(([, s]) => s !== 'Refused'), safe: safe.results.filter(([, s]) => s === 'Refused') })); return; }
    assert.deepEqual(attacks.results.slice(0, 5).map(([text]) => text), [...GATE_LEAKS_7G]);
    assert.deepEqual(attacks.results.filter(([, state]) => state !== 'Refused'), []);
    assert.deepEqual(attacks.calls, []);
    assert.equal(attacks.context, CONTEXT_NETWORK);
    assert.deepEqual(safe.results.filter(([, state]) => state === 'Refused'), []);
    assert.ok(safe.calls.every(method => method === 'eth_chainId' || method === 'eth_blockNumber'), safe.calls.join());
  });

  uiTest('a refused key-material command is cleared from the command field; other commands stay', async t => {
    await openPage();
    const keyRefusal = await submit('Show my private key.');
    const afterKey = await evaluate(`document.getElementById('command').value`);
    await submit('Send 10 QOR.');
    const afterTransfer = await evaluate(`document.getElementById('command').value`);
    if (PROBE) { t.diagnostic(JSON.stringify({ afterKey, afterTransfer, keyRefusal: keyRefusal.state })); return; }
    assert.equal(keyRefusal.state, 'Refused');
    assert.equal(afterKey, '');
    assert.equal(afterTransfer, 'Send 10 QOR.');
  });

  // Changed in 7C: the state was "Needs clarification" with the generic text; now "Refused".
  uiTest('risky commands keep an existing context and send no request', async t => {
    await openPage();
    await submit('Diana ağını kontrol et.');
    for (const command of ['10 QOR gönder.', 'Show my private key.']) {
      expectView(t, await submit(command), { state: 'Refused', context: CONTEXT_NETWORK, rpc: [] }, command);
    }
  });

  // Changed in 7C: mainnet got "This interface queries Diana testnet. Please ask for the testnet
  // block number." and Ethereum or "Diana mainnet" got the generic clarification; all now get one
  // network message.
  uiTest('other-network requests get the Diana-only clarification and send no request', async t => {
    for (const command of ['Mainnet son blok numarasını öğren.', 'Ana ağda son blok numarasını öğren.', 'Mainnette son blok numarası kaç?', 'Ethereum son blok numarasını öğren.', 'Diana mainnet ağını kontrol et.', 'Is mainnet working?']) {
      await openPage();
      expectView(t, await submit(command), { state: 'Needs clarification', message: MSG.clarifyNetwork, rpc: [] }, command);
    }
  });

  // Changed in 7C: a spaces-only command got the generic clarification; now it asks for a command.
  uiTest('an empty command is blocked by the form; a spaces-only command asks for a command', async t => {
    await openPage();
    expectView(t, await submit(''), { state: 'Ready', message: MSG.ready, rpc: [] }, 'empty');
    // The form's `required` check accepts whitespace, so this reaches the session.
    expectView(t, await submit('   '), { state: 'Needs clarification', message: MSG.clarifyEmpty, rpc: [] }, 'spaces');
  });

  uiTest('RPC failures on the latest-block query: error shown, no block, context unchanged', async t => {
    await openPage();
    await submit('Diana ağını kontrol et.');
    for (const [mode, message, rpc] of [
      ['wrong_chain', 'EVM JSON-RPC did not report the Diana testnet chain ID (9800).', ['eth_chainId']],
      ['http_500', 'QoreChain endpoint returned HTTP 500.', ['eth_chainId']],
      ['bad_json', 'QoreChain endpoint returned an unreadable JSON body.', ['eth_chainId']],
      ['network_error', MSG.networkError, ['eth_chainId']],
      ['block_fails', 'QoreChain endpoint returned HTTP 503.', BOTH],
    ]) {
      await setMode(mode);
      expectView(t, await submit('QoreChain son blok numarasını öğren.'), { state: 'Error', message, block: '—', chain: '—', context: CONTEXT_NETWORK, rpc }, mode);
    }
  });

  uiTest('network check failures: failed or partial plan, context unchanged', async t => {
    await openPage();
    await submit('QoreChain son blok numarasını öğren.');
    await setMode('wrong_chain');
    const wrong = await submit('Diana ağını kontrol et.');
    expectView(t, wrong, {
      state: 'Error', message: 'The endpoint did not identify as Diana testnet, so no block height was read.', block: '—',
      steps: [['failed', 'eth_chainId'], ['skipped', 'eth_blockNumber']], context: CONTEXT_BLOCK, rpc: ['eth_chainId'],
    }, 'wrong chain');
    await setMode('block_fails');
    const partial = await submit('Diana ağını kontrol et.');
    expectView(t, partial, { state: 'Partial', block: '—', steps: [['succeeded', 'eth_chainId'], ['failed', 'eth_blockNumber']], context: CONTEXT_BLOCK, rpc: BOTH }, 'partial');
    if (!PROBE) assert.equal(partial.message, 'Chain ID 9800 was verified, but reading the latest block failed: QoreChain endpoint returned HTTP 503. No block height is reported.');
    // A failed query does not create a context in a fresh session either. Unlike the latest-block
    // query, the network check shows the reader's message here, without the CORS hint.
    await openPage('network_error');
    expectView(t, await submit('Diana ağını kontrol et.'), {
      state: 'Error', message: 'The Diana testnet check could not be completed: Could not reach the QoreChain endpoint.',
      steps: [['failed', 'eth_chainId'], ['skipped', 'eth_blockNumber']], context: CONTEXT_NONE, clearEnabled: false, rpc: ['eth_chainId'],
    }, 'fresh session failure');
  });

  uiTest('a stalled endpoint times out after the 8 s default, and the form ignores a second submit meanwhile', async t => {
    await openPage('stall');
    await evaluate(`window.__rpc.calls.length = 0`);
    const during = await evaluate(`(async () => {
      document.getElementById('command').value = 'QoreChain son blok numarasını öğren.';
      document.getElementById('command-form').requestSubmit();
      await new Promise(resolve => setTimeout(resolve, 50));
      document.getElementById('command-form').requestSubmit();
      await new Promise(resolve => setTimeout(resolve, 50));
      return ${READ_VIEW};
    })()`);
    // Changed in 7C: the message while querying was "Reading the latest block from Diana testnet…";
    // the session decides and runs in one step, so the interface now shows a neutral message.
    expectView(t, during, { state: 'Querying', message: 'Working on your command…', runEnabled: false, rpc: ['eth_chainId'] }, 'while querying');
    const started = Date.now();
    const settled = await evaluate(`(async () => {
      while (document.getElementById('run').disabled) await new Promise(resolve => setTimeout(resolve, 50));
      return ${READ_VIEW};
    })()`);
    const elapsed = Date.now() - started;
    expectView(t, settled, { state: 'Error', message: 'QoreChain request timed out.', block: '—', context: CONTEXT_NONE, runEnabled: true, rpc: ['eth_chainId'] }, 'after timeout');
    if (!PROBE) assert.ok(elapsed > 6_000 && elapsed < 12_000, 'about 8 s: ' + elapsed);
  }, { timeout: 60_000 });

  // Changed in 7D: index.html declared no icon, so Chrome requested /favicon.ico and logged a 404.
  // It now declares an empty data URI icon: no favicon request and a clean console.
  uiTest('no request reached any qore.host endpoint, no favicon was requested, and the console stayed clean', async t => {
    const live = networkLog.filter(url => /qore\.host/.test(url));
    if (PROBE) { t.diagnostic(JSON.stringify({ live, problems, favicon: networkLog.filter(url => /favicon/.test(url)) })); return; }
    assert.deepEqual(live, []);
    assert.deepEqual(networkLog.filter(url => /favicon/.test(url)), []);
    assert.deepEqual(problems, []);
  });
});
