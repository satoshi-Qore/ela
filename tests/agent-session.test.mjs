// Tests for the agent session layer (src/agent/session.ts): one entry point that composes the
// intent pipeline (safety gate first), the read-only tool registry, and the conversation context.
// All RPC traffic goes to a scripted fake fetch; nothing reaches the network.
//
// Run: node --test tests/agent-session.test.mjs

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createSession } from '../src/agent/session.ts';
import * as sessionModule from '../src/agent/session.ts';
import { ruleClassifier } from '../src/agent/lexicon.ts';
import { DIANA_NETWORK } from '../src/agent/registry.ts';
import { intentEvalSet } from './intent-eval-set.mjs';
import { intentEvalSetEn } from './intent-eval-set-en.mjs';
import { intentHeldoutSet } from './intent-heldout-set.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const ENDPOINT = 'https://evm-testnet.qore.host/';
const BOTH = ['eth_chainId', 'eth_blockNumber'];
const NETWORK_CONTEXT = { kind: 'network_check', network: DIANA_NETWORK };
const BLOCK_CONTEXT = { kind: 'block_number', network: DIANA_NETWORK };

/** Scripted EVM JSON-RPC. `mode` and `height` can change between commands. */
function fakeRpc(mode = 'ok') {
  const rpc = {
    mode,
    height: '0x97e6b0',
    requests: [],
    get methods() { return this.requests.map(request => request.method); },
    reset() { this.requests.length = 0; },
  };
  rpc.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    rpc.requests.push({ url: url instanceof URL ? url.href : String(url), httpMethod: init.method, credentials: init.credentials, redirect: init.redirect, method: body.method });
    const ok = result => Response.json({ jsonrpc: '2.0', id: body.id, result });
    const isChain = body.method === 'eth_chainId';
    switch (rpc.mode) {
      case 'wrong_chain': return ok(isChain ? '0x1' : rpc.height);
      case 'http_500': return new Response('upstream detail', { status: 500 });
      case 'network_error': throw new TypeError('Failed to fetch');
      case 'block_fails': return isChain ? ok('0x2648') : new Response(null, { status: 503 });
      case 'stall': return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
      default: return ok(isChain ? '0x2648' : rpc.height);
    }
  };
  return rpc;
}

/** Rule-based classifier with a call log (what a model would receive). */
function spyClassifier(inner = ruleClassifier) {
  const calls = [];
  return { calls, classify: (...args) => { calls.push(args); return inner.classify(...args); } };
}

function newSession(mode = 'ok', extra = {}) {
  const rpc = fakeRpc(mode);
  const classifier = extra.classifier ?? spyClassifier();
  const session = createSession({ fetch: rpc.fetch, classifier, ...extra });
  return { rpc, classifier, session };
}

const blockOf = result => result.query === 'network_check' ? result.run.result.data?.blockNumber : result.run.result.data?.blockNumber;
const errorCodeOf = result => result.query === 'network_check' ? result.run.result.error?.code : result.run.result.error?.code;

// --- Safety ------------------------------------------------------------------------------------------

const riskySentences = [...intentEvalSet, ...intentEvalSetEn, ...intentHeldoutSet].filter(item => item.gate || item.expect.startsWith('refuse:'));

test('all 107 risky evaluation sentences are refused with zero classifier calls and zero RPC requests', async () => {
  assert.equal(riskySentences.length, 107);
  for (const item of riskySentences) {
    const { rpc, classifier, session } = newSession();
    const result = await session.handleCommand(item.text);
    assert.equal(result.kind, 'refused', item.text);
    assert.equal(result.decision.source, 'safety_gate', item.text);
    assert.equal(classifier.calls.length, 0, item.text);
    assert.deepEqual(rpc.requests, [], item.text);
    assert.equal(session.context, undefined, item.text);
  }
});

