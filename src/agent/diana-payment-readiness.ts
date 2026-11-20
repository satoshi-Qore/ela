import { checkAddress } from '../qorechain/keccak.ts';
import { createDianaPaymentReader, sha256Data } from '../qorechain/diana-payment-reader.ts';
import type { PaymentPolicyState, PaymentSnapshot, PqcReading } from '../qorechain/diana-payment-reader.ts';
import { isRecord, QORECHAIN_TESTNET, QoreChainReadError } from '../qorechain/read-client.ts';
import type { ReadOptions } from '../qorechain/read-client.ts';

export interface ReviewedPaymentPolicy {
  recipient: string; maxPerPaymentWei: string; spendingLimitWei: string; maxPayments: string; startsAt: string; endsAt: string;
}
export interface ProposedPayment { recipient: string; amountWei: string; nonce: string; invoiceId: string; validUntil: string; }
/** Public operator configuration only; never obtain these pins or roles from model output. */
export interface PaymentReadinessConfig {
  contractAddress?: string; executor?: string; invoiceIssuer?: string; expectedRuntimeSha256?: string;
  pqcKeySha256?: {executor?: string; invoiceIssuer?: string};
  policy?: ReviewedPaymentPolicy; payment?: ProposedPayment;
}
export interface ReadinessCheck { id: string; status: 'pass' | 'blocked' | 'not_checked'; message: string; }
export interface PaymentReadinessReport {
  version: 1; chainId: string; evmChainId: '9800'; status: 'ready_for_review' | 'blocked'; executionAuthorized: false;
  scope: 'read_only_prerequisites'; configuration?: PaymentReadinessConfig; checks: ReadinessCheck[]; snapshot?: PaymentSnapshot;
  observations: {contract?: {address:string; deployed:boolean; codeSha256?:string}; pqc: {executor?:PqcReading; invoiceIssuer?:PqcReading}; policy?:PaymentPolicyState; balanceWei?:string; invoicePaid?:boolean};
  error?: {code:string; message:string};
}
const UINT_MAX = (1n << 256n) - 1n;
function badConfig(): never { throw new QoreChainReadError('invalid_configuration', 'Expected public readiness configuration with canonical addresses, decimal amounts and SHA-256 pins only.'); }
function object(value: unknown, keys: readonly string[]): Record<string,unknown> {
  if (!isRecord(value) || Object.keys(value).some(k => !keys.includes(k))) badConfig();
  return value;
}
function addr(value: unknown): string {
  const address = typeof value === 'string' ? checkAddress(value) : undefined;
  return address && BigInt(address)>65535n ? address : badConfig();
}
function decimal(value: unknown): string {
  return typeof value === 'string' && /^(?:0|[1-9][0-9]{0,77})$/u.test(value) && BigInt(value)<=UINT_MAX ? value : badConfig();
}
function pin(value: unknown): string { return typeof value==='string' && /^[0-9a-f]{64}$/u.test(value) ? value : badConfig(); }
function validate(input: unknown): PaymentReadinessConfig {
  const raw=object(input,['contractAddress','executor','invoiceIssuer','expectedRuntimeSha256','pqcKeySha256','policy','payment']);
  const c: PaymentReadinessConfig={};
  for(const k of ['contractAddress','executor','invoiceIssuer'] as const) if(raw[k]!==undefined)c[k]=addr(raw[k]);
  if(raw.expectedRuntimeSha256!==undefined)c.expectedRuntimeSha256=pin(raw.expectedRuntimeSha256);
  if(raw.pqcKeySha256!==undefined){
    const p=object(raw.pqcKeySha256,['executor','invoiceIssuer']);c.pqcKeySha256={};
    for(const k of ['executor','invoiceIssuer'] as const)if(p[k]!==undefined)c.pqcKeySha256[k]=pin(p[k]);
  }
  if(raw.policy!==undefined){
    const p=object(raw.policy,['recipient','maxPerPaymentWei','spendingLimitWei','maxPayments','startsAt','endsAt']);
    c.policy={recipient:addr(p.recipient),maxPerPaymentWei:decimal(p.maxPerPaymentWei),spendingLimitWei:decimal(p.spendingLimitWei),maxPayments:decimal(p.maxPayments),startsAt:decimal(p.startsAt),endsAt:decimal(p.endsAt)};
    if(BigInt(c.policy.startsAt)>253402300799n || BigInt(c.policy.endsAt)>253402300799n)badConfig();
  }
  if(raw.payment!==undefined){
    const p=object(raw.payment,['recipient','amountWei','nonce','invoiceId','validUntil']);
    if(typeof p.invoiceId!=='string'||!/^0x[0-9a-fA-F]{64}$/u.test(p.invoiceId))badConfig();
    c.payment={recipient:addr(p.recipient),amountWei:decimal(p.amountWei),nonce:decimal(p.nonce),invoiceId:p.invoiceId.toLowerCase(),validUntil:decimal(p.validUntil)};
  }
  return c;
}
/**
 * Read-only API for a future authorized workflow. Not registered with command routing or the model.
 * A positive result is a block-specific prerequisite review, never a signing/broadcast permit.
 * Invoice signatures, executor hybrid window, fee funding and future execution are out of scope.
 */
