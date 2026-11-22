import fs from 'node:fs';
import {createLinearModel} from '../src/ai/linear.ts';
import {createModelClassifier} from '../src/agent/model-contract.ts';
import {ruleClassifier} from '../src/agent/lexicon.ts';
import {evaluateClassifier} from '../tests/model-eval-report.mjs';
import {modelEvalSet} from '../tests/model-eval-set.mjs';
const manifest=JSON.parse(fs.readFileSync('src/ai/manifest.json','utf8'));
const bytes=new Uint8Array(fs.readFileSync('public/models/ela-intent-linear-v1.json'));
const model=createModelClassifier({expectedSha256:manifest.sha256,load:async()=>({bytes,model:createLinearModel(JSON.parse(new TextDecoder().decode(bytes)))})});
const result={};
for(const [name,items] of [['all',modelEvalSet],['tr',modelEvalSet.filter(i=>i.lang==='tr')],['en',modelEvalSet.filter(i=>i.lang==='en')]]){
  const before=await evaluateClassifier(ruleClassifier,items),after=await evaluateClassifier(model,items);
  result[name]={before:before.overall,after:after.overall,groups:after.groups};
}
console.log(JSON.stringify({runtime:'Node (not Chrome)',model:manifest,result,stats:model.stats()},null,2));
