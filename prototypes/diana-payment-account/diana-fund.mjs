// One explicitly authorized funding operation. Reuses the established window, record,
// account verification, EIP-1559 signer and one-shot broadcast; never executes payments.
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {createInterface} from 'node:readline/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {parseTransaction,recoverTransactionAddress,keccak256} from 'viem';
import {parseEvmWindow} from '@qorechain/evm/window';
import {dianaDeployNetwork,signDeployment,broadcastOnce,DEPLOY_PLAN} from './diana-deploy.mjs';
import {fetchLiveState,prepareFailures,classicalKeyHex} from './diana-hybrid-prepare.mjs';
import {fetchEvmState,WINDOW_PLAN,verifiedBankBalance} from './diana-window-prepare.mjs';
import {runWindowBroadcast,dianaWindowNetwork,verifyOpenedWindow} from './diana-window-open.mjs';
import {withVerifiedAccount} from './diana-canonical-pqc.mjs';
import {readParsedRecord} from './diana-hybrid-sign.mjs';
import {INVOICE_OWNER,RECORD_PATH,readRecordBytes} from './diana-verify-recovery.mjs';

export const FUNDING=Object.freeze({to:'0x127dd577174e8829a38AE6885bfe058855C04601',valueWei:3000000000000000n,
  codeSha256:'dde7b91ee1570fc0b22b323f956058d3cc35e182a176c45b837d549ca0478c19',maxGas:50000n,
  approvalSource:'Explicit user workflow approval, 2026-11-21: exactly 0.003 QOR to the verified new deployment only',expiresAt:1795235400n});
