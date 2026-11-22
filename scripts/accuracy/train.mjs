// Study only: never overwrites public/models or src/ai/manifest.json.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {features,LABELS,DIMENSIONS,createLinearModel} from '../../src/ai/linear.ts';
import {createModelClassifier} from '../../src/agent/model-contract.ts';
import {trainingGroups} from '../ai-training-data.mjs';
import {studyTraining,development} from './corpus.mjs';
import {evaluateClassifier} from './measure.mjs';

export const digest = value => createHash('sha256').update(typeof value==='string'||value instanceof Uint8Array?value:JSON.stringify(value)).digest('hex');
export const training = [...Object.entries(trainingGroups).flatMap(([label,phrases])=>phrases.map(text=>({label,text}))),...studyTraining];
export const GRID=Object.freeze([150,350,700].flatMap(epochs=>[1,1.5,2].map(temperature=>({epochs,temperature,learningRate:.35,biasRate:.12,l2:.0001}))));
export function trainWeights(epochs) {
  const data=training.map(r=>({y:LABELS.indexOf(r.label),f:features(r.text)}));
  const weights=LABELS.map(()=>new Float64Array(DIMENSIONS)),bias=new Float64Array(6);
  for(let epoch=0;epoch<epochs;epoch++)for(const {f,y} of data){
    const z=weights.map((w,k)=>f.reduce((s,[i,x])=>s+w[i]*x,bias[k]));
    const max=Math.max(...z),e=z.map(v=>Math.exp(v-max)),sum=e.reduce((a,b)=>a+b,0);
    for(let k=0;k<6;k++){const g=e[k]/sum-(k===y?1:0);bias[k]-=.12*g;for(const [i,x] of f)weights[k][i]-=.35*(g*x+.0001*weights[k][i]);}
  }
  return {weights,bias};
}
function artifactOf({weights,bias},temperature){return {version:1,labels:LABELS,dimensions:DIMENSIONS,weights:weights.map(w=>Array.from(w,x=>Number((x/temperature).toFixed(7)))),bias:Array.from(bias,x=>Number((x/temperature).toFixed(7)))};}
export function wrappedArtifact(artifact){
  const bytes=Buffer.from(JSON.stringify(artifact)+'\n');
  return createModelClassifier({expectedSha256:digest(bytes),load:async()=>({bytes,model:createLinearModel(artifact)})});
}
export async function selectCandidate(outDir='.accuracy-work') {
  // Fixed grid and tie-breaker declared before any final evaluation: FA, gate misses,
  // over-refusals, correct count, then grid order. Never search against either test set.
  const trials=[];let selected;
  for(const epochs of [...new Set(GRID.map(x=>x.epochs))]){
    const weights=trainWeights(epochs);
    for(const config of GRID.filter(x=>x.epochs===epochs)){
      const artifact=artifactOf(weights,config.temperature);
      const {overall}=await evaluateClassifier(wrappedArtifact(artifact),development);
      const trial={config,metrics:overall};trials.push(trial);
      const rank=x=>[x.metrics.falseAccepts,x.metrics.gateMisses,x.metrics.overRefusals,-x.metrics.correct];
      const less=(a,b)=>{const x=rank(a),y=rank(b);for(let i=0;i<x.length;i++)if(x[i]!==y[i])return x[i]<y[i];return false;};
      if(!selected || less(trial,selected))selected={...trial,artifact};
    }
  }
  fs.mkdirSync(outDir,{recursive:true});
  const bytes=JSON.stringify(selected.artifact)+'\n';
  const record={schema:1,id:'ELA Intent Linear 06B study candidate',license:'MIT',defaultEnabled:false,artifactSha256:digest(bytes),artifactBytes:Buffer.byteLength(bytes),trainingRows:training.length,trainingSha256:digest(training),developmentRows:development.length,developmentSha256:digest(development),selectedConfig:selected.config,trials};
  fs.writeFileSync(outDir+'/candidate.json',bytes);fs.writeFileSync(outDir+'/selection.json',JSON.stringify(record,null,2)+'\n');
  return {artifact:selected.artifact,record};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const {record}=await selectCandidate();console.log(JSON.stringify(record,null,2));}
