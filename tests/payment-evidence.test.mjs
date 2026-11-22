import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { verifyPayments } from '../src/payment/verify.ts';
import { keccak256 } from '../src/qorechain/keccak.ts';

const read = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const evidence = read('../src/payment/evidence.json');
const canonical = read('../docs/evidence/diana-live-20261121/final-chain-state.json');
const receipts = [0,1,2].map(i => read(`../docs/evidence/diana-live-20261121/payment-${i}-verification-final.json`).receipt);
const runtime = readFileSync(new URL('../docs/evidence/diana-live-20261121/verified-runtime.hex', import.meta.url),'utf8').trim();
const word = value => '0x' + BigInt(value).toString(16).padStart(64,'0');
const selectors = Object.fromEntries(Object.keys(evidence.policy).map(k => ['0x'+keccak256(new TextEncoder().encode(k+'()')).slice(0,8), k]));

function fixture(change = () => {}) {
  const calls = [];
  const fetch = async (url, init) => {
    assert.equal(String(url), 'https://evm-testnet.qore.host/');
    const {method,params,id} = JSON.parse(init.body); calls.push(method);
    let result;
    if(method === 'eth_chainId') result = '0x2648';
    else if(method === 'eth_getCode') result = runtime;
    else if(method === 'eth_getBalance') result = '0x0';
    else if(method === 'eth_call') result = word(evidence.policy[selectors[params[0].data]]);
    else if(method === 'eth_getTransactionReceipt') result = structuredClone(receipts.find(r=>r.transactionHash===params[0]));
    else if(method === 'eth_getBlockByNumber') {
      const p=evidence.payments.find(p=>'0x'+BigInt(p.blockNumber).toString(16)===params[0]);
      result=p?{number:params[0],hash:p.blockHash,timestamp:'0x'+p.confirmedAt.toString(16)}:
        {number:'0x'+BigInt(evidence.snapshot.number).toString(16),hash:evidence.snapshot.hash,timestamp:'0x'+BigInt(evidence.snapshot.timestamp).toString(16)};
    } else assert.fail('Unexpected method '+method);
    const response={jsonrpc:'2.0',id,result}; change(response,method,params);
    return Response.json(response);
  };
  return {fetch,calls};
}

test('browser archive exactly matches public final evidence, including order and clock difference',()=>{
  assert.deepEqual(evidence,canonical);
  assert.deepEqual(evidence.payments.map(p=>p.txHash),[
    '0x93ad86e777f5afef32f607336586d927c3ecda4d198c3ce3405ae2e5e624569b',
    '0x2ddba43246a070ab6a969ef6ca64d77be1755f4d0f2edc1b1d097ed71854d4a9',
    '0xdc549e462e1946f129d3e8dc800b857a22808f588afc464149827dec8ecb1e4b']);
  assert.equal(evidence.payments[1].sentAt-evidence.payments[1].confirmedAt,1);
});
test('fresh verification validates all three archived receipts/events and current snapshot with read-only calls',async()=>{
  const f=fixture();const r=await verifyPayments(f);
  assert.equal(r.balanceWei,'0');assert.equal(r.block,evidence.snapshot.number);
  assert.equal(f.calls.filter(m=>m==='eth_getTransactionReceipt').length,3);
  assert.ok(f.calls.every(m=>['eth_chainId','eth_getBlockByNumber','eth_call','eth_getBalance','eth_getCode','eth_getTransactionReceipt'].includes(m)));
});
for(const [name,change] of [
  ['wrong chain',(r,m)=>{if(m==='eth_chainId')r.result='0x2649';}],
  ['missing receipt',(r,m)=>{if(m==='eth_getTransactionReceipt')r.result=null;}],
  ['failed receipt',(r,m)=>{if(m==='eth_getTransactionReceipt')r.result.status='0x0';}],
  ['wrong hash',(r,m)=>{if(m==='eth_getTransactionReceipt')r.result.transactionHash='0x'+'0'.repeat(64);}],
  ['removed event',(r,m)=>{if(m==='eth_getTransactionReceipt')r.result.logs[0].removed=true;}],
  ['wrong event amount',(r,m)=>{if(m==='eth_getTransactionReceipt')r.result.logs[0].data=word('1');}],
  ['wrong invoice',(r,m)=>{if(m==='eth_getTransactionReceipt')r.result.logs[0].topics[3]='0x'+'0'.repeat(64);}],
  ['wrong recipient',(r,m)=>{if(m==='eth_getTransactionReceipt')r.result.logs[0].topics[2]=word('1');}],
  ['wrong event nonce',(r,m)=>{if(m==='eth_getTransactionReceipt')r.result.logs[0].topics[1]=word('9');}],
  ['changed runtime',(r,m)=>{if(m==='eth_getCode')r.result='0x6000';}],
  ['changed counters',(r,m)=>{if(m==='eth_call')r.result=word('0');}],
  ['noncanonical block',(r,m,p)=>{if(m==='eth_getBlockByNumber'&&p[0]!=='latest')r.result.hash='0x'+'0'.repeat(64);}],
]) test('no fresh success for '+name,async()=>{await assert.rejects(verifyPayments(fixture(change)));});
test('503 and CORS/network failures reject; archive remains unchanged',async()=>{
  const before=JSON.stringify(evidence);
  for(const fetch of [async()=>new Response('',{status:503}),async()=>{throw new TypeError('Failed to fetch');}])await assert.rejects(verifyPayments({fetch}));
  assert.equal(JSON.stringify(evidence),before);
});
test('a later donation is reported as a current balance, without rewriting historical zero',async()=>{
  const r=await verifyPayments(fixture((r,m)=>{if(m==='eth_getBalance')r.result='0x1';}));
  assert.equal(r.balanceWei,'1');assert.equal(evidence.balanceWei,'0');
});
