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
 assert.equal(p.timing.approvalStatus,'approved');assert.match(p.timing.approvalSource,/2026-11-20/);
 assert.equal(p.timing.plannedDeploymentAt,1795199400n);assert.equal(p.timing.startsAt-p.timing.plannedDeploymentAt,900n);
 assert.equal(p.timing.endsAt-p.timing.startsAt,3600n);
 for(const [value,iso] of [[p.timing.plannedDeploymentAt,'2026-11-20T18:30:00.000Z'],[p.timing.startsAt,'2026-11-20T18:45:00.000Z'],[p.timing.endsAt,'2026-11-20T19:45:00.000Z']])assert.equal(new Date(Number(value)*1000).toISOString(),iso);
 assert.equal(p.timing.durationSeconds,3600n);assert.equal(p.timing.startsAt,1795200300n);assert.equal(p.timing.endsAt,1795203900n);
 for(const value of [p,p.parameters,p.timing])assert.ok(Object.isFrozen(value));
 assert.throws(()=>{p.parameters.recipient=OWNER;},TypeError);
});
test('default constructor remains disabled despite recorded date approval',()=>{
 const r=constructorChecklist(null,{nowSeconds:1795000000,recipientCode:'0x'});
 assert.equal(r.ready,false);assert.deepEqual(r.failing,['reviewed']);
 assert.equal(r.policyApproval.approvalStatus,'approved');assert.deepEqual(r.policyApproval.pendingFields,[]);
 for(const id of ['chosen','executor','invoiceIssuer','recipient-address','recipient-distinct','recipient-code','amounts','maxPayments'])assert.equal(r.items.find(x=>x.id===id).ok,true,id);
 assert.match(r.items.find(x=>x.id==='reviewed').requirement,/dates/i);
});
test('null constructor produces no live runtime pin even with approved dates',()=>{
 const p=deploymentPackage({artifact:artifact(),params:null,nonce:2n});
 assert.equal(p.status,'blocked');assert.deepEqual(p.missingApprovals,[]);assert.equal(p.runtimeSha256,null);assert.equal(p.readinessConfig,null);assert.equal(p.executionAuthorized,false);
 assert.equal(p.policyApproval.approvalStatus,'approved');assert.equal(p.policyApproval.values.maxPerPayment,'1000000000000000');
});
test('approved exact one-hour dates pass and incorrect intervals fail',()=>{
 // Use the exact user-approved schedule; the CLI execution lock remains separate.
 const p={...APPROVED_PAYMENT_POLICY.parameters,testOnly:false,reviewed:true,startsAt:1795200300n,endsAt:1795203900n};
 const options={nowSeconds:1795199300,recipientCode:'0x'};
 assert.equal(constructorChecklist(p,options).items.find(x=>x.id==='dates').ok,true);
 assert.equal(constructorChecklist(p,options).ready,true,'only the recorded approved dates match');
 assert.equal(constructorChecklist({...p,endsAt:p.endsAt+1n},options).items.find(x=>x.id==='dates').ok,false);
 assert.equal(deploymentPackage({artifact:artifact(),params:{...p,endsAt:p.endsAt+1n},nonce:2n}).status,'blocked');
 assert.equal(APPROVED_PAYMENT_POLICY.timing.startsAt,1795200300n);
});
test('policy approval and even fixture dates cannot unlock the default live constructor or execute effects',async()=>{
 assert.equal(LIVE_CONSTRUCTOR_PARAMS,null);let calls=0;
 for(const mode of ['broadcast','verify'])await assert.rejects(()=>dispatchDeployment({parsed:{mode,prepareReport:'unused.json'},interactive:true,effects:{broadcast:()=>{calls++;},verify:()=>{calls++;}}}),/Constructor parameters not chosen/);
 assert.equal(calls,0);
 assert.match(readFileSync(new URL('../prototypes/diana-payment-account/diana-deploy.mjs',import.meta.url),'utf8'),/export const LIVE_CONSTRUCTOR_PARAMS = null;/);
});
import {prepareDeployment} from '../prototypes/diana-payment-account/diana-deploy.mjs';
test('default PREPARE reports approved dates and expired schedule without activating constructor',async()=>{
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
 const r=await prepareDeployment({network,params:LIVE_CONSTRUCTOR_PARAMS,artifact:artifact(),now:()=>{assert.ok(calls.some(x=>x.method==='eth_getCode'),'clock checked after network reads');return 1796000000;}});
 assert.equal(r.readyToSign,false);assert.equal(r.scheduleStatus,'EXPIRED');assert.equal(r.executionAuthorized,false);assert.equal(r.constructor.policyApproval.approvalStatus,'approved');
 assert.equal(r.constructor.values.recipient,RECIPIENT);assert.equal(r.constructor.values.maxPerPayment,'1000000000000000');
 assert.equal(r.constructor.values.startsAt,'1795200300');assert.equal(r.constructor.values.endsAt,'1795203900');
 assert.deepEqual(r.constructor.failing,['reviewed','dates']);assert.deepEqual(r.deploymentPackage.missingApprovals,[]);
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
test('caller reviewed flags cannot substitute different dates for the recorded approval',()=>{
 const p={...APPROVED_PAYMENT_POLICY.parameters,testOnly:false,reviewed:true,startsAt:1796000000n,endsAt:1796003600n};
 const r=constructorChecklist(p,{nowSeconds:1796000000,recipientCode:'0x'});
 assert.deepEqual(r.policyApproval.pendingFields,[]);assert.equal(r.items.find(x=>x.id==='reviewed').ok,false);
 const pack=deploymentPackage({artifact:artifact(),params:p,nonce:2n});assert.equal(pack.status,'blocked');assert.equal(pack.runtimeSha256,null);
});
test('future-start requirement rejects matching windows already begun',()=>{
 for(const offset of [-86400n,0n]){
  const startsAt=1796000000n+offset;
  const p={...APPROVED_PAYMENT_POLICY.parameters,testOnly:false,reviewed:true,startsAt,endsAt:startsAt+3600n};
  assert.equal(constructorChecklist(p,{nowSeconds:1796000000,recipientCode:'0x'}).items.find(x=>x.id==='dates').ok,false);
 }
});

test('one-hour policy can be prepared 15 minutes before start but rejects begun or expired windows',()=>{
 const start=1795200300n;
 const p={...APPROVED_PAYMENT_POLICY.parameters,testOnly:false,reviewed:true,startsAt:start,endsAt:start+3600n};
 const dates=(params,now)=>constructorChecklist(params,{nowSeconds:now,recipientCode:'0x'}).items.find(x=>x.id==='dates').ok;
 assert.equal(APPROVED_PAYMENT_POLICY.timing.startDelaySeconds,900n);
 assert.equal(dates(p,Number(start-901n)),true);
 assert.equal(dates(p,Number(start-900n)),false,'planned deployment deadline is reached');
 assert.equal(dates({...p,recipient:'0x4444444444444444444444444444444444444444'},Number(start-900n)),false,'generic policies retain the one-day guard');
 assert.equal(dates(p,Number(start)),false);
 assert.equal(dates(p,Number(start+3601n)),false);
 assert.equal(dates({...p,endsAt:start+604800n},Number(start-900n)),false);
 assert.equal(dates({...p,endsAt:start+3599n},Number(start-900n)),false);
 assert.equal(dates({...p,startsAt:start+86400n,endsAt:start+90000n},Number(start-901n)),false,'cannot move approved dates');
});

test('approved exact schedule produces public package data without live execution authority',()=>{
 const t=APPROVED_PAYMENT_POLICY.timing;
 const params={...APPROVED_PAYMENT_POLICY.parameters,startsAt:t.startsAt,endsAt:t.endsAt,testOnly:false,reviewed:true};
 const pack=deploymentPackage({artifact:artifact(),params,nonce:2n});
 assert.equal(pack.status,'public_data_only');assert.match(pack.runtimeSha256,/^[a-f0-9]{64}$/);
 assert.equal(pack.executionAuthorized,false);assert.equal(LIVE_CONSTRUCTOR_PARAMS,null);
 const wrongDelay={...params,startsAt:t.startsAt+1n,endsAt:t.endsAt+1n};
 assert.equal(constructorChecklist(wrongDelay,{nowSeconds:1795199300,recipientCode:'0x'}).items.find(x=>x.id==='dates').ok,false);
 assert.equal(deploymentPackage({artifact:artifact(),params:wrongDelay,nonce:2n}).status,'blocked');
 for(const nowSeconds of [1795199400,1795200300,1795203901]){
  const c=constructorChecklist(params,{nowSeconds,recipientCode:'0x'});
  assert.equal(c.scheduleStatus,'EXPIRED');assert.equal(c.ready,false);
 }
 assert.equal(constructorChecklist(params,{nowSeconds:1795199399,recipientCode:'0x'}).scheduleStatus,'VALID');
});
