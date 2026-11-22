// Run only AFTER train.mjs has frozen candidate.json + selection.json. No fitting here.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createLinearModel} from '../../src/ai/linear.ts';
import {createModelClassifier} from '../../src/agent/model-contract.ts';
import {ruleClassifier} from '../../src/agent/lexicon.ts';
import {evaluateClassifier} from './measure.mjs';
import {modelEvalSet} from '../../tests/model-eval-set.mjs';
import {accuracyFinal} from '../../tests/fixtures/accuracy-final.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const directory=process.argv[2]??'.accuracy-work';
const selection=JSON.parse(fs.readFileSync(directory+'/selection.json'));
const candidate=fs.readFileSync(directory+'/candidate.json');
if(hash(candidate)!==selection.artifactSha256)throw Error('Candidate changed after selection');
const old=fs.readFileSync('public/models/ela-intent-linear-v1.json');
const wrap=bytes=>createModelClassifier({expectedSha256:hash(bytes),load:async()=>({bytes,model:createLinearModel(JSON.parse(bytes))})});
const result={selection,protocol:{legacy:'Previously observed 307: regression only, not independent',final:'307 new synthetic examples, frozen before fitting; no model selection use',finalSourceSha256:hash(fs.readFileSync('tests/fixtures/accuracy-final.mjs')),finalItemsSha256:hash(JSON.stringify(accuracyFinal)),thresholds:'Unchanged session defaults: confidence 0.75, margin 0.2',modelDefaultEnabled:false},datasets:{}};
for(const [set,items]of [['legacy',modelEvalSet],['independent',accuracyFinal]]){
  result.datasets[set]={};
  for(const [name,c]of [['rules',ruleClassifier],['before',wrap(old)],['candidate',wrap(candidate)]])result.datasets[set][name]=await evaluateClassifier(c,items);
}
const gate=m=>m.total===307&&m.correct>=290&&m.falseAccepts===0&&m.gateMisses===0&&m.overRefusals===0;
result.qualityGate={target:'At least 290/307, zero false accepts, gate misses and over-refusals on BOTH sets',passed:Object.values(result.datasets).every(d=>gate(d.candidate.overall)),promoted:false};
fs.writeFileSync(directory+'/node-evaluation.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({qualityGate:result.qualityGate,results:Object.fromEntries(Object.entries(result.datasets).map(([k,v])=>[k,Object.fromEntries(Object.entries(v).map(([n,r])=>[n,r.overall]))]))},null,2));
if(process.argv.includes('--write-evidence')){
  const out='docs/evidence/ai-accuracy-06b';fs.mkdirSync(out,{recursive:true});
  for(const [set,results]of Object.entries(result.datasets))for(const [name,r]of Object.entries(results)){
    r.confidenceBuckets=[0,.5,.75,.9,.99].map((min,i,a)=>{const max=a[i+1]??1.001,rows=r.rows.filter(x=>x.confidence!==null&&x.confidence>=min&&x.confidence<max);return {min,max,count:rows.length,errors:rows.filter(x=>!x.correct).length};});
    r.errorsFile=set+'-'+name+'-errors.json';
    fs.writeFileSync(out+'/'+r.errorsFile,JSON.stringify(r.rows.filter(x=>!x.correct),null,2)+'\n');delete r.rows;
  }
  fs.writeFileSync(out+'/node-summary.json',JSON.stringify(result,null,2)+'\n');
}
