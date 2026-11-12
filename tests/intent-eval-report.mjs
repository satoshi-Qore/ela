// Prints evaluation metrics of the rule-based understanding (`understandCommand`) per sentence set.
// Usage: node tests/intent-eval-report.mjs [tr] [en] [heldout] [--list]
//
// false accept  the decision runs a query although the expected outcome is not that exact run
//               (a different query, a refusal, a clarification, or no run). This is the unsafe error.
// false reject  the expected outcome is a run, but nothing runs (a safe failure: ELA asks instead)
// gate miss     a risky sentence is not refused by the safety gate

import { understandCommand } from '../src/agent/lexicon.ts';
import { DIANA_NETWORK } from '../src/agent/registry.ts';
import { intentEvalSet } from './intent-eval-set.mjs';
import { intentEvalSetEn } from './intent-eval-set-en.mjs';
import { intentHeldoutSet } from './intent-heldout-set.mjs';
import { pathToFileURL } from 'node:url';

export const describeDecision = decision => decision.kind === 'run' ? 'run:' + decision.query
  : decision.kind === 'refuse' ? 'refuse:' + decision.reason
  : decision.kind === 'unsupported' ? 'unsupported' : 'clarify:' + decision.reason;

export const contextOf = name => (name === 'none' ? undefined : { kind: name, network: DIANA_NETWORK });

/** Whether an actual decision satisfies an expected outcome. `no_run` accepts any non-run decision. */
export function satisfies(expect, actual) {
  if (expect === 'no_run') return !actual.startsWith('run:');
  if (expect === 'unsupported') return actual === 'unsupported' || actual === 'clarify:unknown_intent';
  return actual === expect;
}

/**
 * Evaluates one set. The Turkish 5B set states the outcome a perfect classifier would reach
 * (`expect`); its non-run expectations are compared as `no_run`, because the rule-based lexicon may
 * answer `unknown` where an ideal classifier answers `unsupported`.
 */
export async function evaluate(items) {
  const rows = [];
  for (const item of items) {
    const actual = describeDecision(await understandCommand(item.text, contextOf(item.context)));
    const expect = item.expect.startsWith('run:') || item.expect.startsWith('refuse:') || item.expect.startsWith('clarify:no_context') || item.expect.startsWith('clarify:unsupported_')
      ? item.expect : 'no_run';
    const ok = satisfies(expect, actual);
    const falseAccept = actual.startsWith('run:') && actual !== expect;
    const falseReject = expect.startsWith('run:') && !actual.startsWith('run:');
    const gateMiss = expect.startsWith('refuse:') && !actual.startsWith('refuse:');
    rows.push({ ...item, expect, actual, ok, falseAccept, falseReject, gateMiss });
  }
  const count = predicate => rows.filter(predicate).length;
  const runs = count(row => row.expect.startsWith('run:'));
  const nonRuns = rows.length - runs;
  return {
    rows,
    total: rows.length,
    correct: count(row => row.ok),
    runs,
    runsCorrect: count(row => row.expect.startsWith('run:') && row.ok),
    nonRuns,
    falseAccepts: count(row => row.falseAccept),
    falseRejects: count(row => row.falseReject),
    gateMisses: count(row => row.gateMiss),
    risky: count(row => row.expect.startsWith('refuse:')),
  };
}

export const sets = { tr: intentEvalSet.map(item => ({ lang: 'tr', ...item })), en: intentEvalSetEn, heldout: intentHeldoutSet };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const names = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
  const list = process.argv.includes('--list');
  for (const name of names.length ? names : ['tr', 'en']) {
    const groups = name === 'heldout' ? [['heldout/tr', sets.heldout.filter(i => i.lang === 'tr')], ['heldout/en', sets.heldout.filter(i => i.lang === 'en')], ['heldout/all', sets.heldout]] : [[name, sets[name]]];
    for (const [label, items] of groups) {
      const r = await evaluate(items);
      console.log(`${label.padEnd(12)} total ${r.total}  correct ${r.correct}  runs ${r.runsCorrect}/${r.runs}  falseAccepts ${r.falseAccepts}  falseRejects ${r.falseRejects}  risky ${r.risky}  gateMisses ${r.gateMisses}`);
      for (const row of r.rows.filter(row => list || !row.ok)) {
        console.log(`   ${row.ok ? 'ok' : row.falseAccept ? 'FALSE ACCEPT' : row.gateMiss ? 'GATE MISS' : 'miss'}  [${row.category}/${row.context}] ${JSON.stringify(row.text)}  expected ${row.expect}, got ${row.actual}`);
      }
    }
  }
}
