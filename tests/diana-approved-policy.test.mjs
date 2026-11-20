import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {APPROVED_PAYMENT_POLICY} from '../prototypes/diana-payment-account/approved-payment-policy.mjs';
import {constructorChecklist,deploymentPackage,loadDeployArtifact,LIVE_CONSTRUCTOR_PARAMS,dispatchDeployment,DEPLOY_PLAN} from '../prototypes/diana-payment-account/diana-deploy.mjs';
const OWNER='0x6a5d4D7B3357df968b2A3004071eCe98f015C794',RECIPIENT='0xc9Ab55FeC7c1fEe27F3AFc5DF99E6A09b4B2D875';
const artifact=()=>loadDeployArtifact({artifactPath:new URL('../docs/evidence/diana-deploy-7i2/compiled-contract.json',import.meta.url)});
test('one frozen policy records the explicitly approved fields without authorizing execution',()=>{
 const p=APPROVED_PAYMENT_POLICY;
 assert.equal(p.approvalStatus,'approved');assert.equal(p.executionAuthorized,false);
 assert.deepEqual(p.parameters,{executor:OWNER,invoiceIssuer:OWNER,recipient:RECIPIENT,maxPerPayment:1000000000000000n,spendingLimit:3000000000000000n,maxPayments:3n});
 assert.equal(p.timing.approvalStatus,'pending');assert.equal(p.timing.approvalSource,null);
 assert.equal(p.timing.durationSeconds,604800n);assert.equal(p.timing.startsAt,null);assert.equal(p.timing.endsAt,null);
 for(const value of [p,p.parameters,p.timing])assert.ok(Object.isFrozen(value));
 assert.throws(()=>{p.parameters.recipient=OWNER;},TypeError);
});
test('default constructor checklist recognizes approved values while dates remain unreviewed',()=>{
 const r=constructorChecklist(null,{nowSeconds:1795000000,recipientCode:'0x'});
 assert.equal(r.ready,false);assert.deepEqual(r.failing,['reviewed','dates']);
 assert.equal(r.policyApproval.approvalStatus,'approved');assert.deepEqual(r.policyApproval.pendingFields,['startsAt','endsAt']);
 for(const id of ['chosen','executor','invoiceIssuer','recipient-address','recipient-distinct','recipient-code','amounts','maxPayments'])assert.equal(r.items.find(x=>x.id===id).ok,true,id);
 assert.match(r.items.find(x=>x.id==='reviewed').requirement,/dates/i);
});
test('default deployment package waits only for dates and does not produce a live runtime pin',()=>{
 const p=deploymentPackage({artifact:artifact(),params:null,nonce:2n});
 assert.equal(p.status,'blocked');assert.deepEqual(p.missingApprovals,['startsAt','endsAt']);assert.equal(p.runtimeSha256,null);assert.equal(p.readinessConfig,null);assert.equal(p.executionAuthorized,false);
 assert.equal(p.policyApproval.approvalStatus,'approved');assert.equal(p.policyApproval.values.maxPerPayment,'1000000000000000');
});
test('approved seven-day duration is enforced by existing date checks without choosing actual dates',()=>{
 // Local fixture dates exercise the rule only; they are never stored in the approved policy.
 const p={...APPROVED_PAYMENT_POLICY.parameters,testOnly:false,reviewed:true,startsAt:1796000000n,endsAt:1796604800n};
 const options={nowSeconds:1796000000,recipientCode:'0x'};
 assert.equal(constructorChecklist(p,options).items.find(x=>x.id==='dates').ok,true);
 assert.equal(constructorChecklist(p,options).ready,false,'fixture dates are not user-approved exact dates');
 assert.equal(constructorChecklist({...p,endsAt:p.endsAt+1n},options).items.find(x=>x.id==='dates').ok,false);
 assert.equal(deploymentPackage({artifact:artifact(),params:{...p,endsAt:p.endsAt+1n},nonce:2n}).status,'blocked');
 assert.equal(APPROVED_PAYMENT_POLICY.timing.startsAt,null);
});
test('policy approval and even fixture dates cannot unlock the default live constructor or execute effects',async()=>{
 assert.equal(LIVE_CONSTRUCTOR_PARAMS,null);let calls=0;
 for(const mode of ['broadcast','verify'])await assert.rejects(()=>dispatchDeployment({parsed:{mode,prepareReport:'unused.json'},interactive:true,effects:{broadcast:()=>{calls++;},verify:()=>{calls++;}}}),/Constructor parameters not chosen/);
 assert.equal(calls,0);
 assert.match(readFileSync(new URL('../prototypes/diana-payment-account/diana-deploy.mjs',import.meta.url),'utf8'),/export const LIVE_CONSTRUCTOR_PARAMS = null;/);
});
import {prepareDeployment} from '../prototypes/diana-payment-account/diana-deploy.mjs';
test('default PREPARE reports approved policy with date-only blockers without estimating or completing a constructor',async()=>{
 const calls=[];
 const network={rest:'https://api-testnet.qore.host',evmRpc:'https://evm-testnet.qore.host/',fetch:async(url,init={})=>{
  const u=new URL(url);let result;
  if(init.method==='POST'){
   const q=JSON.parse(init.body);calls.push(q);
   if(q.method==='eth_chainId')result='0x2648';
   else if(q.method==='eth_getTransactionCount')result='0x2';
   else if(q.method==='eth_getBalance')result='0x0';
   else if(q.method==='eth_gasPrice')result='0x1a3185c500';
   else if(q.method==='eth_getCode')result='0x';
   else assert.fail('Unexpected effect: '+q.method);
   return Response.json({jsonrpc:'2.0',id:q.id,result});
  }
  if(u.pathname.endsWith('/node_info'))return Response.json({default_node_info:{network:'qorechain-diana'}});
  if(u.pathname.includes('/accounts/'))return Response.json({}, {status:404});
  if(u.pathname.endsWith('/by_denom'))return Response.json({balance:{denom:'uqor',amount:'0'}});
  if(u.pathname.includes('/pqc/v1/account/'))return Response.json({found:false,account:null});
  if(u.pathname.includes('/feemarket/'))return Response.json({params:{min_gas_price:'0.1',base_fee:'0.100000000000000000'}});
  if(u.pathname.endsWith('/vm/v1/params'))return Response.json({params:{evm_denom:'uqor',extended_denom_options:{extended_denom:'aqor'}}});
  if(u.pathname.endsWith('/protocol_features'))return Response.json({features:[{name:'pqc-sign-bytes-v2',enabled:true}]});
  if(u.pathname.endsWith('/evm_limits'))return Response.json({tx_max_gas:'30000000'});
  if(u.pathname.includes('/evm_window/'))return Response.json({found:false,live:false});
  if(u.pathname.includes('/blocks/')){const h=u.pathname.endsWith('/latest')?2000:Number(u.pathname.split('/').at(-1));return Response.json({block:{header:{height:String(h),time:new Date((1796000000+h-2000)*1000).toISOString()}}});}
  assert.fail('Unexpected fixture read '+u.pathname);
 }};
 const r=await prepareDeployment({network,params:LIVE_CONSTRUCTOR_PARAMS,artifact:artifact(),now:()=>1796000000});
 assert.equal(r.readyToSign,false);assert.equal(r.constructor.policyApproval.approvalStatus,'approved');
 assert.equal(r.constructor.values.recipient,RECIPIENT);assert.equal(r.constructor.values.maxPerPayment,'1000000000000000');
 assert.equal(r.constructor.values.startsAt,null);assert.equal(r.constructor.values.endsAt,null);
 assert.deepEqual(r.constructor.failing,['reviewed','dates']);assert.deepEqual(r.deploymentPackage.missingApprovals,['startsAt','endsAt']);
 assert.equal(r.tx.initcodeKeccak,null);assert.equal(r.tx.gasEstimate,null);
 assert.equal(calls.some(x=>x.method==='eth_estimateGas'),false);
 assert.ok(calls.some(x=>x.method==='eth_getCode'&&x.params[0]===RECIPIENT));
 assert.doesNotThrow(()=>JSON.stringify(r));
});
test('another network or an unrelated supplied policy cannot inherit the Diana approval',()=>{
 const options={nowSeconds:1796000000,recipientCode:'0x'};
 assert.equal(constructorChecklist(null,{...options,plan:{...DEPLOY_PLAN,evmChainId:9801}}).policyApproval,undefined);
 assert.equal(constructorChecklist({...APPROVED_PAYMENT_POLICY.parameters,recipient:OWNER,reviewed:false},options).policyApproval,undefined);
});
test('caller reviewed flags cannot attribute exact-date approval to the 7I-3 policy approval',()=>{
 const p={...APPROVED_PAYMENT_POLICY.parameters,testOnly:false,reviewed:true,startsAt:1796000000n,endsAt:1796604800n};
 const r=constructorChecklist(p,{nowSeconds:1796000000,recipientCode:'0x'});
 assert.deepEqual(r.policyApproval.pendingFields,['startsAt','endsAt']);assert.equal(r.items.find(x=>x.id==='reviewed').ok,false);
 const pack=deploymentPackage({artifact:artifact(),params:p,nonce:2n});assert.equal(pack.status,'blocked');assert.equal(pack.runtimeSha256,null);
});
test('deployment-day eligibility rejects matching seven-day windows starting on another day',()=>{
 for(const offset of [-86400n,86400n]){
  const startsAt=1796000000n+offset;
  const p={...APPROVED_PAYMENT_POLICY.parameters,testOnly:false,reviewed:true,startsAt,endsAt:startsAt+604800n};
  assert.equal(constructorChecklist(p,{nowSeconds:1796000000,recipientCode:'0x'}).items.find(x=>x.id==='dates').ok,false);
 }
});
