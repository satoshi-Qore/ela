import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {features,LABELS,DIMENSIONS} from '../src/ai/linear.ts';
import {trainingGroups} from './ai-training-data.mjs';
import {modelEvalSet} from '../tests/model-eval-set.mjs';
import {intentEvalSet} from '../tests/intent-eval-set.mjs';
import {intentEvalSetEn} from '../tests/intent-eval-set-en.mjs';
import {intentHeldoutSet} from '../tests/intent-heldout-set.mjs';
const normalized=s=>s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const excluded=new Set([...modelEvalSet,...intentEvalSet,...intentEvalSetEn,...intentHeldoutSet].map(x=>normalized(x.text)));
const rows=[];
for(const [label,phrases] of Object.entries(trainingGroups))for(const text of phrases){
  if(excluded.has(normalized(text)))continue;
  rows.push({label,text});
}
const data=rows.map(r=>({y:LABELS.indexOf(r.label),f:features(r.text)}));
const weights=LABELS.map(()=>new Float64Array(DIMENSIONS)),bias=new Float64Array(6);
// Fixed-order cross-entropy SGD, no heldout-based hyperparameter search.
for(let epoch=0;epoch<500;epoch++)for(const {f,y} of data){
  const logits=weights.map((w,k)=>f.reduce((s,[i,x])=>s+w[i]*x,bias[k]));const max=Math.max(...logits),e=logits.map(z=>Math.exp(z-max)),sum=e.reduce((a,b)=>a+b,0);
  for(let k=0;k<6;k++){const g=e[k]/sum-(k===y?1:0);bias[k]-=.12*g;for(const [i,x] of f)weights[k][i]-=.35*(g*x+.0001*weights[k][i]);}
}
const artifact={version:1,labels:LABELS,dimensions:DIMENSIONS,weights:weights.map(w=>Array.from(w,x=>Number(x.toFixed(7)))),bias:Array.from(bias,x=>Number(x.toFixed(7)))};
const bytes=Buffer.from(JSON.stringify(artifact)+'\n');
fs.mkdirSync('public/models',{recursive:true});fs.writeFileSync('public/models/ela-intent-linear-v1.json',bytes);
const manifest={id:'ELA Intent Linear',version:'1.0.0',license:'MIT',architecture:'learned hashed word/character n-gram softmax',file:'models/ela-intent-linear-v1.json',sha256:createHash('sha256').update(bytes).digest('hex'),artifactBytes:bytes.length,
  trainingRows:rows.length,trainingSha256:createHash('sha256').update(JSON.stringify(rows)).digest('hex'),trainingSource:'scripts/ai-training-data.mjs',evaluationExcluded:true,defaultEnabled:false};
fs.writeFileSync('src/ai/manifest.json',JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest));
