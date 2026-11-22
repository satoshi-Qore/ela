import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createLinearModel,LABELS,DIMENSIONS} from '../src/ai/linear.ts';
import {createModelClassifier,MODEL_BUDGET} from '../src/agent/model-contract.ts';
import {interpretCommand} from '../src/agent/intent.ts';
import {modelEvalSet} from './model-eval-set.mjs';
import {trainingGroups} from '../scripts/ai-training-data.mjs';
const manifest=JSON.parse(fs.readFileSync(new URL('../src/ai/manifest.json',import.meta.url)));
const bytes=new Uint8Array(fs.readFileSync(new URL('../public/models/ela-intent-linear-v1.json',import.meta.url)));
const data=JSON.parse(new TextDecoder().decode(bytes));
test('real learned artifact is pinned, small and MIT, with six labels and reproducible dimensions',()=>{
  assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.sha256);
  assert.equal(bytes.byteLength,manifest.artifactBytes);assert.ok(bytes.byteLength<=MODEL_BUDGET.maxArtifactBytes);
  assert.equal(manifest.license,'MIT');assert.equal(manifest.defaultEnabled,false);
  assert.deepEqual(data.labels,LABELS);assert.equal(data.dimensions,DIMENSIONS);
  assert.ok(data.weights.flat().some(w=>w!==0));
});
test('real learned inference is deterministic, finite and different across bilingual inputs',()=>{
  const m=createLinearModel(data);
  for(const text of ['verify whether Diana is reachable','Diana bağlantısı yanıt veriyor mu']){
    const output=m.classify(text);assert.deepEqual(output,m.classify(text));
    assert.deepEqual(output.map(x=>x.label),LABELS);assert.ok(output.every(x=>Number.isFinite(x.score)&&x.score>=0&&x.score<=1));
    assert.equal([...output].sort((a,b)=>b.score-a.score)[0].label,'network_check');
  }
  assert.throws(()=>createLinearModel({...data,labels:['rpc','sign']}));
});
test('all evaluation texts are excluded from original training phrases',()=>{
  const norm=s=>s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  const texts=new Set(modelEvalSet.map(x=>norm(x.text)));
  for(const phrase of Object.values(trainingGroups).flat())assert.equal(texts.has(norm(phrase)),false,phrase);
});
test('real model sits behind existing gate and closed-label interpretation, with no authority',async()=>{
  let calls=0;
  const c=createModelClassifier({expectedSha256:manifest.sha256,load:async()=>({bytes,model:{classify:t=>{calls++;return createLinearModel(data).classify(t);}}})});
  const decision=await interpretCommand('could you determine whether Diana responds',undefined,{classifier:c});
  assert.equal(decision.kind,'run');assert.equal(decision.query,'network_check');assert.equal(calls,1);
  for(const text of ['send all QOR now','sign this transaction','my private key is 0x'+'a'.repeat(64)]){
    const before=calls;const d=await interpretCommand(text,undefined,{classifier:c});assert.notEqual(d.kind,'run');assert.equal(calls,before);
  }
});
test('hash/load/timeout failure preserves safe fallback, uncertain model output cannot run',async()=>{
  const fallback=createModelClassifier({expectedSha256:'0'.repeat(64),load:async()=>({bytes,model:createLinearModel(data)})});
  await fallback.classify('unrecognized text');assert.equal(fallback.stats().state,'fallback');
  const slow=createModelClassifier({expectedSha256:manifest.sha256,maxInferenceMs:5,load:async()=>({bytes,model:{classify:()=>new Promise(()=>{})}})});
  const d=await interpretCommand('an unfamiliar network inquiry',undefined,{classifier:slow});assert.equal(d.kind,'clarify');assert.equal(slow.stats().timeouts,1);
  const uncertain=createModelClassifier({expectedSha256:manifest.sha256,load:async()=>({bytes,model:{classify:()=>LABELS.map(label=>({label,score:1/6}))}})});
  assert.equal((await interpretCommand('an unfamiliar network inquiry',undefined,{classifier:uncertain})).kind,'clarify');
});
