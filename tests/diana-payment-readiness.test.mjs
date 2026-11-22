import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {inspectDianaPaymentAccount} from '../src/agent/diana-payment-readiness.ts';
import {keccak256} from '../src/qorechain/keccak.ts';
const A='0x1111111111111111111111111111111111111111',E='0x2222222222222222222222222222222222222222',I='0x3333333333333333333333333333333333333333',R='0x4444444444444444444444444444444444444444';
const CODE='0x60006000',KEY='ab'.repeat(2592),HASH='0x'+'12'.repeat(32);
const sha=h=>createHash('sha256').update(Buffer.from(h.replace(/^0x/,''),'hex')).digest('hex');
const word=n=>BigInt(n).toString(16).padStart(64,'0');
const selector=s=>'0x'+keccak256(new TextEncoder().encode(s)).slice(0,8);
const fields={executor:E,recipient:R,invoiceIssuer:I,maxPerPayment:1000n,spendingLimit:5000n,maxPayments:5n,startsAt:900n,endsAt:2000n,totalSpent:100n,nextNonce:1n};
const policy={recipient:R,maxPerPaymentWei:'1000',spendingLimitWei:'5000',maxPayments:'5',startsAt:'900',endsAt:'2000'};
const config=()=>({contractAddress:A,executor:E,invoiceIssuer:I,expectedRuntimeSha256:sha(CODE),pqcKeySha256:{executor:sha(KEY),invoiceIssuer:sha(KEY)},policy:{...policy},payment:{recipient:R,amountWei:'100',nonce:'1',invoiceId:'0x'+'55'.repeat(32),validUntil:'1500'}});
const pqc=(registered=true,algorithm=1,proven=true,key=KEY)=>'0x'+word(registered?1:0)+word(algorithm)+word(128)+word(proven?1:0)+word(key.length/2)+key.padEnd(Math.ceil(key.length/64)*64,'0');
function fixture(change={}){
 const calls=[];let blocks=0;
 const fetch=async(url,init)=>{
  assert.equal(String(url),'https://evm-testnet.qore.host/');assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');
  const q=JSON.parse(init.body);calls.push(q);let result;
  if(q.method==='eth_chainId')result=change.chain??'0x2648';
  else if(q.method==='eth_getBlockByNumber')result={number:'0x100',timestamp:'0x3e8',hash:++blocks>1&&change.reorg?'0x'+'34'.repeat(32):HASH};
  else if(q.method==='eth_getCode')result=q.params[0]===A?(change.code??CODE):'0x';
  else if(q.method==='eth_getBalance')result=change.balance??'0x1000';
  else if(q.method==='eth_call'){
   const data=q.params[0].data;
   if(data.startsWith(selector('pqcKeyStatus(address)')))result=change.pqc??pqc();
   else if(data.startsWith(selector('paidInvoices(bytes32)')))result='0x'+word(change.paid?1:0);
   else{
    const name=Object.keys(fields).find(k=>selector(k+'()')===data);assert.ok(name,'unknown call '+data);
    const value=change.fields?.[name]??fields[name];result='0x'+word(value);
   }
  }else assert.fail('forbidden RPC method '+q.method);
  if(change.transform)result=change.transform(q,result);
  return Response.json({jsonrpc:'2.0',id:change.badId?999:q.id,result,...(change.rpcError?{error:{code:-32000,message:'rejected'}}:{})});
 };
 return {calls,fetch};
}
const run=async(c=config(),change={})=>{const f=fixture(change);return {report:await inspectDianaPaymentAccount(c,{fetch:f.fetch,nowSeconds:()=>1000}),calls:f.calls};};
const blocked=(report,id)=>assert.ok(report.checks.some(c=>c.id===id&&c.status==='blocked'),JSON.stringify(report));
test('complete public snapshot is ready for review but never authorizes execution',async()=>{
 const {report,calls}=await run();assert.equal(report.status,'ready_for_review');assert.equal(report.executionAuthorized,false);
 assert.equal(report.snapshot.number,'256');assert.equal(report.snapshot.hash,HASH);
 assert.equal(report.observations.policy.nextNonce,'1');assert.equal(report.observations.pqc.invoiceIssuer.keySha256,sha(KEY));
 assert.ok(report.checks.every(c=>c.status==='pass'));
 for(const q of calls.filter(q=>['eth_call','eth_getCode','eth_getBalance'].includes(q.method)))assert.deepEqual(q.params[1],{blockHash:HASH,requireCanonical:true});
 assert.equal(calls.filter(q=>q.method==='eth_chainId').length,2);
});
test('no deployed contract blocks policy reads but still checks public PQC roles',async()=>{
 const {report,calls}=await run(config(),{code:'0x'});assert.equal(report.status,'blocked');blocked(report,'contract_deployed');
 assert.equal(calls.filter(q=>q.method==='eth_call').length,2);assert.ok(report.observations.pqc.executor.registered);
});
test('unregistered, wrong algorithm, missing possession and changed key block readiness',async()=>{
 for(const p of [pqc(false,0,false,''),pqc(true,2),pqc(true,1,false),pqc(true,1,true,'cd'.repeat(2592))]){
  const {report}=await run(config(),{pqc:p});blocked(report,'issuer_pqc');blocked(report,'executor_pqc');assert.equal(report.status,'blocked');
 }
});
test('wrong chain stops before any account lookup',async()=>{const {report,calls}=await run(config(),{chain:'0x2649'});assert.equal(calls.length,1);assert.equal(report.error.code,'chain_mismatch');});
test('malformed envelopes, words, bools, offsets and empty precompile fail closed',async()=>{
 for(const change of [{badId:true},{rpcError:true},{code:'0x0'},{pqc:'0x'},{pqc:pqc().replace(/^0x.{64}/,'0x'+word(2))},{pqc:'0x'+word(1)+word(1)+word(64)+word(1)+word(2592)+KEY},
 {transform:(q,r)=>q.method==='eth_call'&&q.params[0].data===selector('maxPayments()')?'0x01':r}]){
  const {report}=await run(config(),change);assert.equal(report.status,'blocked');assert.equal(report.error.code,'invalid_response');
 }
});
test('code identity must match before any contract getter is trusted',async()=>{
 for(const hash of [undefined,'00'.repeat(32)]){const c=config();c.expectedRuntimeSha256=hash;const {report,calls}=await run(c);blocked(report,hash?'runtime_identity':'runtime_pin');assert.equal(calls.filter(q=>q.method==='eth_call').length,2);}
});
test('all policy getters are checked against reviewed policy and roles',async()=>{
 for(const field of Object.keys(fields).filter(k=>!['totalSpent','nextNonce'].includes(k))){
  const value=fields[field];const {report}=await run(config(),{fields:{[field]:typeof value==='string'?A:value+1n}});blocked(report,'policy');
 }
});
test('per-payment, total, count, nonce, balance, window and replay checks block unsafe proposals',async()=>{
 const cases=[{payment:{amountWei:'0'}},{payment:{amountWei:'1001'}},{payment:{nonce:'2'}},{payment:{recipient:E}},{payment:{invoiceId:'0x'+'00'.repeat(32)}},{payment:{validUntil:'1000'}},{change:{fields:{totalSpent:4950n}}},{change:{fields:{nextNonce:5n}}},{change:{balance:'0x1'}},{change:{paid:true}}];
 for(const entry of cases){const c=config();Object.assign(c.payment,entry.payment);const {report}=await run(c,entry.change);assert.equal(report.status,'blocked');blocked(report,'payment');}
 for(const [k,v] of [['startsAt','1001'],['endsAt','1000']]){const c=config();c.policy[k]=v;const {report}=await run(c,{fields:{[k]:BigInt(v)}});blocked(report,'payment');}
});
test('missing prerequisites are explicit, never filled from the chain',async()=>{
 const {report}=await run({});for(const id of ['contract_address','executor','invoice_issuer','runtime_pin','policy_configured','payment_configured','executor_key_pin','issuer_key_pin'])blocked(report,id);assert.equal(report.status,'blocked');
});
test('invalid or secret-bearing public config sends zero requests',async()=>{
 for(const c of [{...config(),privateKey:'never-read'},{...config(),contractAddress:'0x1'},{...config(),rpcUrl:'https://evil.invalid'}, {...config(),policy:{...policy,maxPayments:'01'}},{...config(),payment:{...config().payment,amountWei:100}}]){
  const {report,calls}=await run(c);assert.equal(calls.length,0);assert.equal(report.error.code,'invalid_configuration');
 }
});
test('reorganization, stale/future blocks, invalid quantities and changing chain stop safely',async()=>{
 for(const change of [{reorg:true},{transform:(q,r)=>q.method==='eth_getBlockByNumber'?{...r,timestamp:'0x1'}:r},{transform:(q,r)=>q.method==='eth_getBlockByNumber'?{...r,timestamp:'0xffff'}:r},{balance:'0x00'}]){
  const {report}=await run(config(),change);assert.equal(report.status,'blocked');assert.ok(report.error);
 }
 const f=fixture();let count=0;const fetch=async(u,i)=>{const r=await f.fetch(u,i);if(JSON.parse(i.body).method==='eth_chainId'&&++count===2)return Response.json({jsonrpc:'2.0',id:JSON.parse(i.body).id,result:'0x1'});return r;};
 assert.equal((await inspectDianaPaymentAccount(config(),{fetch,nowSeconds:()=>1000})).status,'blocked');
});
test('timeouts, HTTP errors and unreadable JSON return a blocked report',async()=>{
 for(const fetch of [async()=>new Response('',{status:503}),async()=>new Response('bad'),async()=>{throw new Error('offline')},()=>new Promise(()=>{})]){
  const report=await inspectDianaPaymentAccount(config(),{fetch,timeoutMs:5,nowSeconds:()=>1000});assert.equal(report.status,'blocked');assert.ok(report.error);
 }
});
import {parseReadinessArgs} from '../scripts/check-diana-payment-readiness.mjs';
test('operator CLI accepts only explicit public config/output and refuses execution flags',()=>{
 assert.deepEqual(parseReadinessArgs(['--config','public.json','--out','new.json']),{config:'public.json',out:'new.json'});
 assert.deepEqual(parseReadinessArgs(['--help']),{help:true});
 for(const args of [[],['--sign'],['--broadcast'],['--deploy'],['--private-key','never'],['--config'],['--config','a','--config','b']])assert.throws(()=>parseReadinessArgs(args));
});
test('public configuration is copied before asynchronous reads',async()=>{
 const c=config(),f=fixture();let changed=false;
 const fetch=async(u,i)=>{if(!changed){changed=true;c.executor=A;c.policy.maxPerPaymentWei='9999';c.payment.amountWei='9999';c.pqcKeySha256.invoiceIssuer='00'.repeat(32);}return f.fetch(u,i);};
 const report=await inspectDianaPaymentAccount(c,{fetch,nowSeconds:()=>1000});assert.equal(report.status,'ready_for_review');
});
test('a snapshot that becomes stale during reads cannot become ready',async()=>{
 const f=fixture();let nowCalls=0;
 const report=await inspectDianaPaymentAccount(config(),{fetch:f.fetch,nowSeconds:()=>++nowCalls===1?1000:1201});
 assert.equal(report.status,'blocked');assert.equal(report.error.code,'node_syncing');
});
test('large integer budget arithmetic remains exact above Number safe range',async()=>{
 const c=config();const max=9007199254740993n;
 c.policy.maxPerPaymentWei=max.toString();c.policy.spendingLimitWei=(max+1000n).toString();c.payment.amountWei=max.toString();
 const {report}=await run(c,{fields:{maxPerPayment:max,spendingLimit:max+1000n},balance:'0x'+max.toString(16)});
 assert.equal(report.status,'ready_for_review');assert.equal(report.observations.balanceWei,max.toString());
 c.payment.amountWei=(max+1n).toString();assert.equal((await run(c,{fields:{maxPerPayment:max,spendingLimit:max+1000n},balance:'0x'+(max+1n).toString(16)})).report.status,'blocked');
});

