/** Pure policy evaluation. Inputs must be supplied by a trusted, independently verified adapter.
 * No clock, transport, wallet or execution authority exists in this module. */
export type Outcome = 'ALLOW' | 'BLOCK' | 'WAIT' | 'UNKNOWN';
export interface Policy {
  chainId: number; contract: string; recipient: string; startsAt: number; endsAt: number;
  maxPerPayment: string; spendingLimit: string; maxPayments: string; maxAgeSeconds: number;
}
export interface Facts {
  chainId: number; contract: string; recipient: string; amount: string;
  nonce: string; nextNonce: string; invoiceId: string; invoicePaid: boolean;
  totalSpent: string; balance: string; previous: 'none' | 'confirmed' | 'pending' | 'unknown' | 'failed';
}
export interface Input {
  mode: 'historical' | 'current'; at: number; observedAt: number; source: string; block: string;
  evidence: 'verified' | 'rpc_unavailable' | 'timeout' | 'missing' | 'conflicting'; facts?: Partial<Facts>;
}
export interface Check { id: string; status: 'pass' | 'block' | 'wait' | 'unknown'; actual: string; expected: string; }
export interface Result {
  outcome: Outcome; decisive: string; checks: readonly Readonly<Check>[];
  mode: Input['mode']; at: number; observedAt: number; source: string; block: string;
  executionAuthorized: false;
}
const uint = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(v) && BigInt(v) < 1n << 256n;
const address = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v) && BigInt(v) > 0n;
const time = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= 253402300799;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function evaluatePayment(input: Input, policy: Readonly<Policy>): Readonly<Result> {
  const checks: Check[] = [];
  const add = (id: string, status: Check['status'], actual: unknown, expected: string) => checks.push({id,status,actual:String(actual ?? 'missing'),expected});
  const finish = (): Readonly<Result> => {
    // Contradictions/malformed evidence outrank denials; a known denial outranks temporary waits.
    const decisive = checks.find(c=>c.status==='unknown') ?? checks.find(c=>c.status==='block') ?? checks.find(c=>c.status==='wait');
    const outcome: Outcome = decisive ? ({unknown:'UNKNOWN',block:'BLOCK',wait:'WAIT',pass:'ALLOW'} as const)[decisive.status] : 'ALLOW';
    return Object.freeze({outcome,decisive:decisive?.id ?? 'all_checks',checks:Object.freeze(checks.map(c=>Object.freeze(c))),
      mode:input.mode,at:input.at,observedAt:input.observedAt,source:input.source,block:input.block,executionAuthorized:false});
  };
  if (!policy || !Number.isSafeInteger(policy.chainId) || policy.chainId<=0 || !address(policy.contract) || !address(policy.recipient)
    || !time(policy.startsAt) || !time(policy.endsAt) || policy.startsAt>=policy.endsAt
    || !uint(policy.maxPerPayment) || BigInt(policy.maxPerPayment)===0n || !uint(policy.spendingLimit)
    || BigInt(policy.maxPerPayment)>BigInt(policy.spendingLimit) || !uint(policy.maxPayments) || BigInt(policy.maxPayments)===0n
    || !Number.isSafeInteger(policy.maxAgeSeconds) || policy.maxAgeSeconds<0) {
    add('policy','unknown','invalid','valid explicit policy'); return finish();
  }
  if (!['historical','current'].includes(input.mode) || !time(input.at) || !time(input.observedAt) || input.at<input.observedAt
    || (input.mode==='historical' && input.at!==input.observedAt)
    || typeof input.source!=='string' || !input.source.trim() || !uint(input.block)) {
    add('provenance','unknown','invalid','timestamped, identified evidence'); return finish();
  }
  if (input.evidence!=='verified') {
    const waiting = input.evidence==='rpc_unavailable' || input.evidence==='timeout';
    add(input.evidence==='timeout'?'timeout':'evidence',waiting?'wait':'unknown',input.evidence,'verified'); return finish();
  }
  const f=input.facts;
  const numeric=['amount','nonce','nextNonce','totalSpent','balance'] as const;
  if (!f || numeric.some(k=>!uint(f[k])) || !Number.isSafeInteger(f.chainId) || Number(f.chainId)<=0
    || !address(f.contract) || !address(f.recipient) || typeof f.invoiceId!=='string' || !/^0x[0-9a-fA-F]{64}$/.test(f.invoiceId)
    || typeof f.invoicePaid!=='boolean' || !['none','confirmed','pending','unknown','failed'].includes(String(f.previous))) {
    add('data','unknown','missing or malformed','complete verified facts'); return finish();
  }
  const v=f as Facts;
  const amount=BigInt(v.amount), nonce=BigInt(v.nonce), next=BigInt(v.nextNonce), spent=BigInt(v.totalSpent);
  if (spent>BigInt(policy.spendingLimit) || next>BigInt(policy.maxPayments) || (next===0n && spent!==0n)
    || (next>0n && (spent===0n || spent>next*BigInt(policy.maxPerPayment)))
    || (v.previous==='none' && next!==0n) || (v.previous==='confirmed' && next===0n)
    || (v.invoicePaid && next===0n)) {
    add('consistency','unknown','contradictory counters/history','coherent verified snapshot'); return finish();
  }
  add('freshness',input.mode==='current' && input.at-input.observedAt>policy.maxAgeSeconds?'wait':'pass',input.at-input.observedAt,`<= ${policy.maxAgeSeconds}s (current only)`);
  add('network',v.chainId===policy.chainId?'pass':'block',v.chainId,String(policy.chainId));
  add('contract',same(v.contract,policy.contract)?'pass':'block',v.contract,policy.contract);
  add('recipient',same(v.recipient,policy.recipient)?'pass':'block',v.recipient,policy.recipient);
  add('window',input.at<policy.startsAt?'wait':input.at>=policy.endsAt?'block':'pass',input.at,`[${policy.startsAt}, ${policy.endsAt})`);
  add('per_payment',amount===0n || amount>BigInt(policy.maxPerPayment)?'block':'pass',v.amount,`0 < amount <= ${policy.maxPerPayment} wei`);
  add('total',spent+amount>BigInt(policy.spendingLimit)?'block':'pass',(spent+amount).toString(),`<= ${policy.spendingLimit} wei`);
  add('count',next>=BigInt(policy.maxPayments)?'block':'pass',v.nextNonce,`< ${policy.maxPayments}`);
  add('nonce',nonce<next?'block':nonce>next?'wait':'pass',v.nonce,v.nextNonce);
  add('invoice',v.invoicePaid?'block':'pass',v.invoicePaid,'false');
  add('balance',BigInt(v.balance)<amount?'block':'pass',v.balance,`>= ${v.amount} wei`);
  add('previous',v.previous==='pending'?'wait':v.previous==='unknown'?'unknown':v.previous==='failed'?'block':'pass',v.previous,'none or confirmed');
  return finish();
}
