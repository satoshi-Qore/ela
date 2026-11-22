import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {training,GRID,digest} from '../scripts/accuracy/train.mjs';
import {studyTraining,development} from '../scripts/accuracy/corpus.mjs';
import {accuracyFinal} from './fixtures/accuracy-final.mjs';
import {modelEvalSet} from './model-eval-set.mjs';
import {intentEvalSet} from './intent-eval-set.mjs';
import {intentEvalSetEn} from './intent-eval-set-en.mjs';
import {intentHeldoutSet} from './intent-heldout-set.mjs';
import {evaluateClassifier} from '../scripts/accuracy/measure.mjs';
import {evaluateClassifier as legacyMeasure} from './model-eval-report.mjs';
import {ruleClassifier} from '../src/agent/lexicon.ts';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const evidence=JSON.parse(read('docs/evidence/ai-accuracy-06b/node-summary.json'));
const norm=s=>s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();

test('06B training, development, new holdout and all historical evaluation texts are disjoint',()=>{
  const sets={training,development,final:accuracyFinal,legacy:[...modelEvalSet,...intentEvalSet,...intentEvalSetEn,...intentHeldoutSet]};
  assert.equal(training.length,370);assert.equal(studyTraining.length,250);assert.equal(development.length,72);assert.equal(accuracyFinal.length,307);
  for(const [name,items]of Object.entries(sets)){
    if(name!=='legacy')assert.equal(new Set(items.map(x=>norm(x.text))).size,items.length,name+' duplicates');
    for(const [other,rows]of Object.entries(sets))if(name<other){const texts=new Set(rows.map(x=>norm(x.text)));for(const row of items)assert.equal(texts.has(norm(row.text)),false,name+' overlaps '+other+': '+row.text);}
  }
  assert.equal(digest(training),evidence.selection.trainingSha256);
  assert.equal(digest(development),evidence.selection.developmentSha256);
  // Hash serialized items, not checkout-specific line endings.
  assert.equal(digest(accuracyFinal),evidence.protocol.finalItemsSha256);
});

test('06B selection never imports or reads evaluation sets, and cannot overwrite deployed weights',()=>{
  const source=read('scripts/accuracy/train.mjs');
  for(const word of ['accuracy-final','model-eval-set','intent-eval-set','public/models','src/ai/manifest'])assert.equal(source.replace(/^\/\/.*$/gm,'').includes(word),false,word);
  assert.deepEqual(evidence.selection.trials.map(x=>x.config),GRID);
  assert.equal(evidence.selection.selectedConfig.epochs,150);
  assert.equal(evidence.selection.selectedConfig.temperature,2);
  assert.equal(evidence.qualityGate.passed,false);assert.equal(evidence.qualityGate.promoted,false);
  const manifest=JSON.parse(read('src/ai/manifest.json'));
  assert.equal(manifest.sha256,'296c79b3b2fa7e7238a08ea33643945d5a16c8d95cd2e762e6e81b660ffd5e18');
  assert.equal(manifest.defaultEnabled,false);
});

test('archived 06B metrics remain unchanged; only the four 06C gate repairs change current outcomes',async()=>{
  const before=await legacyMeasure(ruleClassifier,modelEvalSet);
  const study=await evaluateClassifier(ruleClassifier,modelEvalSet);
  assert.deepEqual(study.overall,before.overall);
  const fresh=await evaluateClassifier(ruleClassifier,accuracyFinal);
  const archived=evidence.datasets.independent.rules.overall;
  assert.equal(archived.gateMisses,4,'preserve the historical evidence');
  assert.deepEqual(fresh.overall,{...archived,correct:archived.correct+4,gateMisses:0});
  const {gateRegressions06c}=await import('./safety-gate-06c-set.mjs');
  for(const {text} of gateRegressions06c){
    const row=fresh.rows.find(r=>r.text===text);
    assert.equal(row.actual,'refuse',text);assert.equal(row.classifierUsed,false,text);
    assert.deepEqual(row.rpcMethods,[],text);
  }
});
