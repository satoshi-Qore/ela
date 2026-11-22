// Same session-level outcomes as model-eval-report; no datasets and no network access.
import {createSession} from '../../src/agent/session.ts';
export function summarize(rows){
  const expectedRuns=rows.filter(r=>r.expect.startsWith('run:')).length;
  const falseAccepts=rows.filter(r=>r.falseAccept).length,falseRejects=rows.filter(r=>r.falseReject).length;
  return {total:rows.length,correct:rows.filter(r=>r.correct).length,expectedRuns,expectedNonRuns:rows.length-expectedRuns,falseAccepts,falseRejects,gateMisses:rows.filter(r=>r.gateMiss).length,overRefusals:rows.filter(r=>r.overRefusal).length,falseAcceptRate:rows.length===expectedRuns?0:Math.round(falseAccepts/(rows.length-expectedRuns)*1e4)/1e4,falseRejectRate:expectedRuns?Math.round(falseRejects/expectedRuns*1e4)/1e4:0};
}
export async function evaluateClassifier(classifier,items){
  const rows=[];
  for(const item of items){
    let candidates,methods=[];
    const session=createSession({classifier:{async classify(text){const value=await classifier.classify(text);candidates=Array.isArray(value)?[...value].sort((a,b)=>b.score-a.score):undefined;return value;}},fetch:async(_url,init)=>{
      const b=JSON.parse(init.body);methods.push(b.method);
      return Response.json({jsonrpc:'2.0',id:b.id,result:b.method==='eth_chainId'?'0x2648':'0x97e6b0'});
    }});
    if(item.context!=='none'){
      const result=await session.handleCommand(item.context==='network_check'?'Diana ağını kontrol et.':'QoreChain son blok numarasını öğren.');
      if(result.kind!=='answered'||result.outcome!=='success')throw Error('Study context setup failed');
    }
    candidates=undefined;methods=[];
    const r=await session.handleCommand(item.text);
    const actual=r.kind==='answered'?'run:'+r.query:r.kind==='refused'?'refuse':r.kind;
    const ran=actual.startsWith('run:');
    rows.push({...item,actual,correct:item.expect==='no_run'?!ran:actual===item.expect,falseAccept:ran&&actual!==item.expect,falseReject:item.expect.startsWith('run:')&&!ran,gateMiss:item.expect==='refuse'&&actual!=='refuse',overRefusal:item.expect!=='refuse'&&actual==='refuse',classifierUsed:!!candidates,topLabel:candidates?.[0]?.label??null,confidence:candidates?.[0]?.score??null,margin:candidates?candidates[0].score-(candidates[1]?.score??0):null,rpcMethods:methods});
  }
  return {overall:summarize(rows),languages:Object.fromEntries([...new Set(rows.map(r=>r.lang))].map(l=>[l,summarize(rows.filter(r=>r.lang===l))])),groups:Object.fromEntries([...new Set(rows.map(r=>r.group))].map(g=>[g,summarize(rows.filter(r=>r.group===g))])),rows};
}