export async function inspectDianaPaymentAccount(input: unknown, options: ReadOptions & {nowSeconds?:()=>number} = {}): Promise<PaymentReadinessReport> {
  const report: PaymentReadinessReport={version:1,chainId:QORECHAIN_TESTNET.chainId,evmChainId:'9800',status:'blocked',executionAuthorized:false,scope:'read_only_prerequisites',checks:[],observations:{pqc:{}}};
  const check=(id:string,pass:boolean,message:string) => { report.checks.push({id,status:pass?'pass':'blocked',message}); };
  const skipped=(id:string,message:string) => { report.checks.push({id,status:'not_checked',message}); };
  try {
    // Copy and validate every public field before the first await or network call.
    const c=validate(input);report.configuration=c;
    for(const [id,value] of [['contract_address',c.contractAddress],['executor',c.executor],['invoice_issuer',c.invoiceIssuer],['runtime_pin',c.expectedRuntimeSha256],['policy_configured',c.policy],['payment_configured',c.payment],['executor_key_pin',c.pqcKeySha256?.executor],['issuer_key_pin',c.pqcKeySha256?.invoiceIssuer]] as const)check(id,!!value,value?'Public prerequisite configured.':'Public prerequisite is missing; no default is inferred.');
    const reader=await createDianaPaymentReader(options);
    check('network',true,'Diana EVM chain ID 9800 verified at the fixed endpoint.');report.snapshot=reader.snapshot;
    const stamp=BigInt(reader.snapshot.timestamp);
    const ensureFresh=()=>{
      const now=(options.nowSeconds??(()=>Math.floor(Date.now()/1000)))();
      if(!Number.isSafeInteger(now)||now<0)badConfig();
      if(stamp>BigInt(now)+60n||BigInt(now)-stamp>120n)throw new QoreChainReadError('node_syncing','Diana snapshot is stale or future-dated.');
    };
    ensureFresh();
    check('snapshot',true,'Selected a recent block; all state reads require its canonical block hash.');
    let trustedContract=false;
    if(c.contractAddress){
      const code=await reader.code(c.contractAddress);
      report.observations.contract={address:c.contractAddress,deployed:code!=='0x'};
      check('contract_deployed',code!=='0x',code==='0x'?'No runtime code at the configured candidate address.':'Runtime code exists.');
      if(code!=='0x'){
        const hash=await sha256Data(code);report.observations.contract.codeSha256=hash;
        trustedContract=!!c.expectedRuntimeSha256&&hash===c.expectedRuntimeSha256;
        check('runtime_identity',trustedContract,trustedContract?'Runtime SHA-256 matches the reviewed deployment pin.':'Runtime identity is unverified or differs; contract getters will not be trusted.');
      }else skipped('runtime_identity','No contract code to attest.');
    }else{skipped('contract_deployed','No contract address configured.');skipped('runtime_identity','No contract address configured.');}
    const pqcCache=new Map<string,PqcReading>();
    for(const role of ['executor','invoiceIssuer'] as const){
      const target=c[role],id=role==='executor'?'executor_pqc':'issuer_pqc';
      if(!target){skipped(id,'No public role address configured.');continue;}
      let key=pqcCache.get(target);if(!key){key=await reader.pqc(target);pqcCache.set(target,key);}
      report.observations.pqc[role]=key;
      check(id,key.registered&&key.algorithmId===1&&key.possessionProven&&key.publicKeyBytes===2592&&key.keySha256===c.pqcKeySha256?.[role],
        'Requires registered ML-DSA-87, 2592-byte key, possession proof and the reviewed role fingerprint.');
    }
    if(trustedContract&&c.contractAddress){
      const p=await reader.policy(c.contractAddress);report.observations.policy=p;
      const expected=c.policy;
      const policyOK=!!expected&&p.executor===c.executor&&p.invoiceIssuer===c.invoiceIssuer&&p.recipient===expected.recipient
        &&p.maxPerPayment===expected.maxPerPaymentWei&&p.spendingLimit===expected.spendingLimitWei&&p.maxPayments===expected.maxPayments&&p.startsAt===expected.startsAt&&p.endsAt===expected.endsAt
        &&BigInt(p.maxPerPayment)>0n&&BigInt(p.maxPerPayment)<=BigInt(p.spendingLimit)&&BigInt(p.maxPayments)>0n&&BigInt(p.startsAt)<BigInt(p.endsAt)
        &&p.recipient!==c.contractAddress&&BigInt(p.totalSpent)<=BigInt(p.spendingLimit)&&BigInt(p.nextNonce)<=BigInt(p.maxPayments);
      check('policy',policyOK,'Immutable roles and limits must exactly match the reviewed policy; counters must remain within policy.');
      if(policyOK&&c.payment){
        const request=c.payment, amount=BigInt(request.amountWei);
        report.observations.balanceWei=await reader.balance(c.contractAddress);
        report.observations.invoicePaid=await reader.invoicePaid(c.contractAddress,request.invoiceId);
        const failures=[];
        if(request.recipient!==p.recipient)failures.push('recipient');
        if(amount===0n||amount>BigInt(p.maxPerPayment))failures.push('per_payment_limit');
        if(amount>BigInt(p.spendingLimit)-BigInt(p.totalSpent))failures.push('remaining_budget');
        if(request.nonce!==p.nextNonce)failures.push('nonce');
        if(BigInt(p.nextNonce)>=BigInt(p.maxPayments))failures.push('payment_count');
        if(amount>BigInt(report.observations.balanceWei))failures.push('contract_balance');
        if(stamp<BigInt(p.startsAt)||stamp>=BigInt(p.endsAt))failures.push('payment_window');
        if(/^0x0+$/u.test(request.invoiceId)||stamp>=BigInt(request.validUntil))failures.push('invoice_validity');
        if(report.observations.invoicePaid)failures.push('invoice_replay');
        check('payment',failures.length===0,failures.length?'Payment prerequisites failed: '+failures.join(', ')+'.':'Proposed payment fits the observed policy. Signature and execution authorization are not checked.');
      }else skipped('payment','Requires a verified matching policy and a public proposed payment.');
    }else{skipped('policy','Requires attested runtime code.');skipped('payment','Requires attested runtime code and policy.');}
    await reader.finish();ensureFresh();check('snapshot_consistent',true,'Chain identity and selected block hash are unchanged at completion.');
    if(report.checks.every(c=>c.status==='pass'))report.status='ready_for_review';
  }catch(error){
    const e=error instanceof QoreChainReadError?error:new QoreChainReadError('invalid_response','Payment readiness could not be verified.');
    report.error={code:e.code,message:e.message};check('read_failed',false,e.message);
  }
  return report;
}
