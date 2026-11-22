import {withDianaReadRetries} from './diana-read-retry.mjs';
const readFetch=withDianaReadRetries();
// Live adapter for the bounded three-payment scheduler. No timers, UI or model routing here.
import {createHash} from 'node:crypto';
import * as sdk from '@qorechain/sdk';
import {parseAbi,encodeAbiParameters,encodeFunctionData,decodeEventLog,keccak256,hexToBytes,toHex,parseTransaction,recoverTransactionAddress} from 'viem';
import {parseEvmWindow} from '@qorechain/evm/window';
import {createDianaPaymentReader} from '../../src/qorechain/diana-payment-reader.ts';
import {DEPLOY_PLAN,dianaDeployNetwork,signDeployment,broadcastOnce,loadDeployArtifact,expectedRuntimeCode} from './diana-deploy.mjs';
import {fetchLiveState,prepareFailures,classicalKeyHex} from './diana-hybrid-prepare.mjs';
import {WINDOW_PLAN,fetchEvmState,verifiedBankBalance} from './diana-window-prepare.mjs';
import {runWindowBroadcast,dianaWindowNetwork,verifyOpenedWindow,SIGNING_LIMITS} from './diana-window-open.mjs';
import {readParsedRecord} from './diana-hybrid-sign.mjs';
import {withVerifiedAccount} from './diana-canonical-pqc.mjs';
import {APPROVED_PAYMENT_POLICY} from './approved-payment-policy.mjs';
import {INVOICE_OWNER,RECORD_PATH,readRecordBytes} from './diana-verify-recovery.mjs';

export const PAYMENT_AMOUNT=1000000000000000n;
export const PAYMENT_RECIPIENT='0xc9ab55fec7c1fee27f3afc5df99e6a09b4b2d875';
export const PAYMENT_GAS_CAP=570000n; // Three caps together <= the original 1710000-gas envelope.
const FEE_CAP=150000000000n,PRIORITY=12500000000n;
const ABI=parseAbi(['function invoiceDigest(address,uint256,bytes32,uint256,uint256) view returns (bytes32)',
  'function pay(address,uint256,uint256,bytes32,uint256,bytes)',
  'function nextNonce() view returns (uint256)','function totalSpent() view returns (uint256)',
  'function paidInvoices(bytes32) view returns (bool)',
  'event PaymentExecuted(uint256 indexed nonce,address indexed recipient,bytes32 indexed invoiceId,uint256 amount)']);
const TYPEHASH=keccak256(toHex('DianaInvoiceV1(uint256 chainId,address account,address issuer,address recipient,uint256 amount,bytes32 invoiceId,uint256 nonce,uint256 validUntil)'));
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const hashCode=code=>createHash('sha256').update(Buffer.from(code.slice(2),'hex')).digest('hex');
const plain=value=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
export function invoiceDigest(contract,invoiceId,nonce,validUntil){
  return keccak256(encodeAbiParameters([{type:'bytes32'},{type:'uint256'},{type:'address'},{type:'address'},{type:'address'},{type:'uint256'},{type:'bytes32'},{type:'uint256'},{type:'uint256'}],
    [TYPEHASH,9800n,contract,INVOICE_OWNER.evm,PAYMENT_RECIPIENT,PAYMENT_AMOUNT,invoiceId,BigInt(nonce),BigInt(validUntil)]));
}
export function paymentFieldsValid(tx,expected){
  return tx.type==='eip1559'&&tx.chainId===9800&&same(tx.to,expected.to)&&(tx.value??0n)===0n&&tx.nonce===expected.nonce&&Number.isSafeInteger(tx.nonce)&&tx.nonce>=0
    &&tx.data===expected.data&&tx.gas===expected.gas&&tx.gas>0n&&tx.gas<=PAYMENT_GAS_CAP
    &&tx.maxFeePerGas===FEE_CAP&&tx.maxPriorityFeePerGas===PRIORITY&&(tx.accessList??[]).length===0&&tx.authorizationList===undefined;
}
export function paymentEvent(receipt,contract,payment){
  const logs=(receipt.logs??[]).filter(l=>same(l.address,contract));
  if(logs.length!==1)throw Error('Expected exactly one contract payment event');
  const event=decodeEventLog({abi:ABI,data:logs[0].data,topics:logs[0].topics,strict:true});
  const a=event.args;
  if(event.eventName!=='PaymentExecuted'||a.nonce!==BigInt(payment.nonce)||!same(a.recipient,PAYMENT_RECIPIENT)
    ||a.invoiceId!==payment.invoiceId||a.amount!==PAYMENT_AMOUNT)throw Error('Payment event mismatch');
  return plain(a);
}