test('invoice expiry can exceed the policy window without widening that window',async()=>{
 const c=config();c.payment.validUntil='2001';const {report}=await run(c);
 assert.equal(report.status,'ready_for_review');
 c.policy.endsAt='1000';const {report:expired}=await run(c,{fields:{endsAt:1000n}});blocked(expired,'payment');
});
test('archived reports identify the validated public proposal and role configuration',async()=>{
 const c=config();const {report}=await run(c);assert.deepEqual(report.configuration,c);
 const second=config();second.payment.amountWei='101';const {report:other}=await run(second);
 assert.notDeepEqual(report.configuration.payment,other.configuration.payment);
 assert.equal(report.executionAuthorized,false);
});

test('hash-bound reads fail closed if the RPC cannot honor EIP-1898',async()=>{
 const f=fixture();const fetch=async(u,i)=>{
  const q=JSON.parse(i.body);
  if(['eth_call','eth_getCode','eth_getBalance'].includes(q.method)){
   assert.deepEqual(q.params[1],{blockHash:HASH,requireCanonical:true});
   return Response.json({jsonrpc:'2.0',id:q.id,error:{code:-32602,message:'blockHash unsupported'}});
  }
  return f.fetch(u,i);
 };
 const report=await inspectDianaPaymentAccount(config(),{fetch,nowSeconds:()=>1000});assert.equal(report.status,'blocked');assert.equal(report.error.code,'rpc_error');
});
