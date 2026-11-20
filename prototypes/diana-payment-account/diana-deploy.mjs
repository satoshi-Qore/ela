// Diana Invoice Owner: deploy DianaPaymentAccount through the one-transaction EVM window that
// diana-window-open.mjs (7C-23) opens. EVM lane only.
//
// Signing formats are kept apart on purpose:
//   - the WINDOW is a Cosmos transaction: SignDoc (protobuf) signed with keccak256 + eth_secp256k1,
//     plus an ML-DSA-87 signature over the v2 hybrid sign bytes (diana-window-open.mjs);
//   - the DEPLOYMENT is a plain EVM EIP-1559 (type 2) transaction: secp256k1 over
//     keccak256(0x02 || rlp([chainId 9800, nonce, maxPriorityFeePerGas, maxFeePerGas, gas, to = empty,
//     value 0, data = initcode, accessList = []])). It carries no PQC signature; Diana admits it only
//     because the sender holds a registered ML-DSA-87 key AND a live window (SDK 0.14.0,
//     @qorechain/evm). The window's max_value bounds value + gas x maxFeePerGas, in uqor rounded up.
// This file has no Cosmos signing code and no Cosmos simulation or broadcast route.
//
// Phases, kept apart:
//   PREPARE   `prepareDeployment`   read-only: every condition as a named check, the exact unsigned
//                                   transaction, the predicted CREATE address. Never throws on a
//                                   failed condition; it reports blockers.
//   BUILD     `deploymentIntent`    a frozen intent, only from a PREPARE with no blockers.
//   SIGN      `signDeployment`      one EIP-1559 signature.
//   CHECK     `deploymentFormatFailures` + `dryRunCreation`: decoded fields, recovered sender, and an
//                                   eth_call of the creation that must return the expected runtime code.
//   BROADCAST `broadcastOnce`       eth_sendRawTransaction once, never retried.
//   VERIFY    `verifyDeployment`    read-only: receipt, address, on-chain runtime code, nonce, window.
//
// Default PREPARE never substitutes test parameters for missing live approval. Broadcast and
// verify remain refused while LIVE_CONSTRUCTOR_PARAMS is null. After separate approval, the
// existing CLI uses --prepare-report to preserve public expectations without signed bytes.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sdk from '@qorechain/sdk';
import { evmWindowCost, parseEvmWindow } from '@qorechain/evm/window';
import {
  encodeAbiParameters, getAddress, getContractAddress, isAddress, keccak256, parseTransaction, recoverTransactionAddress,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { classicalKeyHex, fetchLiveState } from './diana-hybrid-prepare.mjs';
import { readParsedRecord } from './diana-hybrid-sign.mjs';
import { withVerifiedAccount } from './diana-canonical-pqc.mjs';
import { INVOICE_OWNER, RECORD_PATH, readRecordBytes } from './diana-verify-recovery.mjs';
import { WINDOW_PLAN, fetchEvmState, loadArtifact } from './diana-window-prepare.mjs';

const GWEI = 10n ** 9n;
const WEI_PER_UQOR = 10n ** 12n;
const DAY = 86400;

/** The deployment plan. Fee and gas values are the ones the 7C-22 window was sized for. */
export const DEPLOY_PLAN = Object.freeze({
  chainId: WINDOW_PLAN.chainId,
  evmChainId: 9800,
  native: WINDOW_PLAN.native,
  evm: WINDOW_PLAN.evm,
  accountNumber: WINDOW_PLAN.accountNumber,
  pqcPublicKeySha256: WINDOW_PLAN.pqcPublicKeySha256,
  gasMultiplier: 1.25,
  // The window's max_value (256,500 uqor) was sized for 1,710,000 gas at 150 gwei; nothing above that is signed.
  maxGasLimit: 1_710_000n,
  maxFeePerGasWei: 150n * GWEI,
  maxPriorityFeePerGasWei: 25n * GWEI / 2n,
  valueWei: 0n,
  windowMaxTxs: 1n,
  maxWindowValueUqor: 300000n,
  // About 43 s at Diana's ~1.43 s blocks: room to re-check, confirm and send.
  minWindowBlocksLeft: 30n,
});

/**
 * The constructor parameters for the LIVE deployment. Null on purpose: the recipient has not been
 * chosen. While this is null, signing, broadcasting and verification refuse to start.
 */
export const LIVE_CONSTRUCTOR_PARAMS = null;

/** Ceilings a live parameter set must stay under. They are review guards, not chosen values. */
export const LIVE_PARAM_LIMITS = Object.freeze({
  maxSpendingLimitWei: 10n ** 18n, // 1 QOR
  maxPayments: 100n,
  maxDurationSeconds: 365 * DAY,
  maxStartDelaySeconds: 30 * DAY,
  minRemainingSeconds: DAY,
});

const PLACEHOLDER_RECIPIENT = '0x3333333333333333333333333333333333333333';

/**
 * TEST-ONLY constructor parameters, for PREPARE and the tests. The recipient is a placeholder and
 * the amounts and dates are arbitrary; they are never accepted for signing by the CLI.
 */
export function testConstructorParams(plan = DEPLOY_PLAN, nowSeconds = Math.floor(Date.now() / 1000)) {
  return Object.freeze({
    testOnly: true, reviewed: false,
    executor: plan.evm, recipient: PLACEHOLDER_RECIPIENT, invoiceIssuer: plan.evm,
    maxPerPayment: WEI_PER_UQOR, spendingLimit: 3n * WEI_PER_UQOR, maxPayments: 3n,
    startsAt: BigInt(nowSeconds), endsAt: BigInt(nowSeconds + 7 * DAY),
  });
}

export const CONSTRUCTOR_TYPES = Object.freeze([
  { type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'address' },
]);
const constructorValues = p => [p.executor, p.recipient, p.maxPerPayment, p.spendingLimit, p.maxPayments, p.startsAt, p.endsAt, p.invoiceIssuer];
export const encodeConstructorArgs = params => encodeAbiParameters(CONSTRUCTOR_TYPES, constructorValues(params));

const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && isAddress(a, { strict: false }) && isAddress(b, { strict: false }) && a.toLowerCase() === b.toLowerCase();
const isUint = v => typeof v === 'bigint' && v >= 0n && v < 2n ** 256n;

/**
 * The live constructor checklist. Every item must pass before a live deployment can be signed.
 * `recipientCode` is the recipient's eth_getCode answer (`'0x'` for an account without code).
 */
export function constructorChecklist(params, { plan = DEPLOY_PLAN, nowSeconds, predictedAddress, recipientCode, limits = LIVE_PARAM_LIMITS } = {}) {
  const p = params ?? {};
  const now = BigInt(nowSeconds);
  const recipientValid = typeof p.recipient === 'string' && isAddress(p.recipient, { strict: false }) && p.recipient === getAddress(p.recipient);
  const recipientValue = recipientValid ? BigInt(p.recipient) : 0n;
  const items = [
    ['chosen', 'Parameters chosen for the live deployment (not the test set)', params !== null && params !== undefined && p.testOnly !== true],
    ['reviewed', 'Every value below reviewed and approved by the Invoice Owner (reviewed: true)', p.reviewed === true],
    ['executor', 'executor is the Invoice Owner EVM address ' + plan.evm, sameAddress(p.executor, plan.evm)],
    ['invoiceIssuer', 'invoiceIssuer is the Invoice Owner EVM address (7C-21), which holds the registered ML-DSA-87 key', sameAddress(p.invoiceIssuer, plan.evm)],
    ['recipient-address', 'recipient is a checksummed address, not zero, not a precompile, not the placeholder', recipientValid && recipientValue > 0xffffn && !sameAddress(p.recipient, PLACEHOLDER_RECIPIENT)],
    ['recipient-distinct', 'recipient is not the executor, the issuer, or the contract itself', recipientValid && !sameAddress(p.recipient, p.executor) && !sameAddress(p.recipient, p.invoiceIssuer) && !sameAddress(p.recipient, predictedAddress)],
    ['recipient-code', 'recipient has no contract code on Diana (a plain account that can receive native QOR)', recipientCode === '0x'],
    ['amounts', 'maxPerPayment > 0, maxPerPayment <= spendingLimit <= ' + limits.maxSpendingLimitWei + ' wei, both whole uqor (multiples of 10^12 wei)',
      isUint(p.maxPerPayment) && isUint(p.spendingLimit) && p.maxPerPayment > 0n && p.maxPerPayment <= p.spendingLimit
        && p.spendingLimit <= limits.maxSpendingLimitWei && p.maxPerPayment % WEI_PER_UQOR === 0n && p.spendingLimit % WEI_PER_UQOR === 0n],
    ['maxPayments', 'maxPayments between 1 and ' + limits.maxPayments, isUint(p.maxPayments) && p.maxPayments >= 1n && p.maxPayments <= limits.maxPayments],
    ['dates', 'startsAt < endsAt; endsAt at least 1 day ahead; at most 1 year long; starts within 30 days',
      isUint(p.startsAt) && isUint(p.endsAt) && p.startsAt < p.endsAt && p.endsAt >= now + BigInt(limits.minRemainingSeconds)
        && p.endsAt - p.startsAt <= BigInt(limits.maxDurationSeconds) && p.startsAt <= now + BigInt(limits.maxStartDelaySeconds)],
  ].map(([id, requirement, ok]) => ({ id, requirement, ok: ok === true }));
  return { items, ready: items.every(i => i.ok), failing: items.filter(i => !i.ok).map(i => i.id) };
}

// ---- Network ----
const EVM_READ_METHODS = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getTransactionCount', 'eth_getBalance', 'eth_gasPrice', 'eth_estimateGas', 'eth_getCode', 'eth_call', 'eth_getTransactionByHash', 'eth_getTransactionReceipt']);

/**
 * HTTPS to the two Diana hosts only: GET on REST (no Cosmos simulation or broadcast route at all),
 * read-only EVM methods, and `eth_sendRawTransaction` only while `allowBroadcast()` is true and only
 * once per guard. `eth_call` is accepted only for a contract creation (no `to`).
 */
export function deployGuardedFetch(endpoints, { allowBroadcast = () => false, fetchImpl = globalThis.fetch } = {}) {
  const rest = new URL(endpoints.rest);
  const evm = new URL(endpoints.evmRpc);
  let broadcastUsed = false;
  return async (url, init = {}) => {
    const target = new URL(String(url));
    const method = (init.method ?? 'GET').toUpperCase();
    let allowed = false;
    if (target.protocol === 'https:' && target.host === rest.host) {
      allowed = method === 'GET';
    } else if (target.protocol === 'https:' && target.host === evm.host && method === 'POST') {
      let call;
      try { call = JSON.parse(init.body); } catch { call = undefined; }
      if (call?.method === 'eth_sendRawTransaction') {
        allowed = allowBroadcast() === true && !broadcastUsed;
        if (allowed) broadcastUsed = true;
      } else if (call?.method === 'eth_call') {
        allowed = call.params?.[0] && call.params[0].to === undefined;
      } else {
        allowed = EVM_READ_METHODS.has(call?.method);
      }
    }
    if (!allowed) throw new Error('Network request blocked');
    return fetchImpl(target.href, { ...init, redirect: 'error', credentials: 'omit' });
  };
}

export function dianaDeployNetwork(fetchImpl = globalThis.fetch) {
  const { rest, evmRpc } = sdk.NETWORKS.testnet.endpoints;
  const allowBroadcast = { value: false };
  return { rest, evmRpc, allowBroadcast, fetch: deployGuardedFetch({ rest, evmRpc }, { allowBroadcast: () => allowBroadcast.value, fetchImpl }) };
}

async function rpc(network, method, params) {
  let body;
  try {
    body = await (await network.fetch(network.evmRpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json();
  } catch (error) {
    if (error?.message === 'Network request blocked') throw error;
    throw new Error('Chain state unreadable');
  }
  return body?.error ? { error: body.error } : { result: body?.result };
}

async function restJson(network, route) {
  try {
    const response = await network.fetch(network.rest.replace(/\/+$/, '') + route);
    return { status: response.status, body: await response.json() };
  } catch (error) {
    if (error?.message === 'Network request blocked') throw error;
    throw new Error('Chain state unreadable');
  }
}

// ---- Artifact and expected runtime code ----

/**
 * The artifact, refused unless compiled from this folder's source (7C-22 `loadArtifact`), with its
 * runtime code and immutable references. Immutables are matched to names by declaration order (the
 * compiler numbers AST nodes in source order).
 */
export function loadDeployArtifact({ artifactPath, sourcePath, read = readFileSync } = {}) {
  let artifactText;
  const capture = (p, enc) => { const data = read(p, enc); if (String(p).endsWith('.json')) artifactText = data; return data; };
  let base;
  try {
    base = loadArtifact({ ...(artifactPath ? { artifactPath } : {}), ...(sourcePath ? { sourcePath } : {}), read: capture });
  } catch {
    throw new Error('Artifact does not match the contract source');
  }
  const raw = JSON.parse(artifactText);
  const pin = JSON.parse(readFileSync(new URL('./deployment-artifact-manifest.json',import.meta.url),'utf8'));
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const rawRefs = raw.deployedBytecode?.immutableReferences ?? {};
  const mapping = Object.keys(rawRefs).sort((a,b)=>Number(a)-Number(b)).map(id=>[id,rawRefs[id]]);
  if (base.sourceKeccak!==pin.sourceKeccak || base.compiler!==pin.compiler || base.evmVersion!==pin.evmVersion
    || sha(Buffer.from(base.bytecode.slice(2),'hex'))!==pin.creationBytecodeSha256
    || typeof raw.deployedBytecode?.object!=='string' || sha(Buffer.from(raw.deployedBytecode.object.slice(2),'hex'))!==pin.runtimeTemplateSha256
    || sha(JSON.stringify(mapping))!==pin.immutableReferencesSha256) throw new Error('Artifact does not match the contract source');
  const source = String(read(sourcePath ?? fileURLToPath(new URL('./src/DianaPaymentAccount.sol', import.meta.url)), 'utf8'));
  const names = [...source.matchAll(/^\s*(?:address(?: payable)?|uint256) public immutable (\w+);/gm)].map(m => m[1]);
  const refs = raw.deployedBytecode?.immutableReferences ?? {};
  const ids = Object.keys(refs).map(Number).sort((a, b) => a - b);
  if (typeof raw.deployedBytecode?.object !== 'string' || !/^0x[0-9a-f]+$/i.test(raw.deployedBytecode.object) || ids.length !== names.length) {
    throw new Error('Artifact does not match the contract source');
  }
  const expectedNames = ['executor','recipient','invoiceIssuer','maxPerPayment','spendingLimit','maxPayments','startsAt','endsAt'];
  const constructor = raw.abi?.find(item => item.type === 'constructor');
  if (base.compiler !== '0.8.28+commit.7893614a' || base.evmVersion !== 'paris'
    || JSON.stringify(names) !== JSON.stringify(expectedNames)
    || constructor?.stateMutability !== 'nonpayable'
    || JSON.stringify(constructor?.inputs?.map(item => [item.name,item.type])) !== JSON.stringify([
      ['executor_','address'],['recipient_','address'],['maxPerPayment_','uint256'],['spendingLimit_','uint256'],
      ['maxPayments_','uint256'],['startsAt_','uint256'],['endsAt_','uint256'],['invoiceIssuer_','address'],
    ])) throw new Error('Artifact does not match the contract source');
  const immutables = Object.fromEntries(names.map((name, i) => [name, refs[String(ids[i])]]));
  const occupied = new Set();
  const counts = [2,4,3,2,2,2,2,2];
  for (const [i,name] of names.entries()) {
    if (!Array.isArray(immutables[name]) || immutables[name].length !== counts[i]) throw new Error('Artifact does not match the contract source');
    for (const slot of immutables[name]) {
      if (!Number.isSafeInteger(slot.start) || slot.start < 0 || slot.length !== 32 || slot.start + 32 > (raw.deployedBytecode.object.length-2)/2
        || !/^0{64}$/.test(raw.deployedBytecode.object.slice(2+slot.start*2,2+(slot.start+32)*2))) throw new Error('Artifact does not match the contract source');
      for(let at=slot.start;at<slot.start+32;at++) {
        if(occupied.has(at)) throw new Error('Artifact does not match the contract source');
        occupied.add(at);
      }
    }
  }

  const rawSource = Buffer.from(source), lfSource = Buffer.from(source.replace(/\r\n/g,'\n'));
  const compiledSource = keccak256(rawSource) === base.sourceKeccak ? rawSource : lfSource;
  return Object.freeze({ ...base, sourceSha256:createHash('sha256').update(compiledSource).digest('hex'), deployedBytecode: raw.deployedBytecode.object, immutables });
}

/** The runtime code the contract must have once deployed with these constructor values. */
export function expectedRuntimeCode(artifact, params) {
  if (!params) throw new Error('Constructor parameters not chosen');
  const code = Buffer.from(artifact.deployedBytecode.slice(2), 'hex');
  const values = { executor: params.executor, recipient: params.recipient, invoiceIssuer: params.invoiceIssuer, maxPerPayment: params.maxPerPayment, spendingLimit: params.spendingLimit, maxPayments: params.maxPayments, startsAt: params.startsAt, endsAt: params.endsAt };
  for (const [name, ranges] of Object.entries(artifact.immutables)) {
    const value=BigInt(values[name]);
    if(value<0n||value>=2n**256n)throw new Error('Deployment intent does not match the plan');
    const word=Buffer.from(value.toString(16).padStart(64,'0'),'hex');
    for(const {start,length} of ranges){
      if(!Number.isSafeInteger(start)||start<0||length!==32||start+32>code.length)throw new Error('Artifact does not match the contract source');
      word.copy(code,start,0,length);
    }
  }
  return '0x' + code.toString('hex');
}

/** Public, reproducible deployment data only. A template hash is never a live runtime pin. */
export function deploymentPackage({artifact,params,nonce,plan=DEPLOY_PLAN}) {
  const hash = hex => createHash('sha256').update(Buffer.from(hex.slice(2),'hex')).digest('hex');
  const base = {version:1,executionAuthorized:false,compiler:artifact.compiler,evmVersion:artifact.evmVersion,
    sourceKeccak:artifact.sourceKeccak,sourceSha256:artifact.sourceSha256,
    creationBytecodeSha256:hash(artifact.bytecode),runtimeTemplateSha256:hash(artifact.deployedBytecode),
    nonce:BigInt(nonce).toString(),predictedContractAddress:getContractAddress({from:plan.evm,nonce:BigInt(nonce)})};
  const missing = ['recipient','maxPerPayment','spendingLimit','maxPayments','startsAt','endsAt'];
  if(!params||params.testOnly===true||params.reviewed!==true) return {...base,status:'blocked',missingApprovals:missing,runtimeSha256:null,readinessConfig:null};
  // Structural approval guards stay reproducible even after the policy expires. Live date and
  // recipient-code checks remain mandatory in PREPARE; this package never means readyToSign.
  const checklist=constructorChecklist(params,{plan,nowSeconds:Number(params.startsAt),predictedAddress:base.predictedContractAddress});
  if(checklist.failing.some(id=>id!=='recipient-code'))return {...base,status:'blocked',missingApprovals:checklist.failing.filter(id=>id!=='recipient-code'),runtimeSha256:null,readinessConfig:null};
  const args=encodeConstructorArgs(params),initcode=artifact.bytecode+args.slice(2),runtime=expectedRuntimeCode(artifact,params);
  const runtimeSha256=hash(runtime);
  return {...base,status:'public_data_only',constructor:Object.fromEntries(Object.entries(params).map(([k,v])=>[k,typeof v==='bigint'?v.toString():v])),
    constructorArgs:args,initcodeSha256:hash(initcode),initcodeKeccak:keccak256(initcode),runtimeSha256,runtimeKeccak:keccak256(runtime),
    readinessConfig:{contractAddress:base.predictedContractAddress,executor:params.executor,invoiceIssuer:params.invoiceIssuer,expectedRuntimeSha256:runtimeSha256,
      pqcKeySha256:{executor:plan.pqcPublicKeySha256,invoiceIssuer:plan.pqcPublicKeySha256},
      policy:{recipient:params.recipient,maxPerPaymentWei:params.maxPerPayment.toString(),spendingLimitWei:params.spendingLimit.toString(),maxPayments:params.maxPayments.toString(),startsAt:params.startsAt.toString(),endsAt:params.endsAt.toString()}}};
}

// ---- PREPARE ----

/** Named, read-only checks of everything the deployment depends on; the unsigned transaction; the predicted address. */
export async function prepareDeployment({ network, plan = DEPLOY_PLAN, artifact, params, now = () => Math.floor(Date.now() / 1000), write = () => {} }) {
  const nowSeconds = now();
  const live = await fetchLiveState(plan.native, network);
  const evm = await fetchEvmState(plan, network);
  const pending = await rpc(network, 'eth_getTransactionCount', [plan.evm, 'pending']);
  const limitsBody = await restJson(network, '/qorechain/pqc/v1/evm_limits');
  const txMaxGas = BigInt(limitsBody.body?.tx_max_gas ?? limitsBody.body?.limits?.tx_max_gas ?? sdk.EVM_TX_MAX_GAS_DEFAULT);
  const window = parseEvmWindow(evm.window);

  const nonce = BigInt(evm.nonce);
  const predictedAddress = getContractAddress({ from: plan.evm, nonce });
  const initcode = params ? artifact.bytecode + encodeConstructorArgs(params).slice(2) : null;
  const estimate = initcode ? await rpc(network, 'eth_estimateGas', [{ from: plan.evm, data: initcode, value: '0x0' }, 'latest']) : {};
  const gasEstimate = typeof estimate.result === 'string' ? BigInt(estimate.result) : undefined;
  const gasLimit = gasEstimate === undefined ? undefined : ((BigInt(Math.ceil(Number(gasEstimate) * plan.gasMultiplier)) + 9999n) / 10000n) * 10000n;
  const maxCostWei = gasLimit === undefined ? undefined : plan.valueWei + gasLimit * plan.maxFeePerGasWei;
  const windowCostUqor = gasLimit === undefined ? undefined : evmWindowCost({ value: plan.valueWei, gas: gasLimit, maxFeePerGas: plan.maxFeePerGasWei });
  const addressCode = await rpc(network, 'eth_getCode', [predictedAddress, 'latest']);
  const recipientCode = params?.recipient && isAddress(params.recipient, { strict: false }) ? (await rpc(network, 'eth_getCode', [params.recipient, 'latest'])).result : undefined;
  const checklist = constructorChecklist(params, { plan, nowSeconds, predictedAddress, recipientCode });

  const checks = [
    ['chain', 'Cosmos chain ' + plan.chainId + ', EVM chain ID ' + plan.evmChainId, live.chainId === plan.chainId && live.evmChainId === plan.evmChainId],
    ['deployer', 'Deployer is the Invoice Owner (account ' + plan.accountNumber + ', on-chain eth_secp256k1 key of ' + plan.evm + ')',
      live.account?.exists === true && live.account.accountNumber === plan.accountNumber && classicalKeyHex(live, plan) !== undefined && sameAddress(sdk.qorToEvm(plan.native), plan.evm)],
    ['pqc', 'Registered ML-DSA-87 key is the expected key',
      live.pqc?.registered === true && live.pqc.algorithmId === sdk.AlgorithmDilithium5 && live.pqc.publicKey instanceof Uint8Array && createHash('sha256').update(live.pqc.publicKey).digest('hex') === plan.pqcPublicKeySha256],
    ['window-live', 'Window found and live, at least ' + plan.minWindowBlocksLeft + ' blocks left', window.found && window.live && window.remainingBlocks >= plan.minWindowBlocksLeft],
    ['window-unused', 'Window unused (0 transactions, 0 value)', window.found && window.usedTxs === 0n && window.usedValue === 0n],
    ['window-untargeted', 'Window has no allowedTargets and is not native-only (contract creation allowed)', window.found && window.allowedTargets.length === 0 && window.nativeOnly === false],
    ['window-bounds', 'Window maxTxs ' + plan.windowMaxTxs + '; maxValue at most ' + plan.maxWindowValueUqor + ' uqor and covering the deployment',
      window.found && window.maxTxs === plan.windowMaxTxs && window.remainingTxs >= 1n && window.maxValue <= plan.maxWindowValueUqor && windowCostUqor !== undefined && window.remainingValue >= windowCostUqor],
    ['nonce', 'EVM nonce read live: latest = pending = Cosmos sequence', typeof pending.result === 'string' && BigInt(pending.result) === nonce && live.account?.sequence === nonce.toString()],
    ['gas', 'Deployment estimate succeeded; gas limit within ' + plan.maxGasLimit + ' and the chain EVM cap', gasLimit !== undefined && gasLimit <= plan.maxGasLimit && gasLimit <= txMaxGas],
    ['fee-cap', 'maxFeePerGas ' + plan.maxFeePerGasWei + ' wei >= live gas price and base fee; priority fee <= fee cap',
      evm.baseFeeWei !== undefined && plan.maxFeePerGasWei >= evm.gasPriceWei && plan.maxFeePerGasWei >= evm.baseFeeWei && plan.maxPriorityFeePerGasWei <= plan.maxFeePerGasWei],
    ['balance', 'Balance covers value + gas limit x fee cap', maxCostWei !== undefined && evm.balanceWei >= maxCostWei],
    ['units', 'EVM denom uqor, 1 uqor = 10^12 wei (balances agree)', evm.evmDenom === 'uqor' && evm.balanceWei === BigInt(live.uqor) * WEI_PER_UQOR],
    ['artifact', 'Artifact compiled from src/DianaPaymentAccount.sol (source hash ' + artifact.sourceKeccak.slice(0, 10) + '...)', typeof artifact.sourceKeccak === 'string' && artifact.immutables !== undefined],
    ['address-free', 'No code at the predicted contract address', addressCode.result === '0x'],
    ['constructor', 'Live constructor parameters chosen and every checklist item passes', checklist.ready],
  ].map(([id, requirement, ok]) => ({ id, requirement, ok: ok === true }));

  const report = {
    mode: 'prepare', signed: false, broadcast: false, deployed: false,
    readyToSign: checks.every(c => c.ok), blockers: checks.filter(c => !c.ok).map(c => c.id), checks,
    signingFormat: 'EVM EIP-1559 (type 2), secp256k1 over keccak256(0x02 || rlp(fields)), chain ID ' + plan.evmChainId + '. Not a Cosmos SignDoc; no PQC signature in the EVM transaction.',
    tx: {
      type: 'eip1559', chainId: plan.evmChainId, from: plan.evm, to: null, nonce: nonce.toString(), value: plan.valueWei.toString(),
      gasEstimate: gasEstimate?.toString() ?? null, gas: gasLimit?.toString() ?? null,
      maxFeePerGas: plan.maxFeePerGasWei.toString(), maxPriorityFeePerGas: plan.maxPriorityFeePerGasWei.toString(),
      initcodeBytes: initcode ? (initcode.length - 2) / 2 : null, initcodeKeccak: initcode ? keccak256(initcode) : null, maxCostWei: maxCostWei?.toString() ?? null, windowCostUqor: windowCostUqor?.toString() ?? null,
    },
    predictedContractAddress: predictedAddress,
    ...(window.found ? {} : { ifWindowOpensFirst: { nonce: (nonce + 1n).toString(), predictedContractAddress: getContractAddress({ from: plan.evm, nonce: nonce + 1n }) } }),
    live: {
      sequence: live.account?.sequence ?? null, evmNonce: nonce.toString(), pendingNonce: typeof pending.result === 'string' ? BigInt(pending.result).toString() : null,
      uqorBalance: live.uqor, gasPriceWei: evm.gasPriceWei.toString(), baseFeeWei: evm.baseFeeWei?.toString() ?? null, evmTxMaxGas: txMaxGas.toString(), height: evm.height.toString(),
      pqcPublicKeySha256: live.pqc?.publicKey instanceof Uint8Array ? createHash('sha256').update(live.pqc.publicKey).digest('hex') : null,
    },
    window: {
      found: window.found, live: window.live, openedHeight: window.openedHeight.toString(), expiryHeight: window.expiryHeight.toString(),
      maxTxs: window.maxTxs.toString(), usedTxs: window.usedTxs.toString(), maxValue: window.maxValue.toString(), usedValue: window.usedValue.toString(),
      remainingBlocks: window.remainingBlocks.toString(), remainingTxs: window.remainingTxs.toString(), remainingValue: window.remainingValue.toString(),
      nativeOnly: window.nativeOnly, allowedTargets: window.allowedTargets,
    },
    constructor: {
      testOnly: params?.testOnly === true,
      values: params ? Object.fromEntries(Object.entries(params).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v])) : null,
      argsKeccak: params ? keccak256(encodeConstructorArgs(params)) : null, checklist: checklist.items, failing: checklist.failing,
    },
    deploymentPackage: deploymentPackage({artifact,params,nonce,plan}),
    artifact: { compiler: artifact.compiler, evmVersion: artifact.evmVersion, sourceKeccak: artifact.sourceKeccak, runtimeKeccak: params ? keccak256(expectedRuntimeCode(artifact, params)) : null, runtimeSha256: params && params.testOnly !== true && params.reviewed === true ? createHash('sha256').update(Buffer.from(expectedRuntimeCode(artifact,params).slice(2),'hex')).digest('hex') : null },
  };
  write(report);
  return report;
}

/** The chain facts a PREPARE depends on; block-by-block values (height, remaining blocks) are left out. */
export function deployFingerprint(report) {
  const { height, ...live } = report.live ?? {};
  const { remainingBlocks, ...window } = report.window ?? {};
  return JSON.stringify([report.readyToSign, report.blockers, report.tx, report.predictedContractAddress, live, window, report.constructor?.argsKeccak, report.artifact]);
}

// ---- BUILD ----

/** A frozen intent from a PREPARE with no blockers. Test parameters are refused unless the caller is a test. */
export function deploymentIntent(prepared, params, { plan = DEPLOY_PLAN, artifact, acceptTestParams = false } = {}) {
  if (!params || (params.testOnly === true && acceptTestParams !== true)) throw new Error('Constructor parameters not chosen');
  if (prepared?.mode !== 'prepare' || prepared.signed !== false || prepared.readyToSign !== true || prepared.blockers.length) throw new DeployCheckError(prepared?.blockers ?? ['prepare']);
  const t = prepared.tx;
  if (!/^(0|[1-9][0-9]*)$/.test(t.nonce) || BigInt(t.nonce)>BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Deployment intent does not match the plan');
  const initcode = artifact.bytecode + encodeConstructorArgs(params).slice(2);
  if (t.type !== 'eip1559' || t.chainId !== plan.evmChainId || !sameAddress(t.from, plan.evm) || t.to !== null || t.value !== '0'
    || BigInt(t.gas) > plan.maxGasLimit || t.maxFeePerGas !== plan.maxFeePerGasWei.toString() || t.maxPriorityFeePerGas !== plan.maxPriorityFeePerGasWei.toString()
    || t.initcodeKeccak !== keccak256(initcode) || prepared.constructor.argsKeccak !== keccak256(encodeConstructorArgs(params))) {
    throw new Error('Deployment intent does not match the plan');
  }
  const tx = Object.freeze({
    type: 'eip1559', chainId: plan.evmChainId, nonce: Number(t.nonce), gas: BigInt(t.gas), maxFeePerGas: plan.maxFeePerGasWei,
    maxPriorityFeePerGas: plan.maxPriorityFeePerGasWei, value: plan.valueWei, data: initcode, accessList: [],
  });
  return Object.freeze({
    tx, from: plan.evm, predictedAddress: getContractAddress({ from: plan.evm, nonce: BigInt(t.nonce) }),
    expectedRuntime: expectedRuntimeCode(artifact, params), fingerprint: deployFingerprint(prepared), plan,
  });
}

export class DeployCheckError extends Error {
  constructor(failures) { super('Deployment check failed'); this.failures = failures; }
}

// ---- SIGN ----

/** SIGN: one EIP-1559 signature of the intent's exact fields. The only signing call in this file. */
export function signDeployment(privateKeyHex, intent, deps = {}) {
  return (deps.signEvm ?? (async (key, tx) => privateKeyToAccount(key).signTransaction(tx)))(privateKeyHex, { ...intent.tx, accessList: [] });
}

// ---- CHECK ----

/** Every way a signed transaction differs from the intent; empty when it is exactly the planned deployment, signed by the deployer. */
export async function deploymentFormatFailures(serialized, intent) {
  if (typeof serialized !== 'string' || !serialized.startsWith('0x02')) return ['Not an EIP-1559 transaction'];
  let tx;
  try { tx = parseTransaction(serialized); } catch { return ['Unreadable transaction']; }
  const failures = [];
  const want = intent.tx;
  if (tx.type !== 'eip1559' || tx.chainId !== want.chainId) failures.push('Wrong chain or type');
  if (tx.to !== undefined && tx.to !== null) failures.push('Not a contract creation');
  if (tx.nonce !== want.nonce) failures.push('Wrong nonce');
  if (tx.gas !== want.gas || tx.maxFeePerGas !== want.maxFeePerGas || tx.maxPriorityFeePerGas !== want.maxPriorityFeePerGas) failures.push('Wrong gas or fees');
  if ((tx.value ?? 0n) !== want.value) failures.push('Wrong value');
  if ((tx.data ?? '0x').toLowerCase() !== want.data.toLowerCase()) failures.push('Wrong initcode');
  if ((tx.accessList ?? []).length !== 0 || tx.authorizationList !== undefined) failures.push('Unexpected access or authorization list');
  let signer;
  try { signer = await recoverTransactionAddress({ serializedTransaction: serialized }); } catch { signer = undefined; }
  if (!sameAddress(signer, intent.from)) failures.push('Signature is not the deployer');
  return failures;
}

/** eth_call of the exact creation: must succeed and return the expected runtime code. Read-only. */
export async function dryRunCreation(network, intent) {
  const t = intent.tx;
  const answer = await rpc(network, 'eth_call', [{
    from: intent.from, data: t.data, value: '0x' + t.value.toString(16), gas: '0x' + t.gas.toString(16),
    maxFeePerGas: '0x' + t.maxFeePerGas.toString(16), maxPriorityFeePerGas: '0x' + t.maxPriorityFeePerGas.toString(16),
  }, 'latest']);
  if (answer.error || typeof answer.result !== 'string') return { ok: false, reason: 'reverted' };
  return answer.result.toLowerCase() === intent.expectedRuntime.toLowerCase() ? { ok: true } : { ok: false, reason: 'runtime code differs' };
}

// ---- BROADCAST ----
const BROADCAST_TIMEOUT_MS = 60000;

/** eth_sendRawTransaction once, never retried. ACCEPTED (with the node's hash) / REFUSED (window category only) / UNKNOWN. */
export async function broadcastOnce(serialized, network) {
  network.allowBroadcast.value = true;
  let body;
  try {
    const response = await network.fetch(network.evmRpc, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_sendRawTransaction', params: [serialized] }),
      signal: AbortSignal.timeout(BROADCAST_TIMEOUT_MS),
    });
    body = await response.json();
  } catch {
    body = undefined;
  } finally {
    network.allowBroadcast.value = false;
  }
  if (body?.error && typeof body.error === 'object') return { outcome: 'REFUSED', code: Number(body.error.code ?? -1), window: sdk.classifyEvmWindowRejection(body.error) ?? null };
  if (typeof body?.result === 'string' && /^0x[0-9a-fA-F]{64}$/.test(body.result)) return { outcome: 'ACCEPTED', txHash: body.result.toLowerCase() };
  return { outcome: 'UNKNOWN' };
}

// ---- VERIFY ----

export const VERIFY_FAILURES = Object.freeze([
  'Wrong Diana network',
  'Transaction not found',
  'Transaction is not the planned deployment',
  'Deployment failed or not included',
  'Contract address is not the predicted address',
  'On-chain code differs from the compiled contract',
  'EVM nonce did not advance by one',
  'Window use not recorded',
]);

/** VERIFY (read-only): the receipt, the address, the on-chain runtime code, the nonce and the window. */
export async function verifyDeployment({ network, txHash, intent }) {
  const chain=await rpc(network,'eth_chainId',[]);
  if(chain.result!=='0x2648')return {mode:'verify',txHash,verified:false,failures:['Wrong Diana network']};
  const failures = [];
  const fail = f => { if (!failures.includes(f)) failures.push(f); };
  const tx = (await rpc(network, 'eth_getTransactionByHash', [txHash])).result;
  if (!tx) return { mode: 'verify', txHash, verified: false, failures: ['Transaction not found'] };
  const t = intent.tx;
  if (String(tx.hash).toLowerCase()!==txHash.toLowerCase() || tx.type !== '0x2' || BigInt(tx.chainId ?? -1) !== BigInt(t.chainId) || !sameAddress(tx.from, intent.from) || tx.to !== null
    || BigInt(tx.maxFeePerGas??-1)!==t.maxFeePerGas || BigInt(tx.maxPriorityFeePerGas??-1)!==t.maxPriorityFeePerGas
    || !Array.isArray(tx.accessList) || tx.accessList.length!==0 || tx.authorizationList!==undefined
    || BigInt(tx.nonce) !== BigInt(t.nonce) || BigInt(tx.gas) !== t.gas || BigInt(tx.value) !== t.value || String(tx.input).toLowerCase() !== t.data.toLowerCase()) {
    fail('Transaction is not the planned deployment');
  }
  const receipt = (await rpc(network, 'eth_getTransactionReceipt', [txHash])).result;
  if (!receipt || receipt.status !== '0x1' || String(receipt.transactionHash).toLowerCase()!==txHash.toLowerCase()
    || !sameAddress(receipt.from,intent.from) || receipt.to!==null || !/^0x[0-9a-f]{64}$/i.test(receipt.blockHash??'')
    || receipt.blockHash!==tx.blockHash || receipt.blockNumber!==tx.blockNumber || !/^0x[1-9a-f][0-9a-f]*$/i.test(receipt.blockNumber??'')
    || !/^0x[1-9a-f][0-9a-f]*$/i.test(receipt.gasUsed??'') || BigInt(receipt.gasUsed)>t.gas) fail('Deployment failed or not included');
  if (!receipt || !sameAddress(receipt.contractAddress, intent.predictedAddress)) fail('Contract address is not the predicted address');
  const code = (await rpc(network, 'eth_getCode', [intent.predictedAddress, {blockHash:receipt?.blockHash,requireCanonical:true}])).result;
  if (typeof code !== 'string' || code.toLowerCase() !== intent.expectedRuntime.toLowerCase()) fail('On-chain code differs from the compiled contract');
  const nonce = (await rpc(network, 'eth_getTransactionCount', [intent.from, 'latest'])).result;
  if (typeof nonce !== 'string' || BigInt(nonce) !== BigInt(t.nonce) + 1n) fail('EVM nonce did not advance by one');
  const window = parseEvmWindow((await restJson(network, '/qorechain/pqc/v1/evm_window/' + intent.plan.native)).body);
  if (!window.found || window.usedTxs !== 1n || window.usedValue <= 0n) fail('Window use not recorded');
  return {
    mode: 'verify', txHash, verified: failures.length === 0, failures, contractAddress: receipt?.contractAddress ?? null,
    blockNumber: receipt?.blockNumber ? BigInt(receipt.blockNumber).toString() : null, gasUsed: receipt?.gasUsed ? BigInt(receipt.gasUsed).toString() : null,
    codeKeccak: typeof code === 'string' && code !== '0x' ? keccak256(code) : null,
    runtimeSha256: typeof code === 'string' && /^0x(?:[0-9a-f]{2})+$/i.test(code) ? createHash('sha256').update(Buffer.from(code.slice(2),'hex')).digest('hex') : null,
  };
}

// ---- The full flow (tests only while LIVE_CONSTRUCTOR_PARAMS is null) ----

export const signConfirmation = intent => 'SIGN DEPLOYMENT NONCE ' + intent.tx.nonce + ' GAS ' + intent.tx.gas + ' TO ' + intent.predictedAddress + ' FOR ' + intent.plan.accountNumber;
export const broadcastConfirmation = hash => 'BROADCAST DEPLOYMENT ' + hash.slice(2, 10).toUpperCase() + ' TO DIANA ' + DEPLOY_PLAN.evmChainId;

export const DEPLOY_FAILURES = Object.freeze([
  'Interactive Windows terminal required', 'Unknown option', 'Preparation report required', 'Not confirmed', 'Constructor parameters not chosen', 'Artifact does not match the contract source',
  'Deployment intent does not match the plan', 'Chain state changed since PREPARE', 'Record key is not the on-chain key',
  'Signed transaction differs from the plan', 'Creation dry run failed', 'Signed bytes changed before broadcast',
  'Broadcast refused by the node', 'Broadcast result unknown', 'Broadcast hash mismatch', 'Network request blocked', 'Chain state unreadable',
]);

/**
 * PREPARE -> BUILD -> confirm -> record -> re-PREPARE -> SIGN -> CHECK -> dry run -> confirm -> re-PREPARE -> BROADCAST,
 * with every outside effect injected. The CLI never reaches this while LIVE_CONSTRUCTOR_PARAMS is null.
 */
export async function runDeployBroadcast({ network, readRecord, confirm, write, params, artifact, plan = DEPLOY_PLAN, expected = INVOICE_OWNER, now = () => Math.floor(Date.now() / 1000), deps = {} }) {
  if (!params || (params.testOnly === true && deps.acceptTestParams !== true)) throw new Error('Constructor parameters not chosen');
  const prepared = await prepareDeployment({ network, plan, artifact, params, now, write });
  if (!prepared.readyToSign) throw new DeployCheckError(prepared.blockers);
  const intent = deploymentIntent(prepared, params, { plan, artifact, acceptTestParams: deps.acceptTestParams });
  const same = async () => {
    const fresh = await prepareDeployment({ network, plan, artifact, params, now });
    if (deployFingerprint(fresh) !== intent.fingerprint) throw new Error('Chain state changed since PREPARE');
  };
  const signPhrase = signConfirmation(intent);
  if ((await confirm(signPhrase)) !== signPhrase) throw new Error('Not confirmed');
  const record = readParsedRecord(readRecord);
  return withVerifiedAccount(record, { native: expected.native, evm: expected.evm }, async account => {
    const live = await fetchLiveState(plan.native, network);
    if (!classicalKeyHex(live, plan) || classicalKeyHex(live, plan).toLowerCase() !== account.publicKey.toLowerCase()) throw new Error('Record key is not the on-chain key');
    await same();
    const serialized = await signDeployment(account.privateKey, intent, deps);
    const format = await deploymentFormatFailures(serialized, intent);
    if (format.length) throw new DeployCheckError(format);
    const hash = keccak256(serialized);
    const dry = await dryRunCreation(network, intent);
    const report = {
      mode: 'broadcast', signed: true, broadcast: false, deployed: false, txHash: hash, nonce: intent.tx.nonce, gas: intent.tx.gas.toString(),
      predictedContractAddress: intent.predictedAddress, dryRun: dry.ok ? 'runtime code matches' : dry.reason,
    };
    if (!dry.ok) { write(report); throw new Error('Creation dry run failed'); }
    write({ ...report, warning: 'The next step sends this deployment to Diana (EVM ' + plan.evmChainId + ') and uses the window. It cannot be undone.' });
    const broadcastPhrase = broadcastConfirmation(hash);
    if ((await confirm(broadcastPhrase)) !== broadcastPhrase) throw new Error('Not confirmed');
    await same();
    if (keccak256(serialized) !== hash) throw new Error('Signed bytes changed before broadcast');
    const result = await broadcastOnce(serialized, network);
    const verify = { command: 'node diana-deploy.mjs --verify ' + hash + ' --prepare-report <saved-prepare.json>', conditions: VERIFY_FAILURES.map(f => 'not: ' + f) };
    if (result.outcome === 'UNKNOWN') { write({ ...report, broadcast: 'UNKNOWN', verify, next: 'Do not re-run. Check the hash read-only.' }); throw new Error('Broadcast result unknown'); }
    if (result.outcome === 'REFUSED') { write({ ...report, broadcast: 'REFUSED', code: result.code, window: result.window }); throw new Error('Broadcast refused by the node'); }
    if (result.txHash !== hash.toLowerCase()) { write({ ...report, broadcast: 'ACCEPTED' }); throw new Error('Broadcast hash mismatch'); }
    const out = { ...report, broadcast: 'ACCEPTED', verify };
    write(out);
    return out;
  }, deps);
}

/** Fixed messages only: never an SDK error, a node message, or record contents. */
export function failureMessage(error) {
  if (error instanceof DeployCheckError) return 'Deployment check failed: ' + error.failures.filter(f => typeof f === 'string' && /^[A-Za-z0-9 _-]+$/.test(f)).join('; ');
  return DEPLOY_FAILURES.includes(error?.message) ? error.message : 'Deployment stopped';
}

export function parseArgs(args) {
  if (args.length === 0) return { mode: 'prepare' };
  if(args.length===3&&args[0]==='--broadcast'&&args[1]==='--prepare-report'&&args[2])return {mode:'broadcast',prepareReport:args[2]};
  if (args.length === 1 && args[0] === '--broadcast') return { mode: 'broadcast' };
  if (args.length === 4 && args[0] === '--verify' && /^0x[0-9a-fA-F]{64}$/.test(args[1]) && args[2] === '--prepare-report' && args[3]) return {mode:'verify',txHash:args[1].toLowerCase(),prepareReport:args[3]};
  if (args.length === 2 && args[0] === '--verify' && /^0x[0-9a-fA-F]{64}$/.test(args[1])) return { mode: 'verify', txHash: args[1].toLowerCase() };
  throw new Error('Unknown option');
}

const writeReport = report => process.stdout.write(JSON.stringify(report, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n');

/** Persist only public PREPARE data, before any confirmation/record access; never overwrite. */
export function deploymentReporter({prepareReport,write=writeReport,save=writeFileSync}) {
  return report=>{
    if(report.mode==='prepare')save(prepareReport,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    if(report.verify)report={...report,verify:{...report.verify,argv:['node','diana-deploy.mjs','--verify',report.txHash,'--prepare-report',prepareReport]}};
    write(report);
  };
}

/** Gate existing phase functions; injected effects let public-data tests prove no keys are touched. */
export async function dispatchDeployment({parsed,params=LIVE_CONSTRUCTOR_PARAMS,interactive=false,effects}) {
  if(parsed.mode==='prepare') return effects.prepare();
  if(!params || params.testOnly===true || params.reviewed!==true) throw new Error('Constructor parameters not chosen');
  if(parsed.mode==='broadcast') {
    if(!interactive) throw new Error('Interactive Windows terminal required');
    if(!parsed.prepareReport)throw new Error('Preparation report required');
    return effects.broadcast();
  }
  if(parsed.mode==='verify') {
    if(!parsed.prepareReport) throw new Error('Preparation report required');
    return effects.verify();
  }
  throw new Error('Unknown option');
}

async function main() {
  const parsed=parseArgs(process.argv.slice(2));
  const interactive=process.platform==='win32' && !!process.stdin.isTTY && !!process.stdout.isTTY && process.execArgv.length===0 && !process.env.NODE_OPTIONS;
  await dispatchDeployment({parsed,interactive,effects:{
    prepare:async()=>{
      const result=await prepareDeployment({network:dianaDeployNetwork(),artifact:loadDeployArtifact(),params:LIVE_CONSTRUCTOR_PARAMS,write:writeReport});
      if(!result.readyToSign)process.exitCode=2;
      return result;
    },
    broadcast:async()=>{
      const prompt=createInterface({input:process.stdin,output:process.stdout,terminal:true});
      try {
        return await runDeployBroadcast({network:dianaDeployNetwork(),artifact:loadDeployArtifact(),params:LIVE_CONSTRUCTOR_PARAMS,
          readRecord:()=>readRecordBytes(RECORD_PATH),
          confirm:async phrase=>(await prompt.question('\n*** Type '+phrase+' to continue, anything else stops: ')).trim(),
          write:deploymentReporter({prepareReport:parsed.prepareReport})});
      }finally{prompt.close();}
    },
    verify:async()=>{
      const prepared=JSON.parse(readFileSync(parsed.prepareReport,'utf8'));
      const artifact=loadDeployArtifact();
      const intent=deploymentIntent(prepared,LIVE_CONSTRUCTOR_PARAMS,{artifact});
      const result=await verifyDeployment({network:dianaDeployNetwork(),txHash:parsed.txHash,intent});
      writeReport(result);if(!result.verified)process.exitCode=2;return result;
    },
  }});
}

// Runs only when started directly (`node .\diana-deploy.mjs`), not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase()) {
  main().catch(error => {
    process.stderr.write('Diana deployment tool stopped: ' + failureMessage(error) + (LIVE_CONSTRUCTOR_PARAMS===null ? '. Nothing was signed or sent.\n' : '. Check the public phase report; never retry an uncertain broadcast.\n'));
    process.exitCode = 1;
  });
}
