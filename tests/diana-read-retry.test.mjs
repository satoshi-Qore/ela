import assert from 'node:assert/strict';import {test} from 'node:test';
import {withDianaReadRetries} from '../prototypes/diana-payment-account/diana-read-retry.mjs';
import {parseArgs} from '../prototypes/diana-payment-account/diana-window-open.mjs';
test('503 read retries are bounded; read success proceeds; no write is retried',async()=>{
 let reads=0;const read=withDianaReadRetries(async()=>new Response('{}',{status:++reads<3?503:200}),{sleep:async()=>{}});assert.equal((await read('https://api-testnet.qore.host/x')).status,200);assert.equal(reads,3);
 for(const body of [JSON.stringify({method:'eth_sendRawTransaction'}),'cosmos broadcast']){let count=0;const f=withDianaReadRetries(async()=>{count++;return new Response('{}',{status:503});},{sleep:async()=>{}});await f('https://evm-testnet.qore.host/',{method:'POST',body});assert.equal(count,1);}
 let count=0;const exhausted=withDianaReadRetries(async()=>{count++;return new Response('{}',{status:503});},{sleep:async()=>{}});assert.equal((await exhausted('https://api-testnet.qore.host/x')).status,503);assert.equal(count,3);
});
test('JSON RPC read retries do not apply to unknown methods or validation errors',async()=>{
 for(const [method,want] of [['eth_call',3],['eth_getTransactionReceipt',3],['personal_sign',1]]){let count=0;const f=withDianaReadRetries(async()=>{count++;return new Response('{}',{status:503});},{sleep:async()=>{}});await f('https://evm-testnet.qore.host/',{method:'POST',body:JSON.stringify({method})});assert.equal(count,want);}
 let count=0;const invalid=withDianaReadRetries(async()=>{count++;return new Response('{}',{status:400});},{sleep:async()=>{}});await invalid('https://api-testnet.qore.host/x');assert.equal(count,1);
});
test('explicit window sequence remains a checked constructor input, not a nonce bypass',()=>{
 assert.deepEqual(parseArgs(['--broadcast','--sequence','7']),{mode:'broadcast',sequence:'7'});assert.throws(()=>parseArgs(['--broadcast','--sequence','-1']));assert.deepEqual(parseArgs(['--broadcast']),{mode:'broadcast'});
});
test('Cosmos broadcast and lost write response are never replayed by the read retry layer',async()=>{
 let writes=0;const f=withDianaReadRetries(async()=>{writes++;return new Response('{}',{status:503});},{sleep:async()=>{}});await f('https://api-testnet.qore.host/cosmos/tx/v1beta1/txs',{method:'POST',body:JSON.stringify({tx_bytes:'not-sent',mode:'BROADCAST_MODE_SYNC'})});assert.equal(writes,1);
 let lost=0;const g=withDianaReadRetries(async()=>{lost++;throw new TypeError('connection lost');},{sleep:async()=>{}});await assert.rejects(()=>g('https://evm-testnet.qore.host/',{method:'POST',body:JSON.stringify({method:'eth_sendRawTransaction'})}));assert.equal(lost,1);
});
