import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { evaluatePayment } from '../src/decision/engine.ts';
import { archivedPolicy, explainHistoricalPayment } from '../src/decision/history.ts';

const policy={...archivedPolicy,startsAt:1000,endsAt:2000};
const base=()=>({mode:'current',at:1500,observedAt:1500,source:'verified fixture',block:'100',evidence:'verified',facts:{
  chainId:9800,contract:policy.contract,recipient:policy.recipient,amount:'1000000000000000',nonce:'0',nextNonce:'0',
  invoiceId:'0x'+'a'.repeat(64),invoicePaid:false,totalSpent:'0',balance:'3000000000000000',previous:'none'}});
test('ALLOW requires all explicit rules, never grants authority, is deterministic and immutable',()=>{
  const input=base(),copy=structuredClone(input);const r=evaluatePayment(input,policy);
  assert.equal(r.outcome,'ALLOW');assert.equal(r.decisive,'all_checks');assert.equal(r.executionAuthorized,false);
  assert.deepEqual(r,evaluatePayment(input,policy));assert.deepEqual(input,copy);
  assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.checks)&&r.checks.every(Object.isFrozen));
});
const scenarios=[
  ['wrong chain','BLOCK','network',i=>{i.facts.chainId=9801;}],
  ['wrong contract','BLOCK','contract',i=>{i.facts.contract='0x'+'1'.repeat(40);}],
  ['wrong recipient','BLOCK','recipient',i=>{i.facts.recipient='0x'+'1'.repeat(40);}],
  ['before window','WAIT','window',i=>{i.at=i.observedAt=999;}],
  ['expired at exclusive end','BLOCK','window',i=>{i.at=i.observedAt=2000;}],
  ['per-payment cap','BLOCK','per_payment',i=>{i.facts.amount='1000000000000001';}],
  ['zero payment','BLOCK','per_payment',i=>{i.facts.amount='0';}],
  ['total cap','BLOCK','total',i=>{Object.assign(i.facts,{totalSpent:'2500000000000000',nextNonce:'3',nonce:'3',previous:'confirmed'});}],
  ['insufficient balance','BLOCK','balance',i=>{i.facts.balance='999999999999999';}],
  ['consumed nonce','BLOCK','nonce',i=>{Object.assign(i.facts,{nextNonce:'1',totalSpent:'1000000000000000',previous:'confirmed'});}],
  ['future nonce','WAIT','nonce',i=>{i.facts.nonce='1';}],
  ['paid invoice with a fresh nonce','BLOCK','invoice',i=>{Object.assign(i.facts,{nonce:'1',nextNonce:'1',totalSpent:'1000000000000000',previous:'confirmed',invoicePaid:true});}],
  ['pending predecessor','WAIT','previous',i=>{i.facts.previous='pending';}],
  ['unknown predecessor','UNKNOWN','previous',i=>{i.facts.previous='unknown';}],
  ['failed predecessor','BLOCK','previous',i=>{i.facts.previous='failed';}],
  ['RPC unavailable','WAIT','evidence',i=>{i.evidence='rpc_unavailable';}],
  ['timeout','WAIT','timeout',i=>{i.evidence='timeout';}],
  ['missing evidence','UNKNOWN','evidence',i=>{i.evidence='missing';}],
  ['contradictory evidence','UNKNOWN','evidence',i=>{i.evidence='conflicting';}],
  ['missing balance','UNKNOWN','data',i=>{delete i.facts.balance;}],
  ['negative uint','UNKNOWN','data',i=>{i.facts.amount='-1';}],
  ['uint overflow','UNKNOWN','data',i=>{i.facts.amount=(1n<<256n).toString();}],
  ['fractional time','UNKNOWN','provenance',i=>{i.at=1500.5;}],
  ['future observation','UNKNOWN','provenance',i=>{i.observedAt=1501;}],
  ['stale evidence','WAIT','freshness',i=>{i.observedAt=1439;}],
  ['conflicting counter','UNKNOWN','consistency',i=>{i.facts.totalSpent='1';}],
  ['conflicting paid invoice','UNKNOWN','consistency',i=>{i.facts.invoicePaid=true;}],
  ['moved historical clock','UNKNOWN','provenance',i=>{i.mode='historical';i.observedAt=1499;}],
];
for(const [name,outcome,decisive,change] of scenarios)test(name,()=>{
  const i=base();change(i);const r=evaluatePayment(i,policy);assert.equal(r.outcome,outcome);assert.equal(r.decisive,decisive);assert.equal(r.executionAuthorized,false);
});
test('start, exact limits, exact balance and freshness boundary pass',()=>{
  const i=base();i.at=i.observedAt=1000;i.facts.balance=i.facts.amount;assert.equal(evaluatePayment(i,policy).outcome,'ALLOW');
  i.at=1060;assert.equal(evaluatePayment(i,policy).outcome,'ALLOW');
});
test('invalid policy and contradictory known denial never allow',()=>{
  assert.equal(evaluatePayment(base(),{...policy,endsAt:1000}).outcome,'UNKNOWN');
  const i=base();i.facts.balance='0';i.facts.previous='pending';assert.equal(evaluatePayment(i,policy).outcome,'BLOCK');
});
test('all three real histories use post-receipt balances, nonce and clock, and block replay',()=>{
  const evidence=JSON.parse(readFileSync(new URL('../src/payment/evidence.json',import.meta.url),'utf8'));
  for(let n=0;n<3;n++){
    const p=evidence.payments[n],h=explainHistoricalPayment(n),r=h.result;
    assert.equal(r.mode,'historical');assert.equal(r.outcome,'BLOCK');assert.equal(r.decisive,n===2?'total':'nonce');
    assert.equal(r.at,p.confirmedAt);assert.equal(h.txHash,p.txHash);
    for(const [id,actual] of [['balance',p.balanceWei],['nonce',p.event.nonce],['invoice','true']])assert.equal(r.checks.find(c=>c.id===id).actual,actual);
    assert.equal(r.checks.find(c=>c.id==='invoice').status,'block');
    assert.equal(r.executionAuthorized,false);
  }
  assert.throws(()=>explainHistoricalPayment(3));
});
test('pure engine has no IO, hidden clock, execution dependency or model',()=>{
  const code=readFileSync(new URL('../src/decision/engine.ts',import.meta.url),'utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'');
  for(const marker of ['import ','fetch(', 'Date.', 'new Date', 'localStorage','sign(', 'setTimeout','process.','Math.random','session','registry'])assert.equal(code.includes(marker),false,marker);
});