test('risky commands are refused the same way when a context exists, and the context is kept', async () => {
  const { rpc, classifier, session } = newSession();
  await session.handleCommand('Diana ağını kontrol et.');
  rpc.reset();
  classifier.calls.length = 0;
  for (const item of riskySentences) {
    const result = await session.handleCommand(item.text);
    assert.equal(result.kind, 'refused', item.text);
    assert.deepEqual(result.context, NETWORK_CONTEXT, item.text);
  }
  assert.deepEqual(rpc.requests, []);
  assert.equal(classifier.calls.length, 0);
  assert.deepEqual(session.context, NETWORK_CONTEXT);
});

test('a model that would answer "run" for anything never sees refused commands and cannot send other methods', async () => {
  const always = { calls: [], classify(text) { this.calls.push(text); return [{ label: 'block_number', score: 1 }]; } };
  const rpc = fakeRpc();
  const session = createSession({ fetch: rpc.fetch, classifier: always });
  for (const text of ['10 QOR gönder.', 'Send 10 QOR.', 'Show my private key.', 'Sign this transaction.', 'Connect my wallet.', 'Deploy this contract.']) {
    assert.equal((await session.handleCommand(text)).kind, 'refused', text);
  }
  assert.deepEqual(always.calls, []);
  assert.deepEqual(rpc.requests, []);
  // For a command the gate allows, the model can only pick a read query: still the two allowed methods.
  const result = await session.handleCommand('Tell me something.');
  assert.equal(result.kind, 'answered');
  assert.deepEqual(rpc.methods, BOTH);
  assert.deepEqual(always.calls, ['tell me something.']);
});

test('every request uses only eth_chainId and eth_blockNumber, POST to the Diana EVM endpoint, without credentials or redirects', async () => {
  const { rpc, session } = newSession();
  for (const command of ['Diana ağını kontrol et.', 'Check Diana network.', "What's the latest block?", 'Check again.', 'Peki şimdi kaç oldu?']) {
    await session.handleCommand(command);
  }
  assert.ok(rpc.requests.length >= 10);
  for (const request of rpc.requests) {
    assert.ok(BOTH.includes(request.method), request.method);
    assert.deepEqual({ url: request.url, httpMethod: request.httpMethod, credentials: request.credentials, redirect: request.redirect }, { url: ENDPOINT, httpMethod: 'POST', credentials: 'omit', redirect: 'error' });
  }
});

// --- Queries -------------------------------------------------------------------------------------------

for (const command of ['Diana ağını kontrol et.', 'diana agini kontrol et', 'QoreChain testnet çalışıyor mu?', 'Check Diana network.', 'Is QoreChain testnet working?', 'Ping the Diana testnet.']) {
  test('network check: ' + JSON.stringify(command), async () => {
    const { rpc, session } = newSession();
    const result = await session.handleCommand(command);
    assert.deepEqual({ kind: result.kind, query: result.query, outcome: result.outcome }, { kind: 'answered', query: 'network_check', outcome: 'success' });
    assert.equal(result.run.result.status, 'success');
    assert.deepEqual(result.run.result.steps.map(step => [step.rpcMethod, step.status]), [['eth_chainId', 'succeeded'], ['eth_blockNumber', 'succeeded']]);
    assert.equal(blockOf(result), '9954992');
    assert.deepEqual(rpc.methods, BOTH);
    assert.deepEqual(session.context, NETWORK_CONTEXT);
    assert.deepEqual(result.context, NETWORK_CONTEXT);
  });
}

for (const command of ['QoreChain son blok numarasını öğren.', 'Son blok kaç?', 'Son blok numarasını söyler misin?', "What's the latest block?", 'Show me the current block height.', 'Latest block number?']) {
  test('latest block: ' + JSON.stringify(command), async () => {
    const { rpc, session } = newSession();
    const result = await session.handleCommand(command);
    assert.deepEqual({ kind: result.kind, query: result.query, outcome: result.outcome }, { kind: 'answered', query: 'block_number', outcome: 'success' });
    assert.deepEqual(result.run.result.data, { chainId: 'qorechain-diana', evmChainId: '9800', blockNumber: '9954992' });
    assert.deepEqual(rpc.methods, BOTH);
    assert.deepEqual(session.context, BLOCK_CONTEXT);
  });
}

// --- Follow-ups and context ------------------------------------------------------------------------------