const DIR=new URL('../../docs/evidence/diana-funding-20261121/',import.meta.url);
const journal=new URL('broadcast-once.json',DIR);
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const sha=code=>createHash('sha256').update(Buffer.from(code.slice(2),'hex')).digest('hex');
const json=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x,2)+'\n';
const save=(name,v)=>writeFileSync(new URL(name,DIR),json(v),{flag:'wx'});
async function rpc(network,method,params){
  const r=await(await network.fetch(network.evmRpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(15000)})).json();
  if(r.error||r.result===undefined)throw new Error('Read-only RPC failed');return r.result;
}
export function fundingFieldsValid(t,nonce){
  return t.type==='eip1559'&&t.chainId===9800&&t.nonce===nonce&&Number.isSafeInteger(nonce)&&nonce>=0
    &&same(t.to,FUNDING.to)&&t.value===FUNDING.valueWei&&(t.data??'0x')==='0x'
    &&typeof t.gas==='bigint'&&t.gas>0n&&t.gas<=FUNDING.maxGas
    &&typeof t.maxFeePerGas==='bigint'&&t.maxFeePerGas>0n&&t.maxFeePerGas<=150000000000n
    &&typeof t.maxPriorityFeePerGas==='bigint'&&t.maxPriorityFeePerGas>=0n&&t.maxPriorityFeePerGas<=t.maxFeePerGas
    &&(t.accessList??[]).length===0&&t.authorizationList===undefined;
}
export async function prepareFunding(network,{requireWindow=true}={}){
  const live=await fetchLiveState(DEPLOY_PLAN.native,network),evm=await fetchEvmState(DEPLOY_PLAN,network);
  await verifiedBankBalance(network,DEPLOY_PLAN,evm,live.uqor);
  const failures=prepareFailures(live,{...WINDOW_PLAN,sequence:live.account?.sequence,amount:'3000'});
  const pending=await rpc(network,'eth_getTransactionCount',[DEPLOY_PLAN.evm,'pending']);
  if(failures.length||live.account?.sequence!==evm.nonce||BigInt(pending)!==BigInt(evm.nonce)
    ||evm.evmDenom!=='uqor')throw new Error('Sender, chain, PQC, nonce or units not verified');
  const code=await rpc(network,'eth_getCode',[FUNDING.to,'latest']);
  const balance=BigInt(await rpc(network,'eth_getBalance',[FUNDING.to,'latest']));
  if(sha(code)!==FUNDING.codeSha256||balance!==0n)throw new Error('Unexpected contract code or contract already funded; stop');
  const estimate=BigInt(await rpc(network,'eth_estimateGas',[{from:DEPLOY_PLAN.evm,to:FUNDING.to,value:'0x'+FUNDING.valueWei.toString(16),data:'0x'},'latest']));
  const gas=((estimate*125n+99n)/100n+999n)/1000n*1000n;
  const tx=Object.freeze({type:'eip1559',chainId:9800,nonce:Number(evm.nonce),to:FUNDING.to,value:FUNDING.valueWei,gas,
    maxFeePerGas:150000000000n,maxPriorityFeePerGas:12500000000n,data:'0x',accessList:[]});
  const maxCost=tx.value+gas*tx.maxFeePerGas,w=parseEvmWindow(evm.window);
  if(!fundingFieldsValid(tx,Number(evm.nonce))||evm.balanceWei<maxCost||evm.gasPriceWei>tx.maxFeePerGas
    ||evm.baseFeeWei===undefined||evm.baseFeeWei>tx.maxFeePerGas||BigInt(Math.floor(Date.now()/1000))>=FUNDING.expiresAt)throw new Error('Funding gas, fees, balance or time guard failed');
  if(requireWindow&&(!w.found||!w.live||w.remainingBlocks<30n||w.usedTxs!==0n||w.usedValue!==0n||w.maxTxs!==1n
    ||w.remainingTxs!==1n||w.maxValue>300000n||w.remainingValue*1000000000000n<maxCost||w.nativeOnly||w.allowedTargets.length))throw new Error('No qualifying unused EVM window');
  return {mode:'prepare_funding',signed:false,broadcast:false,approvalSource:FUNDING.approvalSource,from:DEPLOY_PLAN.evm,
    tx,balanceBeforeWei:balance,senderBalanceWei:evm.balanceWei,classicalPublicKey:classicalKeyHex(live,DEPLOY_PLAN),
    pqcSha256:DEPLOY_PLAN.pqcPublicKeySha256,estimate,maxCostWei:maxCost,codeSha256:sha(code),
    window:{found:w.found,live:w.live,usedTxs:w.usedTxs,usedValue:w.usedValue,maxValue:w.maxValue},sequence:evm.nonce};
}
async function runFunding(confirm){
  if(existsSync(journal))throw new Error('An attempt is already journaled; verify it read-only, never resend');
  const network=dianaDeployNetwork(),prepared=await prepareFunding(network);
  save('prepare.json',prepared);console.log(json(prepared));
  const samePrepare=async()=>{if(json(await prepareFunding(network))!==json(prepared))throw new Error('Chain state changed; stop');};
  const signPhrase='SIGN FUNDING 3000 UQOR TO '+FUNDING.to+' NONCE '+prepared.tx.nonce+' GAS '+prepared.tx.gas+' DIANA 9800';
  if(await confirm(signPhrase)!==signPhrase)throw new Error('Not confirmed');
  const record=readParsedRecord(()=>readRecordBytes(RECORD_PATH));
  return withVerifiedAccount(record,INVOICE_OWNER,async(account,summary)=>{
    if(!same(account.publicKey,prepared.classicalPublicKey)||summary.pqcPublicKeySha256!==prepared.pqcSha256)throw new Error('Record keys are not the approved on-chain keys');
    await samePrepare();
    let serialized=await signDeployment(account.privateKey,{tx:prepared.tx});
    try{
      const parsed=parseTransaction(serialized);
      if(!fundingFieldsValid(parsed,prepared.tx.nonce)||!same(await recoverTransactionAddress({serializedTransaction:serialized}),prepared.from)
        ||['gas','maxFeePerGas','maxPriorityFeePerGas'].some(k=>parsed[k]!==prepared.tx[k]))throw new Error('Signed funding transaction differs from approved intent');
      const hash=keccak256(serialized);
      console.log(json({phase:'check',formatCheck:'pass',txHash:hash,to:FUNDING.to,valueWei:FUNDING.valueWei,gas:prepared.tx.gas,maxCostWei:prepared.maxCostWei}));
      const phrase='BROADCAST FUNDING '+hash.slice(2,10).toUpperCase()+' TO DIANA 9800';
      if(await confirm(phrase)!==phrase)throw new Error('Not confirmed');
      await samePrepare();if(keccak256(serialized)!==hash)throw new Error('Signed bytes changed');
      save('broadcast-once.json',{txHash:hash,prepared,attemptedAt:new Date().toISOString(),note:'Saved before the single attempt. Never automatically retry.'});
      const result=await broadcastOnce(serialized,network);
      save('broadcast-result.json',{txHash:hash,...result});console.log(json({txHash:hash,...result}));
      if(result.outcome!=='ACCEPTED'||result.txHash!==hash)throw new Error('Broadcast not conclusively accepted; verify only');
    }finally{serialized=undefined;}
  });
}
async function verifyFunding(hash){
  const attempted=JSON.parse(readFileSync(journal,'utf8'));
  if(hash!==attempted.txHash)throw new Error('Hash not the journaled attempt');
  const network=dianaDeployNetwork();if(await rpc(network,'eth_chainId',[])!=='0x2648')throw new Error('Wrong chain');
  const receipt=await rpc(network,'eth_getTransactionReceipt',[hash]),tx=await rpc(network,'eth_getTransactionByHash',[hash]);
  if(!receipt||!tx)throw new Error('Not included yet; read-only verification only');
  const p=attempted.prepared.tx;
  if(receipt.status!=='0x1'||receipt.blockHash!==tx.blockHash||!same(tx.from,INVOICE_OWNER.evm)||!same(tx.to,FUNDING.to)
    ||tx.type!=='0x2'||BigInt(tx.chainId)!==9800n||BigInt(tx.nonce)!==BigInt(p.nonce)||BigInt(tx.value)!==FUNDING.valueWei||tx.input!=='0x'
    ||BigInt(tx.gas)!==BigInt(p.gas)||BigInt(tx.maxFeePerGas)!==BigInt(p.maxFeePerGas)||BigInt(tx.maxPriorityFeePerGas)!==BigInt(p.maxPriorityFeePerGas)
    ||(tx.accessList??[]).length||tx.authorizationList!==undefined||BigInt(receipt.gasUsed)>BigInt(p.gas))throw new Error('Funding receipt or transaction mismatch');
  const tag={blockHash:receipt.blockHash,requireCanonical:true};
  const balance=BigInt(await rpc(network,'eth_getBalance',[FUNDING.to,tag])),code=await rpc(network,'eth_getCode',[FUNDING.to,tag]);
  const latestBalance=BigInt(await rpc(network,'eth_getBalance',[FUNDING.to,'latest']));
  const evm=await fetchEvmState(DEPLOY_PLAN,network),window=parseEvmWindow(evm.window);
  if(balance!==BigInt(attempted.prepared.balanceBeforeWei)+FUNDING.valueWei||latestBalance!==FUNDING.valueWei||sha(code)!==FUNDING.codeSha256
    ||BigInt(evm.nonce)!==BigInt(p.nonce)+1n||window.usedTxs!==1n||window.usedValue<=0n)throw new Error('Post-funding balance, code, nonce or window mismatch');
  const report={verified:true,checkedAt:new Date().toISOString(),chainId:9800,txHash:hash,receipt,contract:FUNDING.to,balanceWei:balance.toString(),latestBalanceWei:latestBalance.toString(),runtimeSha256:sha(code),nonceAfter:evm.nonce,windowUsedTxs:window.usedTxs.toString()};
  save('verification.json',report);console.log(json(report));
}
async function main(){
  const args=process.argv.slice(2);
  if(!args.length){console.log(json(await prepareFunding(dianaDeployNetwork(),{requireWindow:false})));return;}
  if(args.length===2&&args[0]==='--verify'){await verifyFunding(args[1]);return;}
  if(args.length!==1||!['--open-window','--broadcast'].includes(args[0]))throw new Error('Unknown option');
  if(process.platform!=='win32'||!process.stdin.isTTY||!process.stdout.isTTY||process.execArgv.length||process.env.NODE_OPTIONS)throw new Error('Interactive Windows terminal required');
  if(existsSync(journal))throw new Error('Attempt already journaled; verification only');
  const prompt=createInterface({input:process.stdin,output:process.stdout,terminal:true});
  const confirm=async phrase=>(await prompt.question('\nType '+phrase+' to continue: ')).trim();
  try{
    if(args[0]==='--broadcast'){await runFunding(confirm);return;}
    const before=await prepareFunding(dianaDeployNetwork(),{requireWindow:false});console.log(json(before));
    const plan=Object.freeze({...WINDOW_PLAN,sequence:before.sequence});
    const result=await runWindowBroadcast({network:dianaWindowNetwork(),plan,readRecord:()=>readRecordBytes(RECORD_PATH),confirm,
      write:r=>console.log(json(r))});
    save('window-broadcast.json',result);
    const verified=await verifyOpenedWindow({network:dianaWindowNetwork(),txHash:result.txHash,plan,before:(before.senderBalanceWei/1000000000000n).toString()});
    save('window-verification.json',verified);console.log(json(verified));
    if(!verified.verified)throw new Error('Window verification failed; stop');
  }finally{prompt.close();}
}
if(process.argv[1]&&fileURLToPath(import.meta.url).toLowerCase()===resolve(process.argv[1]).toLowerCase())main().catch(()=>{console.error('Funding stopped. Review the public phase report. Never retry an uncertain broadcast.');process.exitCode=1;});
