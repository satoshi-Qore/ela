/** Learned sparse softmax classifier; no intent rules or query capabilities. Shared with training. */
export const LABELS = ['network_check','block_number','follow_up_repeat','follow_up_current','unsupported','unknown'] as const;
export const DIMENSIONS = 4096;
export function features(text: string): [number,number][] {
  const words=text.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/ı/g,'i').match(/[a-z0-9]+/g) ?? [];
  const values=new Map<number,number>();
  const add=(key:string)=>{let h=2166136261;for(let n=0;n<key.length;n++)h=Math.imul(h^key.charCodeAt(n),16777619);const k=(h>>>0)%DIMENSIONS;values.set(k,(values.get(k)??0)+1);};
  for(let i=0;i<words.length;i++){
    add('w:'+words[i]);if(i)add('b:'+words[i-1]+' '+words[i]);
    const w='^'+words[i]+'$';for(let size=3;size<=5;size++)for(let j=0;j+size<=w.length;j++)add('c:'+w.slice(j,j+size));
  }
  const norm=Math.sqrt([...values.values()].reduce((sum,v)=>sum+v*v,0))||1;
  return [...values].map(([i,v])=>[i,v/norm]);
}
export interface Weights { version:1; labels: readonly string[]; dimensions:number; weights:number[][]; bias:number[]; }
export function createLinearModel(data: Weights) {
  if(data.version!==1 || data.dimensions!==DIMENSIONS || JSON.stringify(data.labels)!==JSON.stringify(LABELS)
    || !Array.isArray(data.bias) || data.bias.length!==6 || !data.bias.every(x=>Number.isFinite(x)&&Math.abs(x)<=1000)
    || !Array.isArray(data.weights) || data.weights.length!==6 || !data.weights.every(w=>Array.isArray(w)&&w.length===DIMENSIONS&&w.every(x=>Number.isFinite(x)&&Math.abs(x)<=1000)))throw Error('Invalid learned model');
  const weights=data.weights.map(w=>Float32Array.from(w)),bias=Float32Array.from(data.bias);
  return Object.freeze({classify(text:string){
    const f=features(text),z=weights.map((w,k)=>f.reduce((s,[i,x])=>s+w[i]*x,bias[k]));
    const max=Math.max(...z),exp=z.map(v=>Math.exp(v-max)),sum=exp.reduce((a,b)=>a+b,0);
    return LABELS.map((label,k)=>({label,score:exp[k]/sum}));
  }});
}
