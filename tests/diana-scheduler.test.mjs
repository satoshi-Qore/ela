import test from 'node:test';
import assert from 'node:assert/strict';
import { createSchedule, runSchedule } from '../prototypes/diana-payment-account/diana-scheduler.mjs';

const options = {contractAddress:'0x'+'a'.repeat(40),runtimeSha256:'a'.repeat(64),startLocal:'2026-11-20 23:00:00',startsAt:1795204800,endsAt:1795215600};
const make = () => createSchedule(options);
function harness(state, overrides={}) {
  let time=state.payments[0].targetAt-10, nonce=0, spent=0n;
  const saved=[],sent=[];
  const adapter={
    inspect:async()=>({nextNonce:nonce,totalSpent:String(spent),balanceWei:'3000000000000000',startsAt:state.startsAt,endsAt:state.endsAt,chainTimestamp:time}),
    ensureWindow:async()=>{},
    sendPayment:async(s,p,checkpoint)=>{await checkpoint({txHash:'0x'+String(p.index+1).repeat(64),tx:{nonce:p.nonce},sentAt:time});sent.push({index:p.index,time});nonce++;spent+=1000000000000000n;},
    reconcile:async(s,p)=>({status:'confirmed',txHash:p.txHash,confirmedAt:time}),
    ...overrides,
  };
  return {adapter,sent,saved,now:()=>time,sleep:async ms=>{time+=ms/1000;},save:async s=>saved.push(structuredClone(s)),setTime:t=>{time=t;},setChain:(n)=>{nonce=n;spent=BigInt(n)*1000000000000000n;}};
}
test('creates exactly three stable unique invoices sixty seconds apart',()=>{
 const s=make(); assert.equal(s.payments.length,3);assert.deepEqual(s.payments.map(p=>p.nonce),[0,1,2]);assert.equal(new Set(s.payments.map(p=>p.invoiceId)).size,3);assert.equal(s.payments[2].targetAt-s.payments[0].targetAt,120);assert.deepEqual(JSON.parse(JSON.stringify(s)),s);
 assert.throws(()=>createSchedule({...options,startLocal:'2026-02-30 23:00:00'}));assert.throws(()=>createSchedule({...options,endsAt:s.payments[2].targetAt}));
});
test('executes only at targets and restart never resends confirmed payments',async()=>{
 const s=make(),h=harness(s);await runSchedule(s,h);assert.equal(s.status,'complete');assert.deepEqual(h.sent.map(x=>x.time),s.payments.map(p=>p.targetAt));await runSchedule(s,h);assert.equal(h.sent.length,3);
});
test('crash after durable checkpoint reconciles without sending twice',async()=>{
 const s=make(),h=harness(s,{sendPayment:async(s,p,checkpoint)=>{await checkpoint({txHash:'0x'+'1'.repeat(64),tx:{nonce:0},sentAt:h.now()});throw Error('crash');}});
 await runSchedule(s,h);assert.equal(s.payments[0].status,'uncertain');assert.equal(h.saved.find(x=>x.payments[0].txHash)?.payments[0].status,'uncertain');
 s.status='running';h.setChain(1);h.adapter.sendPayment=async(s,p,cp)=>{await cp({txHash:'0x'+String(p.index+1).repeat(64),tx:{nonce:p.nonce},sentAt:h.now()});h.sent.push(p.index);h.setChain(p.index+1);};await runSchedule(s,h);assert.equal(s.status,'complete');assert.deepEqual(h.sent,[1,2]);
});
for(const status of ['unknown','failed']) test(`${status} reconciliation blocks later payments`,async()=>{
 const s=make(),h=harness(s,{reconcile:async()=>({status})});await runSchedule(s,h);assert.equal(s.status,'blocked');assert.equal(h.sent.length,1);await runSchedule(s,h);assert.equal(h.sent.length,1);
});
test('expiry and unexpected nonce prevent send',async()=>{
 for(const mode of ['expiry','nonce']){const s=make(),h=harness(s);if(mode==='expiry')h.setTime(s.endsAt);else h.setChain(1);await runSchedule(s,h);assert.equal(s.status,'blocked');assert.equal(h.sent.length,0);}
});
test('pending confirmation delays next payment without losing sequential order',async()=>{
 const s=make();let polls=0;const h=harness(s,{reconcile:async(s,p)=>{if(p.index===0&&polls++<75)return {status:'pending'};return {status:'confirmed',confirmedAt:h.now(),txHash:p.txHash};}});await runSchedule(s,h);assert.equal(s.status,'complete');assert.equal(h.sent[1].time,s.payments[0].targetAt+75);assert.ok(h.sent[1].time>=s.payments[1].targetAt);
});
test('restart audits confirmed history before any new send',async()=>{
 const s=make(),h=harness(s);s.payments[0].status='confirmed';s.payments[0].txHash='0x'+'1'.repeat(64);h.setChain(1);h.adapter.reconcile=async()=>({status:'unknown'});await runSchedule(s,h);assert.equal(s.status,'blocked');assert.equal(h.sent.length,0);
});
test('durable uncertain intent is reconciled without rebroadcast',async()=>{
 const s=make(),h=harness(s);s.payments[0].status='uncertain';s.payments[0].txHash='0x'+'1'.repeat(64);h.adapter.reconcile=async()=>({status:'unknown'});await runSchedule(s,h);assert.equal(s.status,'blocked');assert.equal(h.sent.length,0);
});
test('failed durable write prevents broadcast',async()=>{
 const s=make(),h=harness(s);let broadcasts=0;h.adapter.sendPayment=async(s,p,cp)=>{await cp({txHash:'0x'+'1'.repeat(64),tx:{nonce:0}});broadcasts++;};h.save=async state=>{if(state.payments[0].status==='uncertain')throw Error('disk unavailable');};await assert.rejects(runSchedule(s,h),/disk unavailable/);assert.equal(broadcasts,0);
});
test('invalid schedule mutation is rejected before any adapter call',async()=>{
 const s=make(),h=harness(s);s.payments[1].nonce=2;await assert.rejects(runSchedule(s,h),/Invalid payment plan/);assert.equal(h.sent.length,0);
});
test('persisted invoice and identity changes cannot silently alter approved plan',async()=>{
 for(const mutate of [s=>{s.payments[0].invoiceId='0x'+'f'.repeat(64);},s=>{s.contractAddress='0x'+'b'.repeat(40);},s=>{s.runId='other';}]){
 const s=make(),h=harness(s);mutate(s);await assert.rejects(runSchedule(s,h),/plan binding/);assert.equal(h.sent.length,0);
 }
});
test('late initial preparation cannot compress subsequent sends below sixty seconds',async()=>{
 const s=make(),h=harness(s);let first=true;const base=h.adapter.sendPayment;
 h.adapter.sendPayment=async(s,p,cp)=>{if(first){h.setTime(h.now()+70);first=false;}await base(s,p,cp);};
 await runSchedule(s,h);assert.equal(s.status,'complete');assert.ok(h.sent[1].time-h.sent[0].time>=60);assert.ok(h.sent[2].time-h.sent[1].time>=60);
});
test('insufficient remaining lifetime for all sixty-second intervals blocks before sending',async()=>{
 const s=make(),h=harness(s);h.setTime(s.endsAt-100);await runSchedule(s,h);assert.equal(s.status,'blocked');assert.equal(h.sent.length,0);
});