test('Turkish and English follow-ups reuse the last successful query kind and always read fresh data', async () => {
  const { rpc, session } = newSession();
  await session.handleCommand('Diana ağını kontrol et.');
  const steps = [
    ['Peki şimdi kaç oldu?', '0x97e6b1', 'block_number', '9954993', BLOCK_CONTEXT],
    ['Tekrar kontrol et.', '0x97e6b2', 'block_number', '9954994', BLOCK_CONTEXT],
    ['Check Diana network.', '0x97e6b3', 'network_check', '9954995', NETWORK_CONTEXT],
    ['Check again.', '0x97e6b4', 'network_check', '9954996', NETWORK_CONTEXT],
    ['Bir daha kontrol eder misin?', '0x97e6b5', 'network_check', '9954997', NETWORK_CONTEXT],
    ['What about now?', '0x97e6b6', 'block_number', '9954998', BLOCK_CONTEXT],
    ['Is it still up?', '0x97e6b7', 'block_number', '9954999', BLOCK_CONTEXT],
  ];
  for (const [command, height, query, block, context] of steps) {
    rpc.height = height;
    rpc.reset();
    const result = await session.handleCommand(command);
    assert.deepEqual({ kind: result.kind, query: result.query, outcome: result.outcome }, { kind: 'answered', query, outcome: 'success' }, command);
    assert.equal(blockOf(result), block, command + ': a new height, never the remembered one');
    assert.deepEqual(rpc.methods, BOTH, command);
    assert.deepEqual(session.context, context, command);
  }
  // The context holds only the kind and the network: no height to reuse.
  assert.deepEqual(Object.keys(session.context).sort(), ['kind', 'network']);
});

test('follow-up decisions name the earlier query they build on', async () => {
  const { session } = newSession();
  await session.handleCommand('QoreChain son blok numarasını öğren.');
  const repeat = await session.handleCommand('Tekrar kontrol et.');
  assert.deepEqual({ intent: repeat.decision.intent, basedOn: repeat.decision.basedOn, source: repeat.decision.source }, { intent: 'follow_up_repeat', basedOn: 'block_number', source: 'deterministic' });
  const english = await session.handleCommand('Check again.');
  assert.deepEqual({ intent: english.decision.intent, basedOn: english.decision.basedOn, source: english.decision.source }, { intent: 'follow_up_repeat', basedOn: 'block_number', source: 'classifier' });
});

test('follow-ups without context ask for clarification and send nothing', async () => {
  for (const command of ['Peki şimdi kaç oldu?', 'Tekrar kontrol et.', 'Bir daha kontrol eder misin?', 'Check again.', 'What about now?', 'Is it still up?']) {
    const { rpc, session } = newSession();
    const result = await session.handleCommand(command);
    assert.deepEqual({ kind: result.kind, reason: result.reason }, { kind: 'clarify', reason: 'no_context' }, command);
    assert.deepEqual(rpc.requests, [], command);
    assert.equal(session.context, undefined, command);
  }
});

test('clear() forgets the context; the next follow-up needs clarification', async () => {
  const { rpc, session } = newSession();
  await session.handleCommand('Check Diana network.');
  session.clear();
  assert.equal(session.context, undefined);
  rpc.reset();
  assert.deepEqual((await session.handleCommand('Check again.')).reason, 'no_context');
  assert.deepEqual(rpc.requests, []);
});

test('each session has its own context', async () => {
  const first = newSession();
  const second = newSession();
  await first.session.handleCommand('Check Diana network.');
  assert.deepEqual(first.session.context, NETWORK_CONTEXT);
  assert.equal(second.session.context, undefined);
  assert.equal((await second.session.handleCommand('Check again.')).reason, 'no_context');
});

// --- Failures ------------------------------------------------------------------------------------------------

