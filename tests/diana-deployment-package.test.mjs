import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {getContractAddress,keccak256} from 'viem';
import * as deploy from '../prototypes/diana-payment-account/diana-deploy.mjs';
const SOURCE=new URL('../prototypes/diana-payment-account/src/DianaPaymentAccount.sol',import.meta.url);
const ART=new URL('../docs/evidence/diana-deploy-7i2/compiled-contract.json',import.meta.url);
const raw=JSON.parse(readFileSync(ART));
const load=(a=raw)=>deploy.loadDeployArtifact({artifactPath:'artifact.json',sourcePath:'source.sol',read:(p,enc)=>p==='artifact.json'?JSON.stringify(a):readFileSync(SOURCE,enc)});
const artifact=()=>load();
const params=()=>({testOnly:false,reviewed:true,executor:deploy.DEPLOY_PLAN.evm,invoiceIssuer:deploy.DEPLOY_PLAN.evm,recipient:'0x4444444444444444444444444444444444444444',maxPerPayment:1000000000000n,spendingLimit:3000000000000n,maxPayments:3n,startsAt:1796000000n,endsAt:1796604800n});
const sha=hex=>createHash('sha256').update(Buffer.from(hex.slice(2),'hex')).digest('hex');
test('artifact compiler, target, constructor ABI and immutable slot provenance fail closed',()=>{
 const a=artifact();assert.equal(a.compiler,'0.8.28+commit.7893614a');assert.equal(a.evmVersion,'paris');
 for(const edit of [a=>a.bytecode.object='0x00'+a.bytecode.object.slice(4),a=>a.deployedBytecode.object='0x00'+a.deployedBytecode.object.slice(4),a=>{const r=a.deployedBytecode.immutableReferences;[r['149'],r['155']]=[r['155'],r['149']];},a=>a.metadata.compiler.version='0.8.29',a=>a.metadata.settings.evmVersion='shanghai',a=>a.abi.find(x=>x.type==='constructor').inputs.reverse(),a=>Object.values(a.deployedBytecode.immutableReferences)[0][0].start=-1,a=>Object.values(a.deployedBytecode.immutableReferences)[0][0].start=999999,a=>Object.values(a.deployedBytecode.immutableReferences)[0][0].length=31,a=>Object.values(a.deployedBytecode.immutableReferences)[1][0].start=Object.values(a.deployedBytecode.immutableReferences)[0][0].start,a=>Object.values(a.deployedBytecode.immutableReferences)[0].pop()]){
  const r=structuredClone(raw);edit(r);assert.throws(()=>load(r),/Artifact does not match/);
 }
});
test('public package binds all eight arguments to runtime SHA256 and 7I1 policy without an execution permit',()=>{
 assert.equal(typeof deploy.deploymentPackage,'function');
 const a=artifact(),p=params();const pack=deploy.deploymentPackage({artifact:a,params:p,nonce:7n});
 assert.equal(pack.predictedContractAddress,getContractAddress({from:deploy.DEPLOY_PLAN.evm,nonce:7n}));
 assert.equal(pack.runtimeSha256,sha(deploy.expectedRuntimeCode(a,p)));assert.equal(pack.initcodeSha256,sha(a.bytecode+deploy.encodeConstructorArgs(p).slice(2)));
 assert.equal(pack.readinessConfig.expectedRuntimeSha256,pack.runtimeSha256);assert.equal(pack.readinessConfig.policy.maxPerPaymentWei,p.maxPerPayment.toString());
 assert.equal(pack.executionAuthorized,false);assert.equal(pack.readinessConfig.payment,undefined);
 const changed=deploy.deploymentPackage({artifact:a,params:{...p,maxPayments:4n},nonce:7n});assert.notEqual(changed.runtimeSha256,pack.runtimeSha256);
 const moved=deploy.deploymentPackage({artifact:a,params:p,nonce:8n});assert.notEqual(moved.predictedContractAddress,pack.predictedContractAddress);assert.equal(moved.runtimeSha256,pack.runtimeSha256);
});
test('missing, test-only or unreviewed constructor parameters cannot produce a live runtime pin',()=>{
 for(const p of [null,deploy.testConstructorParams(),{...params(),reviewed:false}]){
  const pack=deploy.deploymentPackage({artifact:artifact(),params:p,nonce:2n});assert.equal(pack.status,'blocked');assert.equal(pack.runtimeSha256,null);assert.equal(pack.readinessConfig,null);
 }
 assert.equal(deploy.LIVE_CONSTRUCTOR_PARAMS,null);
});
test('existing deployment CLI retains null and interactive gates without reading records or calling effects',async()=>{
 assert.equal(typeof deploy.dispatchDeployment,'function');let calls=0;
 const effects={prepare:async()=>{calls++;return{};},broadcast:async()=>{calls++;return{};},verify:async()=>{calls++;return{};}};
 for(const mode of ['broadcast','verify'])await assert.rejects(()=>deploy.dispatchDeployment({parsed:{mode},params:null,interactive:true,effects}),/Constructor parameters not chosen/);
 assert.equal(calls,0);
 await assert.rejects(()=>deploy.dispatchDeployment({parsed:{mode:'broadcast'},params:params(),interactive:false,effects}),/Interactive Windows terminal required/);assert.equal(calls,0);
 await deploy.dispatchDeployment({parsed:{mode:'broadcast',prepareReport:'new-public-report.json'},params:params(),interactive:true,effects});assert.equal(calls,1);
 for(const args of [['--broadcast'],['--verify','0x'+'12'.repeat(32)]]){
  const out=spawnSync(process.execPath,[fileURLToPath(new URL('../prototypes/diana-payment-account/diana-deploy.mjs',import.meta.url)),...args],{encoding:'utf8'});assert.notEqual(out.status,0);assert.match(out.stderr,/Constructor parameters not chosen/);
 }
});
import * as sdk from '@qorechain/sdk';
const PUB='0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const TEST_EVM='0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';
const TEST_NATIVE=sdk.qoreAddresses({evm:TEST_EVM}).cosmos;
const KEY=Buffer.alloc(2592,0xab),NOW=1796000000;
const PLAN={...deploy.DEPLOY_PLAN,evm:TEST_EVM,native:TEST_NATIVE,pqcPublicKeySha256:createHash('sha256').update(KEY).digest('hex')};
function fakeReads({nonce=3n,window=true,estimate=1365419n,gasPrice=112500000000n}={}){
 const calls=[];const f={nonce,window,estimate,gasPrice,codes:{},tx:null,receipt:null};
 const fetch=async(url,init={})=>{
  const u=new URL(url);let result;const json=x=>Response.json(x);
  if(init.method==='POST'){
   const q=JSON.parse(init.body);calls.push(q);
   if(q.method==='eth_chainId')result='0x2648';
   else if(q.method==='eth_getTransactionCount')result='0x'+f.nonce.toString(16);
   else if(q.method==='eth_getBalance')result='0x'+(100000000n*10n**12n).toString(16);
   else if(q.method==='eth_gasPrice')result='0x'+f.gasPrice.toString(16);
   else if(q.method==='eth_getCode')result=f.codes[q.params[0].toLowerCase()]??'0x';
   else if(q.method==='eth_estimateGas')result='0x'+f.estimate.toString(16);
   else if(q.method==='eth_getTransactionByHash')result=f.tx;
   else if(q.method==='eth_getTransactionReceipt')result=f.receipt;
   else throw new Error('Forbidden fixture method '+q.method);
   return json({jsonrpc:'2.0',id:q.id,result});
  }
  calls.push({method:'GET',path:u.pathname});
  if(u.pathname.endsWith('/node_info'))return json({default_node_info:{network:'qorechain-diana'}});
  if(u.pathname.includes('/accounts/'))return json({account:{'@type':'/cosmos.auth.v1beta1.BaseAccount',account_number:'16046',sequence:String(f.nonce),pub_key:{'@type':sdk.ETHSECP256K1_PUBKEY_TYPE,key:Buffer.from(PUB,'hex').toString('base64')}}});
  if(u.pathname.endsWith('/by_denom'))return json({balance:{denom:'uqor',amount:'100000000'}});
  if(u.pathname.includes('/pqc/v1/account/'))return json({found:true,account:{algorithm_id:1,public_key:KEY.toString('base64'),possession_proven:true}});
  if(u.pathname.includes('/feemarket/'))return json({params:{min_gas_price:'0.1',base_fee:'0.100000000000000000'}});
  if(u.pathname.endsWith('/vm/v1/params'))return json({params:{evm_denom:'uqor',extended_denom_options:{extended_denom:'aqor'}}});
  if(u.pathname.endsWith('/protocol_features'))return json({features:[{name:'pqc-sign-bytes-v2',enabled:true}]});
  if(u.pathname.endsWith('/evm_limits'))return json({tx_max_gas:'30000000'});
  if(u.pathname.includes('/evm_window/'))return json(f.window?{found:true,live:true,opened_height:'10000000',expiry_height:'10000400',max_txs:'1',used_txs:f.tx?'1':'0',max_value:'256500',used_value:f.tx?'100':'0',remaining_blocks:'400',remaining_txs:f.tx?'0':'1',remaining_value:'256500',native_only:false,allowed_targets:[]}:{found:false,live:false});
  if(u.pathname.includes('/blocks/')){const last=u.pathname.split('/').at(-1),h=last==='latest'?10000000:Number(last);return json({block:{header:{height:String(h),time:new Date((NOW+(h-10000000)*1.425)*1000).toISOString()}}});}
  throw new Error('Unexpected public REST fixture '+u.pathname);
 };
 return {f,calls,network:{...sdk.NETWORKS.testnet.endpoints,fetch:deploy.deployGuardedFetch(sdk.NETWORKS.testnet.endpoints,{fetchImpl:fetch})}};
}
const fixtureParams=()=>({...params(),executor:TEST_EVM,invoiceIssuer:TEST_EVM});
const prepare=async(n,p=fixtureParams())=>deploy.prepareDeployment({network:n.network,plan:PLAN,artifact:artifact(),params:p,now:()=>NOW});
test('PREPARE with no approved policy reads current nonce/fees/window but never estimates placeholder deployment',async()=>{
 const n=fakeReads({nonce:8n,window:false});const r=await prepare(n,null);
 assert.equal(r.readyToSign,false);assert.equal(r.tx.initcodeKeccak,null);assert.equal(r.tx.gasEstimate,null);assert.equal(r.constructor.values,null);assert.equal(r.artifact.runtimeSha256,null);
 assert.equal(n.calls.some(x=>x.method==='eth_estimateGas'),false);
 assert.equal(r.predictedContractAddress,getContractAddress({from:TEST_EVM,nonce:8n}));assert.equal(r.ifWindowOpensFirst.predictedContractAddress,getContractAddress({from:TEST_EVM,nonce:9n}));
 assert.ok(r.blockers.includes('constructor'));assert.equal(r.deploymentPackage.readinessConfig,null);
});
test('reviewed fixture PREPARE retains all deployment window, gas, fee and policy guards',async()=>{
 const n=fakeReads();const r=await prepare(n);assert.equal(r.readyToSign,true);assert.equal(r.tx.gas,'1710000');assert.equal(r.tx.windowCostUqor,'256500');
 assert.equal(r.deploymentPackage.runtimeSha256,r.artifact.runtimeSha256);
 for(const [options,blocked] of [[{window:false},'window-live'],[{estimate:2000000n},'gas'],[{gasPrice:151000000000n},'fee-cap']])assert.ok((await prepare(fakeReads(options))).blockers.includes(blocked));
 const intent=deploy.deploymentIntent(r,fixtureParams(),{plan:PLAN,artifact:artifact()});assert.equal(intent.predictedAddress,r.predictedContractAddress);
 const bad=structuredClone(r);bad.tx.nonce='9007199254740993';assert.throws(()=>deploy.deploymentIntent(bad,fixtureParams(),{plan:PLAN,artifact:artifact()}),/intent does not match/);
});
test('post-deployment verifier rejects wrong network before receipt/code reads',async()=>{
 let calls=0;const network={evmRpc:sdk.NETWORKS.testnet.endpoints.evmRpc,fetch:async()=>{calls++;return Response.json({jsonrpc:'2.0',id:1,result:'0x2649'});}};
 const r=await deploy.verifyDeployment({network,txHash:'0x'+'55'.repeat(32),intent:{}});assert.equal(r.verified,false);assert.deepEqual(r.failures,['Wrong Diana network']);assert.equal(calls,1);
});
test('existing VERIFY CLI parses a retained public PREPARE report and dispatches only read verification',async()=>{
 const hash='0x'+'55'.repeat(32);const parsed=deploy.parseArgs(['--verify',hash,'--prepare-report','approved.json']);assert.equal(parsed.prepareReport,'approved.json');
 let calls=0;await deploy.dispatchDeployment({parsed,params:params(),effects:{verify:async()=>{calls++;}}});assert.equal(calls,1);
 await assert.rejects(()=>deploy.dispatchDeployment({parsed:{mode:'verify',txHash:hash},params:params(),effects:{}}),/Preparation report required/);
});

