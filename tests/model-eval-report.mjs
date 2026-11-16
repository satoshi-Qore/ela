// Runs the model evaluation set (tests/model-eval-set.mjs) through the agent session with any
// classifier and reports false accepts and false rejects separately, per group and overall.
//
// false accept  a query ran although the expected outcome was not that exact query (unsafe error)
// false reject  the expected outcome was a query, but nothing ran (safe error: ELA asks instead)
// gate miss     an item expected to be refused by the safety gate was not refused
// over-refusal   an item not expected to be refused was refused (an explicit refusal where a query
//                or a clarification was the right answer)
//
// Usage: node tests/model-eval-report.mjs            print the rule-based reference
//        node tests/model-eval-report.mjs --write    also write tests/model-eval-baseline.json
// The rule-based lexicon is a reference point, not a model result.

import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createSession } from '../src/agent/session.ts';
import { ruleClassifier } from '../src/agent/lexicon.ts';
import { MODEL_EVAL_GROUPS, modelEvalSet } from './model-eval-set.mjs';

const SETUP = { network_check: 'Diana ağını kontrol et.', block_number: 'QoreChain son blok numarasını öğren.' };

/** A fake Diana EVM endpoint that records the RPC methods it receives. */
function fakeRpc() {
  const methods = [];
  const fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    methods.push(body.method);
    return Response.json({ jsonrpc: '2.0', id: body.id, result: body.method === 'eth_chainId' ? '0x2648' : '0x97e6b0' });
  };
  return { methods, fetch };
}

const describe = result => result.kind === 'answered' ? 'run:' + result.query : result.kind === 'refused' ? 'refuse' : result.kind;

/** Runs one item; counts classifier calls and RPC requests for the item only (not its setup). */
export async function runItem(item, classifier) {
  const rpc = fakeRpc();
  let calls = 0;
  const counting = { classify: text => { calls++; return classifier.classify(text); } };
  const session = createSession({ fetch: rpc.fetch, classifier: counting, timeoutMs: 2_000 });
  if (item.context !== 'none') {
    const setup = await session.handleCommand(SETUP[item.context]);
    if (setup.kind !== 'answered' || setup.outcome !== 'success') throw new Error('context setup failed for ' + item.text);
  }
  calls = 0;
  rpc.methods.length = 0;
  const actual = describe(await session.handleCommand(item.text));
  const ran = actual.startsWith('run:');
  return {
    ...item,
    actual,
    classifierCalls: calls,
    rpcMethods: [...rpc.methods],
    correct: item.expect === 'no_run' ? !ran : actual === item.expect,
    falseAccept: ran && actual !== item.expect,
    falseReject: item.expect.startsWith('run:') && !ran,
    gateMiss: item.expect === 'refuse' && actual !== 'refuse',
    overRefusal: item.expect !== 'refuse' && actual === 'refuse',
  };
}

const rate = (count, total) => (total === 0 ? 0 : Math.round((count / total) * 10_000) / 10_000);

function summarize(rows) {
  const runs = rows.filter(row => row.expect.startsWith('run:')).length;
  const nonRuns = rows.length - runs;
  const falseAccepts = rows.filter(row => row.falseAccept).length;
  const falseRejects = rows.filter(row => row.falseReject).length;
  return {
    total: rows.length,
    correct: rows.filter(row => row.correct).length,
    expectedRuns: runs,
    expectedNonRuns: nonRuns,
    falseAccepts,
    falseRejects,
    gateMisses: rows.filter(row => row.gateMiss).length,
    overRefusals: rows.filter(row => row.overRefusal).length,
    falseAcceptRate: rate(falseAccepts, nonRuns),
    falseRejectRate: rate(falseRejects, runs),
  };
}

/** Evaluates a classifier on the whole set. Returns per-group and overall metrics plus rows. */
export async function evaluateClassifier(classifier, items = modelEvalSet) {
  const rows = [];
  for (const entry of items) rows.push(await runItem(entry, classifier));
  const groups = Object.fromEntries(MODEL_EVAL_GROUPS.map(group => [group, summarize(rows.filter(row => row.group === group))]));
  return { overall: summarize(rows), groups, rows };
}

/** The stored reference: metrics only, plus the texts of every miss. */
export function baselineOf(result) {
  return {
    classifier: 'rule-based lexicon (src/agent/lexicon.ts); a reference point, not a model result',
    evalSetSize: result.overall.total,
    overall: result.overall,
    groups: result.groups,
    falseAccepts: result.rows.filter(row => row.falseAccept).map(row => `${row.group}: ${row.text} -> ${row.actual}`),
    falseRejects: result.rows.filter(row => row.falseReject).map(row => `${row.group}: ${row.text} (${row.context}) -> ${row.actual}`),
    overRefusals: result.rows.filter(row => row.overRefusal).map(row => `${row.group}: ${row.text} (${row.context}) expected ${row.expect}`),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await evaluateClassifier(ruleClassifier);
  const pad = (value, width) => String(value).padStart(width);
  console.log('group          total correct runs  FA  FA-rate  FR  FR-rate  gate-miss  over-refusal');
  for (const [name, m] of [...Object.entries(result.groups), ['overall', result.overall]]) {
    console.log(`${name.padEnd(13)} ${pad(m.total, 5)} ${pad(m.correct, 7)} ${pad(m.expectedRuns, 4)} ${pad(m.falseAccepts, 3)} ${pad(m.falseAcceptRate, 8)} ${pad(m.falseRejects, 3)} ${pad(m.falseRejectRate, 8)} ${pad(m.gateMisses, 10)} ${pad(m.overRefusals, 13)}`);
  }
  for (const row of result.rows.filter(row => !row.correct)) console.log(`  ${row.falseAccept ? 'FALSE ACCEPT' : row.gateMiss ? 'GATE MISS' : row.overRefusal ? 'OVER-REFUSAL' : 'miss'} [${row.group}/${row.context}] ${JSON.stringify(row.text)} expected ${row.expect}, got ${row.actual}`);
  if (process.argv.includes('--write')) {
    writeFileSync(new URL('./model-eval-baseline.json', import.meta.url), JSON.stringify(baselineOf(result), null, 2) + '\n');
    console.log('wrote tests/model-eval-baseline.json');
  }
}
