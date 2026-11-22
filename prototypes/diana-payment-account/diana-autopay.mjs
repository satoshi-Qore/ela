import {withDianaReadRetries} from './diana-read-retry.mjs';
// One start command owns a durable, browser-independent Node worker. No GitHub executor.
import {openSync,closeSync,writeSync,fsyncSync,renameSync,readFileSync,existsSync,mkdirSync,unlinkSync,appendFileSync,copyFileSync,constants} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {createSchedule,runSchedule} from './diana-scheduler.mjs';
import {createLiveAdapter} from './diana-autopay-live.mjs';
import {createDianaPaymentReader} from '../../src/qorechain/diana-payment-reader.ts';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const DEFAULT_CONFIG={contractAddress:'0x127dd577174e8829a38AE6885bfe058855C04601',runtimeSha256:'dde7b91ee1570fc0b22b323f956058d3cc35e182a176c45b837d549ca0478c19'};
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v);
const now=()=>Math.floor(Date.now()/1000);
export function statePath(contract){
  if(!/^0x[0-9a-f]{40}$/i.test(contract))throw Error('Invalid contract');
  return resolve(ROOT,'.diana-autopay',contract.toLowerCase()+'.json');
}
export function saveState(path,state){
  mkdirSync(dirname(path),{recursive:true});
  if(existsSync(path+'.journal')){
    const old=readFileSync(path+'.journal','utf8');
    if(old&&!old.endsWith('\n')){
      const boundary=old.lastIndexOf('\n'),tail=old.slice(boundary+1);let recovered;
      try{JSON.parse(tail);recovered=old+'\n';}catch{recovered=old.slice(0,boundary+1);}
      // Preserve the interrupted bytes, then atomically replace only the torn journal tail.
      copyFileSync(path+'.journal',path+'.journal.interrupted-'+randomUUID(),constants.COPYFILE_EXCL);
      const temporary=path+'.journal.recovery-'+randomUUID(),fd=openSync(temporary,'wx',0o600);
      try{writeSync(fd,recovered);fsyncSync(fd);}finally{closeSync(fd);}
      renameSync(temporary,path+'.journal');
    }
  }
  state.persistenceSequence=(state.persistenceSequence??0)+1;
  const bytes=json(state)+'\n';
  const journal=openSync(path+'.journal','a',0o600);
  try{writeSync(journal,bytes);fsyncSync(journal);}finally{closeSync(journal);}
  const temporary=path+'.'+randomUUID()+'.tmp',fd=openSync(temporary,'wx',0o600);
  try{writeSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
  renameSync(temporary,path);
}
export function loadState(path){
  const records=readFileSync(path+'.journal','utf8').split('\n');let last;
  for(let i=0;i<records.length;i++){
    if(!records[i])continue;
    try{const state=JSON.parse(records[i]);if(last&&(state.runId!==last.runId||state.persistenceSequence!==last.persistenceSequence+1))throw Error('Journal sequence mismatch');last=state;}
    catch(error){if(error instanceof SyntaxError&&i===records.length-1)break;throw Error('Durable journal corrupt');}
  }
  if(!last)throw Error('No durable schedule');return last;
}
export function acquireLock(path){
  const lock=path+'.lock',token=randomUUID();
  for(let attempts=0;attempts<2;attempts++){
    try{
      const fd=openSync(lock,'wx',0o600);try{writeSync(fd,json({pid:process.pid,token}));fsyncSync(fd);}finally{closeSync(fd);}
      return ()=>{const current=JSON.parse(readFileSync(lock,'utf8'));if(current.token===token)unlinkSync(lock);};
    }catch(error){
      if(error.code!=='EEXIST')throw error;
      const previous=JSON.parse(readFileSync(lock,'utf8'));let live=true;
      try{process.kill(previous.pid,0);}catch(e){if(e.code==='ESRCH')live=false;else throw e;}
      if(live)throw Error('A worker for this contract is already running');
      renameSync(lock,lock+'.stale-'+randomUUID());
    }
  }
  throw Error('Could not acquire contract lock');
}
function log(path,event){appendFileSync(path+'.events',json({observedAt:new Date().toISOString(),...event})+'\n',{mode:0o600});}
async function worker(path){
  const release=acquireLock(path);
  try{
    const state=loadState(path);
    if(path!==statePath(state.contractAddress)||state.authorization?.scope!=='three-payments-only'||state.authorization?.planSha256!==state.planSha256)throw Error('Run authorization does not match persisted plan');
    const adapter=createLiveAdapter({log:e=>log(path,e)});
    const save=async s=>saveState(path,s);
    const outcome=await runSchedule(state,{adapter,save,log:e=>log(path,e),
      // Prepare the scoped window just before the first target, not at daemon start.
      // This keeps its 400-block lifetime useful and removes window signing from T.
      sleep:async ms=>{
        if(state.status!=='blocked'&&state.payments[0].status==='planned'&&!state.payments[0].windowCheckpoint&&now()>=state.payments[0].targetAt-90){
          await adapter.ensureWindow(state,state.payments[0],async payload=>{state.payments[0].windowCheckpoint=payload;await save(state);});
        }
        await new Promise(r=>setTimeout(r,ms));
      }});
    log(path,{type:'worker-finished',status:outcome.status,reason:outcome.reason});
  }finally{release();}
}
function launch(path){
  const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--worker',path],{detached:true,stdio:'ignore',windowsHide:true,env:{...process.env,NODE_OPTIONS:''}});
  child.unref();return child.pid;
}
export function publicSummary(state){return {runId:state.runId,contract:state.contractAddress,timeZone:state.timeZone,startLocal:state.startLocal,status:state.status,reason:state.reason,
  payments:state.payments.map(p=>({nonce:p.nonce,invoiceId:p.invoiceId,targetAt:p.targetAt,status:p.status,sentAt:p.sentAt,confirmedAt:p.confirmedAt,txHash:p.txHash,latenessSeconds:p.latenessSeconds}))};}
async function main(){
  const args=process.argv.slice(2);
  if(args[0]==='--worker'&&args.length===2){await worker(resolve(args[1]));return;}
  let config=DEFAULT_CONFIG,startLocal,mode;
  for(let i=0;i<args.length;i++){
    if(args[i]==='--config'&&args[i+1])config=JSON.parse(readFileSync(args[++i],'utf8'));
    else if(args[i]==='--start'&&args[i+1]&&!mode){mode='start';startLocal=args[++i];}
    else if(['--resume','--status'].includes(args[i])&&!mode)mode=args[i].slice(2);
    else throw Error('Use --start "YYYY-MM-DD HH:mm:ss", --resume or --status; optional --config public.json');
  }
  if(!mode)throw Error('A start, resume or status command is required');
  const path=statePath(config.contractAddress);mkdirSync(dirname(path),{recursive:true});
  if(mode==='status'){console.log(json(publicSummary(loadState(path))));return;}
  if(mode==='resume'){
    const state=loadState(path);
    if(state.status==='blocked')throw Error('Run blocked; inspect its public reason. No automatic retry or new authorization is inferred.');
    if(state.status==='complete'){console.log(json(publicSummary(state)));return;}
    const release=acquireLock(path);release();console.log(json({resumed:true,pid:launch(path),stateFile:path}));return;
  }
  if(process.platform!=='win32'||!process.stdin.isTTY||!process.stdout.isTTY||process.execArgv.length||process.env.NODE_OPTIONS)throw Error('Interactive Windows terminal required for initial run authorization');
  const release=acquireLock(path);
  try{
    if(existsSync(path)||existsSync(path+'.journal'))throw Error('A schedule already exists for this contract; use status/resume');
    const reader=await createDianaPaymentReader({fetch:withDianaReadRetries()}),p=await reader.policy(config.contractAddress);await reader.finish();
    const state=createSchedule({contractAddress:config.contractAddress,runtimeSha256:config.runtimeSha256.toLowerCase(),startLocal,startsAt:p.startsAt,endsAt:p.endsAt});
    const snapshot=await createLiveAdapter().inspect(state);
    if(now()>=state.payments[0].targetAt||Number(snapshot.chainTimestamp)>=state.payments[0].targetAt||Number(snapshot.nextNonce)!==0||BigInt(snapshot.totalSpent)!==0n||BigInt(snapshot.balanceWei)<3000000000000000n)throw Error('Start is past or contract not at funded initial state');
    const phrase='AUTHORIZE THREE DIANA PAYMENTS AT '+startLocal+' ISTANBUL TOTAL 0.003 QOR';
    console.log(json({...publicSummary(state),recipient:'0xc9Ab55FeC7c1fEe27F3AFc5DF99E6A09b4B2D875',amountPerPaymentWei:'1000000000000000',maximumPayments:3,feeCapGwei:150,aggregateWindowValueUqor:256500,windowFeeCeilingUqor:52500}));
    const prompt=createInterface({input:process.stdin,output:process.stdout,terminal:true});
    try{if((await prompt.question('\nType '+phrase+' to arm once: ')).trim()!==phrase)throw Error('Not confirmed');}finally{prompt.close();}
    if(now()>=state.payments[0].targetAt)throw Error('Start passed during confirmation');
    state.authorization={scope:'three-payments-only',planSha256:state.planSha256,approvedAt:new Date().toISOString(),source:'Explicit user autonomous-payment instruction and configured-start confirmation'};
    saveState(path,state);
  }finally{release();}
  console.log(json({armed:true,pid:launch(path),stateFile:path}));
}
if(process.argv[1]&&fileURLToPath(import.meta.url).toLowerCase()===resolve(process.argv[1]).toLowerCase())main().catch(error=>{if(process.argv[2]==='--worker'){try{log(resolve(process.argv[3]),{type:'worker-error',reason:'Worker stopped; inspect persisted state; no automatic resend.'});}catch{}}else console.error('Autopay stopped: '+error.message);process.exitCode=1;});