test('post-deployment VERIFY binds transaction hash, fees, access list and receipt inclusion to the prepared intent',async()=>{
 const n=fakeReads();const p=fixtureParams(),prepared=await prepare(n),intent=deploy.deploymentIntent(prepared,p,{plan:PLAN,artifact:artifact()});
 const hash='0x'+'55'.repeat(32),blockHash='0x'+'66'.repeat(32);
 const tx={hash,type:'0x2',chainId:'0x2648',from:TEST_EVM,to:null,nonce:'0x3',gas:'0x'+intent.tx.gas.toString(16),value:'0x0',input:intent.tx.data,maxFeePerGas:'0x'+intent.tx.maxFeePerGas.toString(16),maxPriorityFeePerGas:'0x'+intent.tx.maxPriorityFeePerGas.toString(16),accessList:[],blockHash,blockNumber:'0x989680'};
 const receipt={transactionHash:hash,status:'0x1',from:TEST_EVM,to:null,contractAddress:intent.predictedAddress,blockHash,blockNumber:'0x989680',gasUsed:'0x100'};
 n.f.nonce=4n;n.f.codes[intent.predictedAddress.toLowerCase()]=intent.expectedRuntime;
 n.f.tx=tx;n.f.receipt=receipt;
 assert.equal((await deploy.verifyDeployment({network:n.network,txHash:hash,intent})).verified,true);
 for(const edit of [x=>x.tx.maxFeePerGas='0x1',x=>x.tx.maxPriorityFeePerGas='0x1',x=>x.tx.accessList=[{address:TEST_EVM,storageKeys:[]}],x=>x.tx.hash='0x'+'77'.repeat(32),x=>x.receipt.transactionHash='0x'+'77'.repeat(32),x=>x.receipt.blockHash='0x'+'77'.repeat(32),x=>x.receipt.gasUsed='0xffffff',x=>x.tx.to=undefined]){
  const c={tx:structuredClone(tx),receipt:structuredClone(receipt)};edit(c);n.f.tx=c.tx;n.f.receipt=c.receipt;
  assert.equal((await deploy.verifyDeployment({network:n.network,txHash:hash,intent})).verified,false);
 }
});

test('CLI reporter saves one public JSON expectation with exclusive creation and usable VERIFY argv',()=>{
 const saved=[],out=[];const writer=deploy.deploymentReporter({prepareReport:'new report.json',write:r=>out.push(r),save:(path,data,options)=>{if(saved.length)throw new Error('EEXIST');saved.push({path,data,options});}});
 writer({mode:'prepare',signed:false,readyToSign:true});assert.equal(saved[0].options.flag,'wx');assert.equal(JSON.parse(saved[0].data).mode,'prepare');
 writer({mode:'broadcast',txHash:'0x'+'55'.repeat(32),verify:{conditions:[]}});assert.deepEqual(out[1].verify.argv,['node','diana-deploy.mjs','--verify','0x'+'55'.repeat(32),'--prepare-report','new report.json']);
 assert.throws(()=>writer({mode:'prepare'}),/EEXIST/);assert.equal(out.length,2);
});
