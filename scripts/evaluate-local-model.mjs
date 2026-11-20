import { readFileSync, writeFileSync } from 'node:fs';
import { createStaticModel } from '../src/agent/local-model-runtime.ts';
import { createModelClassifier } from '../src/agent/model-contract.ts';
import { ruleClassifier } from '../src/agent/lexicon.ts';
import { evaluateClassifier } from '../tests/model-eval-report.mjs';
import { modelEvalSet } from '../tests/model-eval-set.mjs';
import { gateAttacks } from '../tests/safety-gate-set.mjs';
const start = performance.now();
const bytes = new Uint8Array(readFileSync(new URL('../src/agent/assets/ela-intent-v1.bin', import.meta.url)));
const manifest = JSON.parse(readFileSync(new URL('../src/agent/assets/ela-intent-v1.json', import.meta.url)));
const model = createStaticModel(bytes);
const loadMs = performance.now() - start;
const timings = [];
const classifier = createModelClassifier({ expectedSha256: manifest.sha256, load: async () => ({ bytes, model: {
  classify(text) { const t = performance.now(); const result = model.classify(text); timings.push(performance.now() - t); return result; },
} }) });
const hybrid = { classify(text) { const rule = ruleClassifier.classify(text); return rule[0].label === 'unknown' ? classifier.classify(text) : rule; } };
const baseline = await evaluateClassifier(ruleClassifier);
const result = await evaluateClassifier(hybrid);
const validation = JSON.parse(readFileSync(new URL('../tests/fixtures/local-model-validation.json', import.meta.url)));
const queries = {network_check:'network_check',block_number:'block_number',follow_up_repeat:'network_check',follow_up_current:'block_number'};
const validationItems = validation.map(r => ({...r,group:'validation', context:'network_check',expect:queries[r.label]?'run:'+queries[r.label]:'no_run'}));
const validationBaseline = await evaluateClassifier(ruleClassifier,validationItems);
const validationResult = await evaluateClassifier(hybrid,validationItems);
const beforeAttacks = classifier.stats().calls;
const attacks = await evaluateClassifier(hybrid,gateAttacks.map(r=>({...r,context:'none',expect:'refuse'})));
const attackModelCalls = classifier.stats().calls-beforeAttacks;
const rawValidation = Object.fromEntries(['all','tr','en','mixed'].map(lang=>{
  const rows=validation.filter(r=>lang==='all'||r.lang===lang);
  return [lang,{total:rows.length,correct:rows.filter(r=>[...model.classify(r.input)].sort((a,b)=>b.score-a.score)[0].label===r.label).length}];
}));
const byLanguage = Object.fromEntries(['tr','en','mixed'].map(lang => {
  const rows = result.rows.filter(r => r.lang === lang);
  return [lang, { total: rows.length, correct: rows.filter(r => r.correct).length, falseAccepts: rows.filter(r => r.falseAccept).length, falseRejects: rows.filter(r => r.falseReject).length }];
}));
const sorted = [...timings].sort((a,b) => a-b);
const report = {
  kind: 'Fresh Node inference using real packaged weights; RPC transport scripted, not model output',
  model: manifest, thresholds: { minConfidence: 0.75, minMargin: 0.2 },
  baseline: baseline.overall, integrated: result.overall, byLanguage, stats: classifier.stats(),
  validation:{baseline:validationBaseline.overall,integrated:validationResult.overall,rawLabelAccuracy:rawValidation},
  attacks:{...attacks.overall,modelCalls:attackModelCalls},
  loadMs, inferenceMs: { count: timings.length, mean: timings.reduce((a,b)=>a+b,0)/timings.length, p95: sorted[Math.ceil(sorted.length*.95)-1], max: sorted.at(-1) },
  changes: result.rows.flatMap((row,i) => row.actual === baseline.rows[i].actual ? [] : [{text:row.text,before:baseline.rows[i].actual,after:row.actual,correct:row.correct}]),
};
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report, null, 2));
