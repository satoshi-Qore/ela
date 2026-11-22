import { createHash, randomBytes, randomUUID } from 'node:crypto';

const AMOUNT = 1000000000000000n;
export const SCHEDULE_RECIPIENT = '0xc9Ab55FeC7c1fEe27F3AFc5DF99E6A09b4B2D875';

// Detect accidental changes to the persisted immutable plan; this is not an authentication MAC.
function planBinding(s) {
  return createHash('sha256').update(JSON.stringify({version:s.version,runId:s.runId,contractAddress:s.contractAddress,runtimeSha256:s.runtimeSha256,startLocal:s.startLocal,timeZone:s.timeZone,startsAt:s.startsAt,endsAt:s.endsAt,payments:s.payments.map(({index,nonce,invoiceId,targetAt})=>({index,nonce,invoiceId,targetAt}))})).digest('hex');
}

function localTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) throw Error('startLocal must be YYYY-MM-DD HH:mm:ss');
  const ms = Date.parse(value.replace(' ', 'T') + '+03:00');
  if (!Number.isFinite(ms) || new Date(ms + 10800000).toISOString().slice(0,19).replace('T',' ') !== value) throw Error('Invalid Istanbul local date');
  return ms / 1000;
}

export function createSchedule({contractAddress, runtimeSha256, startLocal, startsAt, endsAt, runId = randomUUID()}) {
  if (!/^0x[0-9a-f]{40}$/i.test(contractAddress ?? '')) throw Error('Invalid contract address');
  if (!/^(0x)?[0-9a-f]{64}$/i.test(runtimeSha256 ?? '')) throw Error('Invalid runtime SHA-256');
  startsAt=Number(startsAt);endsAt=Number(endsAt);
  if (!Number.isSafeInteger(startsAt) || !Number.isSafeInteger(endsAt) || startsAt>=endsAt) throw Error('Invalid policy interval');
  const target=localTimestamp(startLocal);
  if (target<startsAt || target+120>=endsAt) throw Error('All three targets must fall within the policy interval');
  const state={version:1,runId,contractAddress,runtimeSha256,startLocal,timeZone:'Europe/Istanbul',startsAt,endsAt,status:'scheduled',payments:Array.from({length:3},(_,index)=>({index,nonce:index,invoiceId:'0x'+randomBytes(32).toString('hex'),targetAt:target+index*60,status:'planned'}))};
  state.planSha256=planBinding(state);return state;
}

function validate(state) {
  const expected=createSchedule(state);
  if (state.version!==1 || state.timeZone!==expected.timeZone || state.payments?.length!==3) throw Error('Invalid schedule');
  const ids=new Set();let unconfirmed=false;
  for (const [i,p] of state.payments.entries()) {
    if (p.index!==i || p.nonce!==i || p.targetAt!==expected.payments[i].targetAt || !/^0x[0-9a-f]{64}$/i.test(p.invoiceId??'') || ids.has(p.invoiceId)) throw Error('Invalid payment plan');
    ids.add(p.invoiceId);
    if (!['planned','uncertain','confirmed'].includes(p.status)) throw Error('Invalid payment status');
    if (unconfirmed && p.status!=='planned') throw Error('Nonsequential payment history');
    if(p.status!=='confirmed')unconfirmed=true;
    if(p.status==='uncertain' && !/^0x[0-9a-f]{64}$/i.test(p.txHash??''))throw Error('Uncertain payment has no transaction hash');
  }
  if(state.planSha256!==planBinding(state))throw Error('Persisted plan binding mismatch');
}

/** Persistence must atomically commit and fsync before resolving. The caller owns the exclusive contract lock. */
export async function runSchedule(state,{save,adapter,now=()=>Date.now()/1000,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),log=()=>{}}) {
  validate(state);
  if(state.status==='blocked')return state;
  const persist=()=>save(state);
  const block=async reason=>{state.status='blocked';state.reason=reason;await persist();log({type:'blocked',reason});return state;};
  const checkExpiry=chainTimestamp=>{
    if(now()>=state.endsAt || (chainTimestamp!=null && Number(chainTimestamp)>=state.endsAt))throw Error('Policy expired');
  };
  const reconcile=async p=>{
    for(;;){
      const result=await adapter.reconcile(state,p);
      if(result.status==='confirmed'){
        if(result.txHash && result.txHash.toLowerCase()!==p.txHash?.toLowerCase())throw Error('Confirmation hash mismatch');
        p.status='confirmed';p.confirmedAt=result.confirmedAt??now();p.confirmation=result;await persist();return;
      }
      if(result.status!=='pending')throw Error(`Payment ${p.index} reconciliation ${result.status}`);
      checkExpiry();await sleep(1000);
    }
  };
  try {
    // Audit persisted successes and ambiguous broadcasts before considering another signature.
    for(const p of state.payments){if(p.status==='confirmed'||p.status==='uncertain')await reconcile(p);else break;}
    if(state.payments.every(p=>p.status==='confirmed')){state.status='complete';await persist();return state;}
    state.status='running';await persist();
    for(const p of state.payments){
      if(p.status==='confirmed')continue;
      const notBefore=Math.max(p.targetAt,p.index>0?Number(state.payments[p.index-1].sentAt)+60:p.targetAt);
      while(now()<notBefore){checkExpiry();await sleep(Math.min(1000,(notBefore-now())*1000));}
      checkExpiry();
      if(now()+(2-p.index)*60>=state.endsAt)throw Error('Insufficient remaining validity for the sixty-second sequence');
      const chain=await adapter.inspect(state);
      checkExpiry(chain.chainTimestamp);
      if(Number(chain.startsAt)!==state.startsAt || Number(chain.endsAt)!==state.endsAt)throw Error('On-chain policy interval mismatch');
      if(BigInt(chain.nextNonce)!==BigInt(p.nonce) || BigInt(chain.totalSpent)!==BigInt(p.index)*AMOUNT)throw Error('Unexpected on-chain nonce or spend');
      if(BigInt(chain.balanceWei)<AMOUNT)throw Error('Insufficient payment balance');
      await adapter.ensureWindow(state,p,async payload=>{p.windowCheckpoint=payload;await persist();});
      checkExpiry();
      let checkpointed=false;
      await adapter.sendPayment(state,p,async payload=>{
        if(checkpointed)throw Error('Duplicate payment checkpoint');
        if(!/^0x[0-9a-f]{64}$/i.test(payload?.txHash??'') || !payload.tx)throw Error('Payment checkpoint requires public intent and transaction hash');
        checkExpiry();
        const actualSend=payload.sentAt??now();
        if(actualSend<notBefore||now()+(2-p.index)*60>=state.endsAt)throw Error('Send timing no longer fits the approved sequence');
        p.status='uncertain';p.txHash=payload.txHash;p.tx=payload.tx;p.sentAt=payload.sentAt??now();
        p.latenessSeconds=Math.max(0,p.sentAt-p.targetAt);await persist();checkpointed=true;
        log({type:'payment-submission',index:p.index,targetAt:p.targetAt,sentAt:p.sentAt,latenessSeconds:p.latenessSeconds,txHash:p.txHash});
      });
      if(!checkpointed)throw Error('Adapter did not persist payment intent');
      await reconcile(p);
    }
    state.status='complete';await persist();return state;
  } catch(error) { return block(error.message); }
}
