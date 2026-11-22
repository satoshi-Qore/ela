// Test-only bundle. Never included in index.html or the production build.
import {createLinearModel} from '../../src/ai/linear.ts';
import {createModelClassifier} from '../../src/agent/model-contract.ts';
import {ruleClassifier} from '../../src/agent/lexicon.ts';
import {evaluateClassifier} from '../../scripts/accuracy/measure.mjs';
export async function runStudy({datasets,before,candidate}){
  const initialHeap=performance.memory?.usedJSHeapSize??null;
  let sampledHeap=initialHeap??0;
  const sample=()=>{sampledHeap=Math.max(sampledHeap,performance.memory?.usedJSHeapSize??0);};
  const timings={};
  const load=({url,sha256},name)=>{
    let maxInferenceMs=0;
    const model=createModelClassifier({expectedSha256:sha256,load:async()=>{
      const response=await fetch(url,{credentials:'omit',redirect:'error'});
      if(!response.ok)throw Error('Study artifact unavailable');
      const bytes=new Uint8Array(await response.arrayBuffer());
      const learned=createLinearModel(JSON.parse(new TextDecoder().decode(bytes)));
      return {bytes,model:{classify(text){const start=performance.now();const output=learned.classify(text);maxInferenceMs=Math.max(maxInferenceMs,performance.now()-start);sample();return output;}}};
    }});
    return {model,finish(){const stats=model.stats();if(stats.state!=='ready'||stats.fallbackCalls)throw Error('Study did not run real model');timings[name]={loadMs:stats.loadMs,maxInferenceMs,artifactBytes:stats.artifactBytes,fallbackCalls:stats.fallbackCalls};}};
  };
  const old=load(before,'before'),trial=load(candidate,'candidate');
  const results={};
  for(const [name,items]of Object.entries(datasets)){
    results[name]={};
    for(const [mode,classifier]of [['rules',ruleClassifier],['before',old.model],['candidate',trial.model]]){
      const r=await evaluateClassifier(classifier,items);sample();
      results[name][mode]={overall:r.overall,languages:r.languages,groups:r.groups};
    }
  }
  old.finish();trial.finish();
  return {results,timings,sampledExtraHeapBytes:initialHeap===null?null:sampledHeap-initialHeap,heapMethod:'performance.memory.usedJSHeapSize sampled on each model call; not a peak guarantee',defaultEnabled:false};
}
