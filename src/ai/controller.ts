import manifest from './manifest.json' with { type:'json' };
import {createModelClassifier,MODEL_BUDGET,verifyModelArtifact} from '../agent/model-contract.ts';
import {ruleClassifier} from '../agent/lexicon.ts';
import {createLinearModel} from './linear.ts';

let enabled=false;
let privateWithheld=0;
let last: {source:string; label:string; score:number; ruleLabel:string} | undefined;
const listeners=new Set<()=>void>();
const emit=()=>listeners.forEach(fn=>fn());
const classifier=createModelClassifier({expectedSha256:manifest.sha256,load:async()=>{
  emit();
  const response=await fetch(new URL(manifest.file, new URL(import.meta.env.BASE_URL,location.origin)),
    {credentials:'omit',redirect:'error',signal:AbortSignal.timeout(MODEL_BUDGET.maxLoadMs)});
  if(!response.ok || !response.body)throw Error('Model unavailable');
  const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
    if(size>MODEL_BUDGET.maxArtifactBytes){await reader.cancel();throw Error('Model too large');}parts.push(value);}
  const bytes=new Uint8Array(size);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}
  if(size!==manifest.artifactBytes || !(await verifyModelArtifact(bytes,manifest.sha256)))throw Error('Model integrity failure');
  return {bytes,model:createLinearModel(JSON.parse(new TextDecoder().decode(bytes)))};
}});
export const modelInfo=manifest;
export function setEnabled(value:boolean){enabled=value;last=undefined;emit();}
export function stats(){const s=classifier.stats();return {...s,withheld:s.withheld+privateWithheld,enabled,last};}
export function subscribe(fn:()=>void){listeners.add(fn);return ()=>listeners.delete(fn);}
export async function classify(text:string):Promise<unknown>{
  if(!enabled)return ruleClassifier.classify(text);
  if(/\S+@\S+|https?:\/\/|(?:\+?\d[\s()-]*){10,}/u.test(text)){
    privateWithheld++;last={source:'withheld',label:'unknown',score:1,ruleLabel:'not_evaluated'};emit();
    return [{label:'unknown',score:1}];
  }
  const before=classifier.stats();
  try {
    const output=await classifier.classify(text);
    const after=classifier.stats();
    const top=Array.isArray(output)?[...output].sort((a,b)=>b.score-a.score)[0]:undefined;
    // Compare labels only. Neither command text nor prior results are stored or displayed here.
    const rule=await ruleClassifier.classify(text);
    const ruleTop=Array.isArray(rule)?[...rule].sort((a,b)=>b.score-a.score)[0]:undefined;
    last={source:after.withheld>before.withheld?'withheld':after.fallbackCalls>before.fallbackCalls?'fallback':'model',
      label:String(top?.label??'unknown'),score:Number(top?.score??0),ruleLabel:String(ruleTop?.label??'unknown')};
    return output;
  } catch(error) {
    last={source:'failed',label:'unknown',score:0,ruleLabel:'not_evaluated'};
    throw error;
  } finally {emit();}
}
