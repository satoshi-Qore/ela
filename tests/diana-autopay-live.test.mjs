import assert from 'node:assert/strict';import {test} from 'node:test';
import * as sdk from '@qorechain/sdk';
import {WINDOW_PLAN,windowParameterFailures} from '../prototypes/diana-payment-account/diana-window-prepare.mjs';
import {expectedWindowValue,windowMessage,windowMessageFailures} from '../prototypes/diana-payment-account/diana-window-open.mjs';
const contract='0x8a278cf5b0d34cf844cf19c74116e9ddfb7aba9d';
const plan={...WINDOW_PLAN,paymentRun:true,paymentContract:contract,maxTxs:3,allowedTargets:[contract],maxValueUqor:256500n};
test('autopay window is three transactions restricted to one contract without raising monetary ceiling',()=>{
 assert.deepEqual(windowParameterFailures(plan,{secondsPerBlock:1.43}),[]);
 assert.deepEqual(expectedWindowValue(plan).allowedTargets,[contract]);
 const message=sdk.qorechainRegistry().encodeAsAny(windowMessage(plan));assert.deepEqual(windowMessageFailures([message],plan),[]);
 for(const p of [{...plan,maxTxs:4},{...plan,allowedTargets:[]},{...plan,allowedTargets:[contract,WINDOW_PLAN.evm]},{...plan,paymentContract:WINDOW_PLAN.evm},{...plan,paymentRun:false}])assert.ok(windowParameterFailures(p,{secondsPerBlock:1.43}).length);
});
import {invoiceDigest,paymentFieldsValid,paymentEvent,PAYMENT_AMOUNT} from '../prototypes/diana-payment-account/diana-autopay-live.mjs';
import {parseAbi,encodeEventTopics,encodeAbiParameters} from 'viem';
import {saveState,loadState,acquireLock} from '../prototypes/diana-payment-account/diana-autopay.mjs';
import {createSchedule} from '../prototypes/diana-payment-account/diana-scheduler.mjs';
import {mkdtempSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const id='0x'+'12'.repeat(32),until=1795206600;
test('invoice digest is bound to unique invoice, nonce, contract and validity',()=>{
 const d=invoiceDigest(contract,id,0,until);assert.match(d,/^0x[0-9a-f]{64}$/);
 for(const digest of [invoiceDigest(contract,'0x'+'13'.repeat(32),0,until),invoiceDigest(contract,id,1,until),invoiceDigest(WINDOW_PLAN.evm,id,0,until),invoiceDigest(contract,id,0,until-1)])assert.notEqual(digest,d);
});
test('signed payment envelope cannot change target, value, chain, calldata or gas budget',()=>{
 const t={type:'eip1559',chainId:9800,nonce:7,to:contract,value:0n,data:'0x1234',gas:300000n,maxFeePerGas:150000000000n,maxPriorityFeePerGas:12500000000n,accessList:[]};
 assert.equal(paymentFieldsValid(t,t),true);
 for(const change of [{to:WINDOW_PLAN.evm},{value:1n},{chainId:1},{nonce:8},{data:'0x'},{gas:570001n},{maxFeePerGas:151000000000n},{maxPriorityFeePerGas:0n},{accessList:[{}]},{authorizationList:[]}])assert.equal(paymentFieldsValid({...t,...change},t),false);
});
test('receipt event must prove exact nonce, invoice, recipient and amount',()=>{
 const abi=parseAbi(['event PaymentExecuted(uint256 indexed nonce,address indexed recipient,bytes32 indexed invoiceId,uint256 amount)']);
 const topics=encodeEventTopics({abi,eventName:'PaymentExecuted',args:{nonce:0n,recipient:'0xc9ab55fec7c1fee27f3afc5df99e6a09b4b2d875',invoiceId:id}});
 const r={logs:[{address:contract,topics,data:encodeAbiParameters([{type:'uint256'}],[PAYMENT_AMOUNT])}]};
 assert.equal(paymentEvent(r,contract,{nonce:0,invoiceId:id}).amount,String(PAYMENT_AMOUNT));
 assert.throws(()=>paymentEvent(r,contract,{nonce:1,invoiceId:id}));
 assert.throws(()=>paymentEvent({...r,logs:[...r.logs,...r.logs]},contract,{nonce:0,invoiceId:id}));
});
test('durable journal survives stale state file and exclusive lock rejects a second worker',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ela-autopay-test-')),path=join(dir,'state.json');
 const s=createSchedule({contractAddress:contract,runtimeSha256:'12'.repeat(32),startLocal:'2026-11-20 23:25:00',startsAt:1795203000,endsAt:1795206600});
 saveState(path,s);s.payments[0].status='uncertain';s.payments[0].txHash='0x'+'34'.repeat(32);s.payments[0].tx={nonce:7};saveState(path,s);
 writeFileSync(path,'interrupted replacement');assert.equal(loadState(path).payments[0].status,'uncertain');
 const release=acquireLock(path);assert.throws(()=>acquireLock(path),/already running/);release();const release2=acquireLock(path);release2();
});
import {unconfirmedStatus} from '../prototypes/diana-payment-account/diana-autopay-live.mjs';
test('indexing lag only permits bounded read-only reconciliation, never a resend',()=>{
 assert.equal(unconfirmedStatus(null,1000,1001),'pending');assert.equal(unconfirmedStatus(null,1000,1120),'unknown');assert.equal(unconfirmedStatus(null,undefined,1000),'unknown');assert.equal(unconfirmedStatus({hash:id},1000,1200),'pending');
});
import {windowIntent,SIGNING_LIMITS} from '../prototypes/diana-payment-account/diana-window-open.mjs';
test('three-use window needs explicit bounded limits and cannot inherit the one-use default',()=>{
 const r={mode:'prepare',signed:false,broadcast:false,chainId:plan.chainId,evmChainId:9800,account:plan.native,evmAccount:plan.evm,accountNumber:plan.accountNumber,sequence:plan.sequence,evmNonce:plan.sequence,pqcPublicKeySha256:plan.pqcPublicKeySha256,signBytesVersion:plan.signBytesVersion,unitsConsistent:true,existingWindow:{live:false},window:{typeUrl:'/qorechain.pqc.v1.MsgOpenEVMWindow',sender:plan.native,blocks:'400',maxTxs:'3',maxValueUqor:'256500',nativeOnly:false,allowedTargets:[contract]},cosmosTx:{gasFitsWithHeadroom:true,feeCeiling:'52500uqor'},deployment:{maxCostWei:'256500000000000000'}};
 assert.throws(()=>windowIntent(r,plan));
 assert.equal(windowIntent(r,plan,{...SIGNING_LIMITS,maxTxs:3}).plan.maxTxs,3);
 assert.throws(()=>windowIntent({...r,window:{...r.window,allowedTargets:[]}},plan,{...SIGNING_LIMITS,maxTxs:3}));
});
import {appendFileSync,readdirSync} from 'node:fs';
test('restart preserves a torn journal tail and can durably continue without corruption',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ela-autopay-torn-')),path=join(dir,'state.json');
 const s=createSchedule({contractAddress:contract,runtimeSha256:'12'.repeat(32),startLocal:'2026-11-20 23:25:00',startsAt:1795203000,endsAt:1795206600});
 saveState(path,s);appendFileSync(path+'.journal','{"interrupted":');const resumed=loadState(path);saveState(path,resumed);
 assert.equal(loadState(path).persistenceSequence,2);assert.ok(readdirSync(dir).some(x=>x.includes('journal.interrupted-')));
});
import {serializeTransaction,parseTransaction} from 'viem';
test('canonical zero-value EIP1559 decoding omits value and remains a zero-value call',()=>{
 const t={type:'eip1559',chainId:9800,nonce:7,to:contract,value:0n,data:'0x1234',gas:300000n,maxFeePerGas:150000000000n,maxPriorityFeePerGas:12500000000n,accessList:[]};
 const parsed=parseTransaction(serializeTransaction(t));assert.equal(paymentFieldsValid(parsed,t),true);assert.equal(paymentFieldsValid({...parsed,value:1n},t),false);
});
import {readPaymentReceiptPair} from '../prototypes/diana-payment-account/diana-autopay-live.mjs';
test('receipt is read before transaction identity so inclusion between reads cannot fabricate a mismatch',async()=>{
 let committed=false;const order=[];const hash='0x'+'ab'.repeat(32);const pair=await readPaymentReceiptPair(async(method)=>{order.push(method);if(method==='eth_getTransactionReceipt'){committed=true;return {transactionHash:hash,blockHash:'0xblock'};}return {hash,blockHash:committed?'0xblock':null};},hash);
 assert.deepEqual(order,['eth_getTransactionReceipt','eth_getTransactionByHash']);assert.equal(pair.receipt.blockHash,pair.tx.blockHash);
});
