// Additive audit of existing, unmodified evaluation sets. Never reads sealed labels.
import {readFileSync,writeFileSync} from 'node:fs';
import {createStaticModel} from '../src/agent/local-model-runtime.ts';
import {createModelClassifier} from '../src/agent/model-contract.ts';
import {ruleClassifier} from '../src/agent/lexicon.ts';
import {interpretCommand} from '../src/agent/intent.ts';
import {DIANA_NETWORK} from '../src/agent/registry.ts';
import {evaluateClassifier} from '../tests/model-eval-report.mjs';
import {modelEvalSet} from '../tests/model-eval-set.mjs';
const bytes=new Uint8Array(readFileSync(new URL('../src/agent/assets/ela-intent-v1.bin',import.meta.url)));
const manifest=JSON.parse(readFileSync(new URL('../src/agent/assets/ela-intent-v1.json',import.meta.url)));
const model=createStaticModel(bytes);
const wrapped=createModelClassifier({expectedSha256:manifest.sha256,load:async()=>({bytes,model})});
const hybrid={classify(text){const r=ruleClassifier.classify(text);return r[0].label==='unknown'?wrapped.classify(text):r;}};
const validation=JSON.parse(readFileSync(new URL('../tests/fixtures/local-model-validation.json',import.meta.url)));
const queries={network_check:'network_check',block_number:'block_number',follow_up_repeat:'network_check',follow_up_current:'block_number'};
const validationItems=validation.map(r=>({...r,group:'validation',context:'network_check',expect:queries[r.label]?'run:'+queries[r.label]:'no_run'}));
const rank=output=>[...output].sort((a,b)=>b.score-a.score);
const countBy=(rows,key)=>Object.fromEntries([...new Set(rows.map(key))].sort().map(k=>[k,rows.filter(r=>key(r)===k).length]));
async function audit(items,isValidation){
 const before=await evaluateClassifier(ruleClassifier,items),after=await evaluateClassifier(hybrid,items);
 const rows=[];
 for(let i=0;i<items.length;i++){
  const item=items[i],context=item.context==='none'?undefined:{kind:item.context,network:DIANA_NETWORK};
  const decision=await interpretCommand(item.text,context,{classifier:hybrid});
  const baseDecision=await interpretCommand(item.text,context,{classifier:ruleClassifier});
  const row={...after.rows[i],before:before.rows[i].actual,decision,baseDecision};
  if(isValidation){
   const raw=rank(model.classify(item.input));
   row.raw={top:raw[0],runnerUp:raw[1],margin:raw[0].score-raw[1].score,correct:raw[0].label===item.label};
  }
  // Counterfactual only, never alters the pipeline or sends RPC. The existing wrapper
  // still withholds risky/private wording. Gate refusals and input rejects are not probed.
  if(['classifier','deterministic'].includes(decision.source)){
   const input=item.text.normalize('NFC').toLocaleLowerCase('tr').replace(/\s+/gu,' ').trim();
   const prior=wrapped.stats();const candidates=rank(await wrapped.classify(input));const next=wrapped.stats();
   row.probe={withheld:next.withheld>prior.withheld,top:candidates[0],margin:candidates[0].score-(candidates[1]?.score??0)};
   row.probe.accepted= !row.probe.withheld && candidates[0].score>=.75 && row.probe.margin>=.2;
   row.ruleTop=ruleClassifier.classify(input)[0];
  }
  row.failureCause=row.correct?'correct':row.falseAccept?(row.before===row.actual?'preexisting-route-label-mismatch':'changed-false-accept'):row.falseReject&&row.probe?.withheld?'model_filter_withheld_risky_wording':decision.reason??decision.kind;
  rows.push(row);
 }
 const byLanguage=Object.fromEntries(['tr','en','mixed'].map(lang=>{
  const r=rows.filter(x=>x.lang===lang);return [lang,{total:r.length,baselineCorrect:before.rows.filter(x=>x.lang===lang&&x.correct).length,correct:r.filter(x=>x.correct).length,falseAccepts:r.filter(x=>x.falseAccept).length,falseRejects:r.filter(x=>x.falseReject).length,missCauses:countBy(r.filter(x=>!x.correct),x=>x.failureCause)}];
 }));
 return {baseline:before.overall,integrated:after.overall,byLanguage,missCauses:countBy(rows.filter(r=>!r.correct),r=>r.failureCause),rawConfusions:isValidation?countBy(rows.filter(r=>!r.raw.correct),r=>r.label+' -> '+r.raw.top.label):undefined,changes:rows.filter(r=>r.before!==r.actual),rows};
}
const report={kind:'Existing evaluation sets; real weights; scripted RPC; counterfactual probes cannot override routing',thresholds:{minConfidence:.75,minMargin:.2},regression:await audit(modelEvalSet,false),validation:await audit(validationItems,true)};
writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(Object.fromEntries(['regression','validation'].map(k=>[k,{baseline:report[k].baseline,integrated:report[k].integrated,byLanguage:report[k].byLanguage,missCauses:report[k].missCauses,rawConfusions:report[k].rawConfusions}])),null,2));