for (const [mode, code, methods] of [
  ['wrong_chain', 'chain_mismatch', ['eth_chainId']],
  ['http_500', 'http_error', ['eth_chainId']],
  ['network_error', 'network_error', ['eth_chainId']],
  ['block_fails', 'http_error', BOTH],
]) {
  test(`latest block with ${mode}: failed outcome (${code}), the earlier context is kept`, async () => {
    const { rpc, session } = newSession();
    await session.handleCommand('Diana ağını kontrol et.');
    rpc.mode = mode;
    rpc.reset();
    const result = await session.handleCommand('Son blok kaç?');
    assert.deepEqual({ kind: result.kind, query: result.query, outcome: result.outcome }, { kind: 'answered', query: 'block_number', outcome: 'failed' });
    assert.equal(errorCodeOf(result), code);
    assert.equal(result.run.result.ok, false);
    assert.deepEqual(rpc.methods, methods);
    assert.deepEqual(session.context, NETWORK_CONTEXT);
  });
}

test('network check with a wrong chain fails before the block request and keeps the earlier context', async () => {
  const { rpc, session } = newSession();
  await session.handleCommand("What's the latest block?");
  rpc.mode = 'wrong_chain';
  rpc.reset();
  const result = await session.handleCommand('Check Diana network.');
  assert.deepEqual({ kind: result.kind, outcome: result.outcome }, { kind: 'answered', outcome: 'failed' });
  assert.deepEqual(result.run.result.steps.map(step => step.status), ['failed', 'skipped']);
  assert.equal(errorCodeOf(result), 'chain_mismatch');
  assert.deepEqual(rpc.methods, ['eth_chainId']);
  assert.deepEqual(session.context, BLOCK_CONTEXT);
});

test('a partial network check does not replace the context', async () => {
  const { rpc, session } = newSession();
  await session.handleCommand('Son blok kaç?');
  rpc.mode = 'block_fails';
  const result = await session.handleCommand('Diana ağını kontrol et.');
  assert.deepEqual({ kind: result.kind, outcome: result.outcome }, { kind: 'answered', outcome: 'partial' });
  assert.deepEqual(session.context, BLOCK_CONTEXT);
});

test('a failed query in a fresh session creates no context', async () => {
  const { session } = newSession('network_error');
  const result = await session.handleCommand('Check Diana network.');
  assert.equal(result.outcome, 'failed');
  assert.equal(session.context, undefined);
  assert.equal((await session.handleCommand('Check again.')).reason, 'no_context');
});

test('a stalled endpoint times out, the request is aborted, and the context is kept', async () => {
  const rpc = fakeRpc();
  const session = createSession({ fetch: rpc.fetch, timeoutMs: 40 });
  await session.handleCommand('Check Diana network.');
  rpc.mode = 'stall';
  rpc.reset();
  const started = Date.now();
  const result = await session.handleCommand("What's the latest block?");
  assert.ok(Date.now() - started < 2_000);
  assert.deepEqual({ kind: result.kind, outcome: result.outcome }, { kind: 'answered', outcome: 'failed' });
  assert.equal(errorCodeOf(result), 'timeout');
  assert.deepEqual(rpc.methods, ['eth_chainId']);
  assert.deepEqual(session.context, NETWORK_CONTEXT);
});

// --- Unsupported, unknown, and malformed input -------------------------------------------------------------------

test('unsupported reads and other networks are answered without any request', async () => {
  for (const [command, kind, reason] of [
    ['What is the gas price?', 'unsupported', undefined],
    ['What is my balance?', 'unsupported', undefined],
    ['Son blokta kaç işlem var?', 'unsupported', undefined],
    ['Is mainnet working?', 'clarify', 'unsupported_network'],
    ['Latest Ethereum block?', 'clarify', 'unsupported_network'],
    ['Show the balance of 0x742d35Cc6634C0532925a3b844Bc454e4438f44e', 'clarify', 'unsupported_parameters'],
  ]) {
    const { rpc, session } = newSession();
    const result = await session.handleCommand(command);
    assert.deepEqual({ kind: result.kind, reason: result.reason }, { kind, reason }, command);
    assert.deepEqual(rpc.requests, [], command);
    assert.equal(session.context, undefined, command);
  }
});