// Directed calls are read-only, bound to the authorized contract and SDK-pinned Diana endpoint.
// The existing deployment network guard and all ELA RPC permissions remain unchanged.
async function callRead(state,method,params){
  if(!['eth_call','eth_getBlockByNumber'].includes(method))throw Error('Read method denied');
  if(method==='eth_call'&&!same(params[0]?.to,state.contractAddress))throw Error('Read target denied');
  const r=await(await readFetch(sdk.NETWORKS.testnet.endpoints.evmRpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),redirect:'error',credentials:'omit',signal:AbortSignal.timeout(15000)})).json();
  if(r.jsonrpc!=='2.0'||r.id!==1||r.error||!('result'in r))throw Error('Directed read failed');return r.result;
}
async function rpc(network,method,params){
  const r=await(await network.fetch(network.evmRpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(15000)})).json();
  if(r.error||r.jsonrpc!=='2.0'||r.id!==1||!('result'in r))throw Error('Diana RPC failed');return r.result;
}
export async function readPaymentReceiptPair(read,hash){
  const receipt=await read('eth_getTransactionReceipt',[hash]);
  const tx=await read('eth_getTransactionByHash',[hash]);
  return {receipt,tx};
}
export function unconfirmedStatus(transaction,sentAt,currentTime){
  // Diana indexing may lag mempool acceptance. Wait read-only for a bounded interval.
  return transaction||(Number.isFinite(Number(sentAt))&&currentTime-Number(sentAt)>=0&&currentTime-Number(sentAt)<120)?'pending':'unknown';
}
export function createLiveAdapter({log=()=>{},now=()=>Math.floor(Date.now()/1000)}={}){
  async function inspect(state){
    const reader=await createDianaPaymentReader({fetch:readFetch});
    const code=await reader.code(state.contractAddress),policy=await reader.policy(state.contractAddress),balanceWei=await reader.balance(state.contractAddress);
    const pqc=await reader.pqc(INVOICE_OWNER.evm);await reader.finish();
    const expected=expectedRuntimeCode(loadDeployArtifact(),{...APPROVED_PAYMENT_POLICY.parameters,startsAt:BigInt(state.startsAt),endsAt:BigInt(state.endsAt)});
    if(hashCode(code)!==state.runtimeSha256.replace(/^0x/,'')||code.toLowerCase()!==expected.toLowerCase())throw Error('Runtime pin/artifact mismatch');
    if(!same(policy.executor,INVOICE_OWNER.evm)||!same(policy.invoiceIssuer,INVOICE_OWNER.evm)||!same(policy.recipient,PAYMENT_RECIPIENT)
      ||BigInt(policy.maxPerPayment)!==PAYMENT_AMOUNT||BigInt(policy.spendingLimit)!==3n*PAYMENT_AMOUNT||BigInt(policy.maxPayments)!==3n
      ||Number(policy.startsAt)!==state.startsAt||Number(policy.endsAt)!==state.endsAt)throw Error('Payment policy mismatch');
    if(!pqc.registered||!pqc.possessionProven||pqc.algorithmId!==1||pqc.publicKeyBytes!==2592||pqc.keySha256!==DEPLOY_PLAN.pqcPublicKeySha256)throw Error('Invoice Owner PQC not attested');
    return {...policy,balanceWei,chainTimestamp:reader.snapshot.timestamp,snapshot:reader.snapshot};
  }
  async function sender(network){
    const live=await fetchLiveState(INVOICE_OWNER.native,network),evm=await fetchEvmState(DEPLOY_PLAN,network);
    await verifiedBankBalance(network,DEPLOY_PLAN,evm,live.uqor);
    if(prepareFailures(live,{...WINDOW_PLAN,sequence:evm.nonce,amount:'0'}).length
      ||BigInt(await rpc(network,'eth_getTransactionCount',[INVOICE_OWNER.evm,'pending']))!==BigInt(evm.nonce)
      ||evm.gasPriceWei>FEE_CAP||evm.baseFeeWei===undefined||evm.baseFeeWei>FEE_CAP)throw Error('Sender/network/PQC/nonce/fee guard failed');
    return {live,evm,key:classicalKeyHex(live,DEPLOY_PLAN)};
  }
  function assertWindow(evm,state,index){
    const w=parseEvmWindow(evm.window),record=state.payments[0].windowCheckpoint;
    if(!record||record.phase!=='verified'||!w.found||!w.live||w.remainingBlocks<30n||w.maxTxs!==3n||w.maxValue>256500n
      ||w.usedTxs!==BigInt(index)||w.remainingTxs!==BigInt(3-index)||w.nativeOnly||w.allowedTargets.length!==1
      ||!same(w.allowedTargets[0],state.contractAddress)||w.openedHeight.toString()!==record.verification.window.openedHeight)throw Error('Scoped payment window is not the attested unused remainder');
    return w;
  }
  async function ensureWindow(state,payment,checkpoint){
    const policy=await inspect(state);
    if(now()>=state.endsAt||Number(policy.chainTimestamp)>=state.endsAt)throw Error('Payment policy expired');
    const network=dianaDeployNetwork(),{evm}=await sender(network);
    let stored=state.payments[0].windowCheckpoint;
    if(stored?.phase==='verified'){assertWindow(evm,state,payment.index);return;}
    if(payment.index!==0)throw Error('Missing original payment window journal');
    const persist=async data=>{await checkpoint(data);stored=data;};
    if(stored?.phase==='uncertain'){
      // Only read; never create another window when the prior broadcast is ambiguous.
      const verification=await verifyOpenedWindow({network:dianaWindowNetwork(),txHash:stored.txHash,plan:stored.plan,limits:{...SIGNING_LIMITS,maxTxs:3},before:stored.balanceBeforeUqor});
      if(!verification.verified)throw Error('Window attempt cannot be verified; no retry');
      await persist({...stored,phase:'verified',verification});return;
    }
    if(evm.window?.live===true)throw Error('An unrelated window is still live');
    const plan={...WINDOW_PLAN,sequence:evm.nonce,paymentRun:true,paymentContract:state.contractAddress.toLowerCase(),maxTxs:3,allowedTargets:[state.contractAddress.toLowerCase()]};
    let latest;
    const result=await runWindowBroadcast({network:dianaWindowNetwork(),plan,limits:{...SIGNING_LIMITS,maxTxs:3},readRecord:()=>readRecordBytes(RECORD_PATH),
      write:r=>{latest=r;log({type:'window-phase',signed:r.signed,broadcast:r.broadcast,txHash:r.txHash,feeCeiling:r.feeCeiling});},
      confirm:async phrase=>{
        if(now()>=state.endsAt)throw Error('Policy expired before window authorization');
        if(phrase.startsWith('BROADCAST EVM WINDOW ')){
          if(!latest?.txHash||latest.formatCheck!=='pass'||latest.simulation!=='ok')throw Error('Window checks incomplete');
          await persist({phase:'uncertain',txHash:latest.txHash,plan,balanceBeforeUqor:latest.uqorBalance});
        }else if(!phrase.startsWith('SIGN EVM WINDOW 400 BLOCKS 3 TX 256500 UQOR FOR 16046'))throw Error('Unexpected window authorization');
        return phrase;
      }});
    if(result.broadcast!=='ACCEPTED')throw Error('Window broadcast not confirmed');
    let verification;
    for(let i=0;i<12;i++){
      try{verification=await verifyOpenedWindow({network:dianaWindowNetwork(),txHash:result.txHash,plan,limits:{...SIGNING_LIMITS,maxTxs:3},before:stored.balanceBeforeUqor});if(verification.verified)break;}catch{}
      await wait(1000);
    }
    if(!verification?.verified)throw Error('Window verification pending; read-only resume required');
    await persist({...stored,phase:'verified',verification});
  }
  async function sendPayment(state,payment,checkpoint){
    const initial=await inspect(state);
    if(Number(initial.nextNonce)!==payment.nonce||BigInt(initial.totalSpent)!==BigInt(payment.index)*PAYMENT_AMOUNT
      ||now()<payment.targetAt||Number(initial.chainTimestamp)<state.startsAt||now()>=state.endsAt||Number(initial.chainTimestamp)>=state.endsAt)throw Error('Payment timing or nonce guard failed');
    const network=dianaDeployNetwork(),before=await sender(network);assertWindow(before.evm,state,payment.index);
    const record=readParsedRecord(()=>readRecordBytes(RECORD_PATH));
    return withVerifiedAccount(record,INVOICE_OWNER,async(account,summary)=>{
      if(!same(account.publicKey,before.key)||summary.pqcPublicKeySha256!==DEPLOY_PLAN.pqcPublicKeySha256)throw Error('Record is not the verified Invoice Owner');
      const digest=invoiceDigest(state.contractAddress,payment.invoiceId,payment.nonce,state.endsAt);
      const digestCall=encodeFunctionData({abi:ABI,functionName:'invoiceDigest',args:[PAYMENT_RECIPIENT,PAYMENT_AMOUNT,payment.invoiceId,BigInt(payment.nonce),BigInt(state.endsAt)]});
      const tag={blockHash:initial.snapshot.hash,requireCanonical:true};
      if(await callRead(state,'eth_call',[{to:state.contractAddress,data:digestCall},tag])!==digest)throw Error('On-chain invoiceDigest differs');
      const signature=sdk.pqcSign(account.pqc.secretKey,hexToBytes(digest));
      try{
        if(signature.length!==4627||!sdk.pqcVerify(account.pqc.publicKey,hexToBytes(digest),signature))throw Error('Local ML-DSA-87 verification failed');
        const data=encodeFunctionData({abi:ABI,functionName:'pay',args:[PAYMENT_RECIPIENT,PAYMENT_AMOUNT,BigInt(payment.nonce),payment.invoiceId,BigInt(state.endsAt),toHex(signature)]});
        const estimate=BigInt(await rpc(network,'eth_estimateGas',[{from:INVOICE_OWNER.evm,to:state.contractAddress,data,value:'0x0'},'latest']));
        const gas=((estimate*125n+99n)/100n+9999n)/10000n*10000n;
        const tx={type:'eip1559',chainId:9800,nonce:Number(before.evm.nonce),to:state.contractAddress,value:0n,data,gas,maxFeePerGas:FEE_CAP,maxPriorityFeePerGas:PRIORITY,accessList:[]};
        if(!paymentFieldsValid(tx,tx)||before.evm.balanceWei<gas*FEE_CAP||assertWindow(before.evm,state,payment.index).remainingValue*1000000000000n<gas*FEE_CAP)throw Error('Payment exceeds gas, balance or window budget');
        // Full EVM simulation includes the exact invoice signature and contract/precompile checks.
        await callRead(state,'eth_call',[{from:INVOICE_OWNER.evm,to:state.contractAddress,data,value:'0x0',gas:'0x'+gas.toString(16)},'latest']);
        let raw=await signDeployment(account.privateKey,{tx});
        try{
          if(!paymentFieldsValid(parseTransaction(raw),tx)||!same(await recoverTransactionAddress({serializedTransaction:raw}),INVOICE_OWNER.evm))throw Error('Signed payment differs from bounded intent');
          const hash=keccak256(raw),fresh=await inspect(state),latest=await sender(network);
          assertWindow(latest.evm,state,payment.index);
          if(now()<payment.targetAt||now()>=state.endsAt||Number(fresh.chainTimestamp)>=state.endsAt||fresh.nextNonce!==initial.nextNonce
            ||fresh.totalSpent!==initial.totalSpent||fresh.balanceWei!==initial.balanceWei||latest.evm.nonce!==before.evm.nonce
            ||latest.evm.balanceWei!==before.evm.balanceWei||!same(latest.key,before.key))throw Error('State changed before payment broadcast');
          await checkpoint({txHash:hash,tx:plain(tx),invoiceDigest:digest,localInvoiceVerified:true,sentAt:now()});
          if(now()>=state.endsAt||keccak256(raw)!==hash)throw Error('Payment expired or bytes changed');
          const result=await broadcastOnce(raw,network);
          log({type:'payment-broadcast-result',index:payment.index,txHash:hash,outcome:result.outcome});
          if(result.outcome==='REFUSED'||(result.outcome==='ACCEPTED'&&result.txHash!==hash))throw Error('Payment refused/hash mismatch; never resend');
          // UNKNOWN enters the same read-only hash/receipt reconciliation, never another broadcast.
        }finally{raw=undefined;}
      }finally{signature.fill(0);}
    });
  }
  async function reconcile(state,payment){
    const network=dianaDeployNetwork();if(await rpc(network,'eth_chainId',[])!=='0x2648')throw Error('Wrong network');
    const {tx,receipt}=await readPaymentReceiptPair((method,params)=>rpc(network,method,params),payment.txHash);
    if(!receipt)return {status:unconfirmedStatus(tx,payment.sentAt,now()),txHash:payment.txHash};
    if(receipt.status!=='0x1')return {status:'failed',txHash:payment.txHash,receipt};
    if(!tx||!tx.blockHash)return {status:now()-Number(payment.sentAt)<120?'pending':'unknown',txHash:payment.txHash};
    if(receipt.transactionHash!==payment.txHash||tx.hash!==payment.txHash||receipt.blockHash!==tx.blockHash||!same(tx.from,INVOICE_OWNER.evm)||!same(tx.to,state.contractAddress))throw Error('Payment receipt identity mismatch');
    const t=payment.tx;
    if(tx.type!=='0x2'||BigInt(tx.chainId)!==9800n||BigInt(tx.value)!==0n||BigInt(tx.nonce)!==BigInt(t.nonce)||tx.input!==t.data
      ||BigInt(tx.gas)!==BigInt(t.gas)||BigInt(tx.maxFeePerGas)!==FEE_CAP||BigInt(tx.maxPriorityFeePerGas)!==PRIORITY
      ||(tx.accessList??[]).length||tx.authorizationList!==undefined||BigInt(receipt.gasUsed)>BigInt(t.gas))throw Error('Receipt transaction differs from public intent');
    const tag={blockHash:receipt.blockHash,requireCanonical:true},code=await rpc(network,'eth_getCode',[state.contractAddress,tag]);
    if(hashCode(code)!==state.runtimeSha256.replace(/^0x/,''))throw Error('Receipt runtime mismatch');
    const getter=async(name,args=[])=>BigInt(await callRead(state,'eth_call',[{to:state.contractAddress,data:encodeFunctionData({abi:ABI,functionName:name,args})},tag]));
    const nextNonce=await getter('nextNonce'),totalSpent=await getter('totalSpent'),paid=await getter('paidInvoices',[payment.invoiceId]);
    if(nextNonce!==BigInt(payment.nonce)+1n||totalSpent!==BigInt(payment.nonce+1)*PAYMENT_AMOUNT||paid!==1n)throw Error('Canonical payment state mismatch');
    const balanceWei=BigInt(await rpc(network,'eth_getBalance',[state.contractAddress,tag]));
    if(balanceWei!==3n*PAYMENT_AMOUNT-totalSpent)throw Error('Canonical post-payment balance mismatch');
    const event=paymentEvent(receipt,state.contractAddress,payment);
    const block=await callRead(state,'eth_getBlockByNumber',[receipt.blockNumber,false]);
    if(block.hash!==receipt.blockHash||Number(BigInt(block.timestamp))<state.startsAt||Number(BigInt(block.timestamp))>=state.endsAt)throw Error('Receipt block not canonical/in policy window');
    return {status:'confirmed',txHash:payment.txHash,confirmedAt:Number(BigInt(block.timestamp)),receipt,event,balanceWei:balanceWei.toString(),nextNonce:nextNonce.toString(),totalSpent:totalSpent.toString()};
  }
  return {inspect,ensureWindow,sendPayment,reconcile};
}