test('unknown commands ask for clarification without any request', async () => {
  for (const command of ['Merhaba', 'Who is Diana?', 'Diana kimdir?', 'Tell me about Diana.', 'Is Diana ok?', 'Check.', 'Show the block.', 'Diana ağını kontrol et sonra uyu']) {
    const { rpc, session } = newSession();
    const result = await session.handleCommand(command);
    assert.equal(result.kind, 'clarify', command);
    assert.deepEqual(rpc.requests, [], command);
  }
});

test('empty, oversized, and non-string input is answered without any request and never throws', async () => {
  const { rpc, classifier, session } = newSession();
  for (const [input, reason] of [['', 'empty_command'], ['   ', 'empty_command'], ['x'.repeat(501), 'command_too_long'], [undefined, 'empty_command'], [null, 'empty_command'], [42, 'empty_command'], [{ toString: () => 'Diana ağını kontrol et.' }, 'empty_command'], [['Check Diana network.'], 'empty_command']]) {
    const result = await session.handleCommand(input);
    assert.deepEqual({ kind: result.kind, reason: result.reason }, { kind: 'clarify', reason }, String(input).slice(0, 20));
  }
  assert.deepEqual(rpc.requests, []);
  assert.equal(classifier.calls.length, 0);
});

test('model-like malformed classifier output never runs a query', async () => {
  const outputs = [
    [{ label: 'send_transfer', score: 1 }],
    [{ label: 'network_check', score: 1, tool: 'eth_sendRawTransaction' }],
    [{ label: 'network_check', score: 1, rpcMethods: ['eth_sendTransaction'] }],
    [{ label: 'block_number', score: 1, network: 'mainnet' }],
    [{ label: 'network_check', score: 1.5 }],
    [{ label: 'network_check', score: Number.NaN }],
    [{ label: 'network_check', score: '1' }],
    [{ label: 'network_check', score: 0.9 }, { label: 'network_check', score: 0.1 }],
    [{ label: 'network_check', score: 0.7 }, { label: 'block_number', score: 0.7 }],
    [{ label: 'network_check', score: 0.5 }],
    [{ label: 'network_check', score: 0.5 }, { label: 'block_number', score: 0.45 }],
    [],
    {},
    'network_check',
    null,
    undefined,
    [{ label: 'unknown', score: 1 }],
    [{ label: 'follow_up_repeat', score: 1 }],
  ];
  for (const output of outputs) {
    const rpc = fakeRpc();
    const session = createSession({ fetch: rpc.fetch, classifier: { classify: () => output } });
    const result = await session.handleCommand('Tell me something.');
    assert.equal(result.kind, 'clarify', JSON.stringify(output) ?? String(output));
    assert.deepEqual(rpc.requests, [], JSON.stringify(output) ?? String(output));
  }
  for (const classify of [() => { throw new Error('model crashed'); }, () => Promise.reject(new Error('timeout')), () => new Promise(resolve => setTimeout(() => resolve([{ label: 'bogus', score: 1 }]), 5))]) {
    const rpc = fakeRpc();
    const session = createSession({ fetch: rpc.fetch, classifier: { classify } });
    const result = await session.handleCommand('Tell me something.');
    assert.equal(result.kind, 'clarify');
    assert.ok(['classifier_unavailable', 'invalid_classifier_output'].includes(result.reason), result.reason);
    assert.deepEqual(rpc.requests, []);
  }
  // A well-formed "unsupported" answer from a model sends nothing either.
  const rpc = fakeRpc();
  const unsupported = await createSession({ fetch: rpc.fetch, classifier: { classify: () => [{ label: 'unsupported', score: 1 }] } }).handleCommand('Tell me something.');
  assert.equal(unsupported.kind, 'unsupported');
  assert.deepEqual(rpc.requests, []);
});

test('the classifier receives only the normalized command text, never the context', async () => {
  const classifier = spyClassifier();
  const rpc = fakeRpc();
  const session = createSession({ fetch: rpc.fetch, classifier });
  await session.handleCommand('Check Diana network.');
  await session.handleCommand('  CHECK   Again.  ');
  assert.ok(classifier.calls.length >= 2);
  for (const args of classifier.calls) {
    assert.equal(args.length, 1);
    assert.equal(typeof args[0], 'string');
  }
  assert.ok(classifier.calls.some(args => args[0] === 'check again.'));
});

test('invalid thresholds give an error result without any request', async () => {
  const rpc = fakeRpc();
  const session = createSession({ fetch: rpc.fetch, thresholds: { minConfidence: 0.1, minMargin: 0.01 } });
  const result = await session.handleCommand('Tell me something.');
  assert.equal(result.kind, 'error');
  assert.deepEqual(rpc.requests, []);
  assert.equal(session.context, undefined);
});

test('results are frozen and the session cannot be tampered with', async () => {
  const { session } = newSession();
  const result = await session.handleCommand('Check Diana network.');
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(session));
  assert.ok(Object.isFrozen(session.context));
  assert.throws(() => { 'use strict'; session.handleCommand = () => {}; });
  assert.throws(() => { 'use strict'; result.context.kind = 'block_number'; });
});

// --- Isolation ------------------------------------------------------------------------------------------------------

test('the session composes the existing pipeline and adds no network or decision code', () => {
  assert.deepEqual(Object.keys(sessionModule).sort(), ['createSession']);
  const code = read('src/agent/session.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const imports = [...code.matchAll(/^import\s+(?:type\s+)?\{[^}]*\}\s+from\s+'([^']+)'/gm)].map(match => match[1]);
  assert.deepEqual([...new Set(imports)].sort(), ['../qorechain/read-client.ts', './conversation.ts', './intent.ts', './lexicon.ts']);
  assert.match(code, /import \{ actOnDecision, interpretCommand \} from '\.\/intent\.ts';/);
  for (const forbidden of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'eth_', 'invokeTool', 'executePlan', 'runQuery', 'routeCommand', 'planCommand', 'assessRisk', 'decideIntent', 'localStorage', 'sign', 'wallet', 'privateKey']) {
    assert.equal(code.includes(forbidden), false, forbidden);
  }
});

// Changed in 7C: this test checked that web.ts did not use the session yet. Now the interface must
// use only the session: no runtime import that could bypass the safety gate.
test('the web interface runs every command through the session and has no path around the safety gate', () => {
  const code = read('src/web.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const runtimeImports = [...code.matchAll(/^import\s+(?!type\b)(?:[^'"]*from\s+)?'([^']+)'/gm)].map(match => match[1]);
  assert.deepEqual(runtimeImports.sort(), ['./agent/session.ts', './web.css']);
  const typeImports = [...code.matchAll(/^import\s+type\s+[^;]+from\s+'([^']+)'/gm)].map(match => match[1]);
  assert.ok(typeImports.length > 0);
  for (const name of ['routeCommand', 'planCommand', 'resolveFollowUp', 'runQuery', 'executePlan', 'invokeTool', 'queryLatestBlock', 'interpretCommand', 'understandCommand', 'actOnDecision', 'decideIntent', 'getEvmBlockNumber', 'getBlockNumber', 'getBalance', 'verifyMlDsa87', 'WithSdk', 'fetch(', 'XMLHttpRequest', 'WebSocket', 'eth_']) {
    assert.equal(code.includes(name), false, name);
  }
  assert.equal((code.match(/createSession\(\)/g) ?? []).length, 1, 'one session per page');
  assert.match(code, /session\.handleCommand\(command\.value\)/);
  assert.match(code, /session\.clear\(\)/);
  assert.equal(/session|handleCommand/.test(read('index.html')), false, 'index.html is unchanged');
  // Added in 7F: the only other code web.ts may load is the post-quantum panel, on demand. The panel
  // verifies signatures locally and has no command path into the session.
  assert.deepEqual([...code.matchAll(/import\('([^']+)'\)/g)].map(match => match[1]), ['./pqc/panel.ts']);
  const panel = read('src/pqc/panel.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const name of ['session', 'handleCommand', 'interpretCommand', 'runQuery', 'invokeTool', 'fetch(', 'XMLHttpRequest', 'WebSocket', 'eth_', 'sign(', 'keygen', 'secretKey', 'privateKey']) {
    assert.equal(panel.includes(name), false, 'panel: ' + name);
  }
});
