import {withDianaReadRetries} from './diana-read-retry.mjs';
// Diana Invoice Owner: hybrid-signed (classical ECDSA + ML-DSA-87, v2) `MsgOpenEVMWindow` for the
// one-transaction deployment window PREPAREd in 7C-22 (diana-window-prepare.mjs).
//
// This is a separate path from the 1 uqor self-send (diana-hybrid-*.mjs). It reuses their read-only
// helpers (live state, unsigned parts, record handling, simulation) but none of their MsgSend checks
// are changed: the window has its own message check, its own format verifier, its own confirmations
// and its own network guard.
//
// Four phases, kept apart:
//   BUILD      `windowIntent`        PREPARE output -> a frozen intent, checked against the fixed plan
//                                    and the signing limits. No key.
//   SIGN       `signWindow`          the intent's exact message, signed once with `signHybridEth`.
//   BROADCAST  `broadcastOnce`       the same bytes, once, never retried.
//   VERIFY     `verifyOpenedWindow`  read-only, afterwards: the transaction, account and window on chain.
//
// `node .\diana-window-open.mjs` (default): PREPARE only. Read-only; no vault, no record, no key, no
//   signature; the network guard has no broadcast route at all.
// `node .\diana-window-open.mjs --sign-and-verify-local`: sign and verify locally. The network is
//   sealed before signing; the signed bytes never leave the process.
// `node .\diana-window-open.mjs --broadcast`: two typed confirmations, one bound to the window
//   parameters (before the record is read), one bound to the transaction hash (before the single
//   broadcast). The chain is PREPAREd again before signing and before broadcasting; any change from
//   the first PREPARE stops the tool.
// `node .\diana-window-open.mjs --verify <TXHASH>`: read-only post-broadcast verification.
//
// Signing and broadcasting need the user's own interactive Windows terminal. Only public values are
// printed. The mnemonic, password, private key, PQC secret key, record contents and signed
// transaction bytes are never printed, logged or written.
import { createHash } from 'node:crypto';
import { win32 as path } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import * as sdk from '@qorechain/sdk';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { AuthInfo, SignDoc, TxBody, TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import { SignMode } from 'cosmjs-types/cosmos/tx/signing/v1beta1/signing';
import { PubKey } from 'cosmjs-types/cosmos/crypto/secp256k1/keys';
import { withVerifiedAccount } from './diana-canonical-pqc.mjs';
import { CheckError, feeFor, unsignedHybridParts } from './diana-hybrid-prepare.mjs';
import {
  FormatError, failureMessage as signFailureMessage, latestHeight, presignChecks, readParsedRecord, sealableNetwork, simulateSigned, zeroSigned,
} from './diana-hybrid-sign.mjs';
import { INVOICE_OWNER, RECORD_PATH, readRecordBytes } from './diana-verify-recovery.mjs';
import {
  WINDOW_PLAN, WindowCheckError, dianaNetwork as prepareNetwork, failureMessage as prepareFailureMessage, loadArtifact, prepareDeploymentWindow, windowParameterFailures,
} from './diana-window-prepare.mjs';

const { PQCHybridSignature } = sdk.qorechainTypes.pqcHybrid;
const { MsgOpenEVMWindow } = sdk.qorechainTypes.pqc;
export const OPEN_WINDOW_TYPE_URL = '/qorechain.pqc.v1.MsgOpenEVMWindow';
const WEI_PER_UQOR = 10n ** 12n;

/**
 * Hard ceilings for anything this tool signs, independent of what the live chain suggests. The
 * PREPAREd window value is 256,500 uqor and the fee ceiling 52,500 uqor (7C-22); a live estimate that
 * pushes either above these limits is refused, not followed.
 */
export const SIGNING_LIMITS = Object.freeze({
  maxWindowValueUqor: 300000n,
  maxFeeUqor: 52500n,
  maxGasLimit: 350000,
  windowBlocks: 400,
  maxTxs: 1,
});

/** The signed window transaction can be included only up to latest height + this (about 7 minutes). */
export const BROADCAST_TIMEOUT_BLOCKS = 300;
/** Broadcast only while at least this many blocks are left before the timeout height. */
export const MIN_BLOCKS_LEFT = 20;
const BROADCAST_TIMEOUT_MS = 60000;

/** Bound to the window parameters: the user types the exact window being authorised. */
export const signConfirmation = intent => 'SIGN EVM WINDOW ' + intent.plan.windowBlocks + ' BLOCKS ' + intent.plan.maxTxs + ' TX '
  + intent.plan.maxValueUqor + ' UQOR FOR ' + intent.plan.accountNumber;
/** Bound to the signed bytes: the user types the start of the hash that will be sent. */
export const broadcastConfirmation = txHash => 'BROADCAST EVM WINDOW ' + txHash.slice(0, 8) + ' TO ' + WINDOW_PLAN.chainId.toUpperCase();
export const LOCAL_CONFIRMATION = 'SIGN AND VERIFY EVM WINDOW LOCALLY FOR ' + WINDOW_PLAN.accountNumber;

export const OPEN_FAILURES = Object.freeze([
  'Interactive Windows terminal required',
  'Unknown option',
  'Not confirmed',
  'Window intent does not match the plan',
  'Window value above the signing limit',
  'Fee above the signing limit',
  'Chain state changed since PREPARE',
  'Signed transaction differs from the plan',
  'Simulation did not succeed',
  'Simulated gas exceeds the gas limit',
  'Timeout height too close',
  'Signed bytes changed before broadcast',
  'Broadcast refused by the node',
  'Broadcast result unknown',
  'Broadcast hash mismatch',
  'Transaction not found',
]);

export const VERIFY_FAILURES = Object.freeze([
  'Transaction failed or not included',
  'Transaction is not the planned window',
  'Transaction fee or gas is not the planned one',
  'Account sequence did not advance by one',
  'EVM nonce is not the new sequence',
  'Registered PQC key changed',
  'Window not found',
  'Window not live',
  'Window not opened by this transaction',
  'Window length differs from the plan',
  'Window bounds differ from the plan',
  'Window already used',
  'Window scope differs from the plan',
  'Balance drop is not the window fee',
]);

const sha256Hex = bytes => createHash('sha256').update(bytes).digest('hex');
const sameBytes = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
const EVM_READ_METHODS = new Set(['eth_chainId', 'eth_getTransactionCount', 'eth_getBalance', 'eth_gasPrice', 'eth_estimateGas']);

/**
 * HTTPS to the two Diana hosts only: GET on REST, the simulation route, the read-only EVM methods,
 * and the Cosmos broadcast route only while `allowBroadcast()` is true and only once per guard.
 * Every EVM method that sends or executes anything stays refused.
 */
export function windowGuardedFetch(endpoints, { allowBroadcast = () => false, fetchImpl = globalThis.fetch } = {}) {
  const rest = new URL(endpoints.rest);
  const evm = new URL(endpoints.evmRpc);
  let broadcastUsed = false;
  return async (url, init = {}) => {
    const target = new URL(String(url));
    const method = (init.method ?? 'GET').toUpperCase();
    let allowed = false;
    if (target.protocol === 'https:' && target.host === rest.host) {
      const isBroadcast = method === 'POST' && target.pathname === '/cosmos/tx/v1beta1/txs';
      allowed = method === 'GET'
        || (method === 'POST' && target.pathname === '/cosmos/tx/v1beta1/simulate')
        || (isBroadcast && allowBroadcast() === true && !broadcastUsed);
      if (allowed && isBroadcast) broadcastUsed = true;
    } else if (target.protocol === 'https:' && target.host === evm.host && method === 'POST') {
      try { allowed = EVM_READ_METHODS.has(JSON.parse(init.body).method); } catch { allowed = false; }
    }
    if (!allowed) throw new Error('Network request blocked');
    return fetchImpl(target.href, { ...init, redirect: 'error', credentials: 'omit' });
  };
}

export function dianaWindowNetwork(fetchImpl = globalThis.fetch) {
  const { rest, evmRpc } = sdk.NETWORKS.testnet.endpoints;
  const allowBroadcast = { value: false };
  return { rest, evmRpc, allowBroadcast, fetch: windowGuardedFetch({ rest, evmRpc }, { allowBroadcast: () => allowBroadcast.value, fetchImpl:withDianaReadRetries(fetchImpl) }) };
}

/**
 * The chain facts a PREPARE report depends on. Two PREPAREs with the same fingerprint describe the
 * same account, keys, balance, nonce, window state, fee market and the same unsigned transaction.
 * Time-derived values (block time, minutes) are left out.
 */
export function stateFingerprint(report) {
  const w = report.window ?? {};
  const c = report.cosmosTx ?? {};
  const d = report.deployment ?? {};
  return JSON.stringify([
    report.chainId, report.evmChainId, report.account, report.evmAccount, report.accountNumber, report.sequence, report.evmNonce,
    report.uqorBalance, report.fractionalBalanceWei, report.unitsConsistent, report.pqcAlgorithmId, report.pqcPublicKeySha256, report.signBytesVersion,
    report.existingWindow?.found, report.existingWindow?.live,
    w.typeUrl, w.sender, w.blocks, w.maxTxs, w.maxValueUqor, w.nativeOnly, w.allowedTargets,
    c.b0Sha256, c.authInfoSha256, c.pqcSignBytesSha256, c.gasLimit, c.gasPrice, c.feeCeiling,
    d.sourceKeccak, d.gasLimit, d.maxFeePerGasWei, d.liveGasPriceWei, d.liveBaseFeeWei, d.maxCostWei, d.maxCostUqor, d.expectedNonce, d.predictedContractAddress,
  ]);
}

/** The exact window message for a plan, rebuilt each time by the SDK (bounds-checked). */
export function windowMessage(plan) {
  return sdk.openEvmWindowMsg({ sender: plan.native, blocks: plan.windowBlocks, maxTxs: plan.maxTxs, maxValue: plan.maxValueUqor, nativeOnly: plan.nativeOnly, allowedTargets: [...plan.allowedTargets] });
}

/** Every field of the expected `MsgOpenEVMWindow` value, as the codec writes it. */
export function expectedWindowValue(plan) {
  return {
    sender: plan.native, blocks: String(plan.windowBlocks), maxTxs: String(plan.maxTxs), maxValue: String(plan.maxValueUqor),
    nativeOnly: false, allowedTargets: [...plan.allowedTargets], validators: [], stakingValidators: [], ibcReceivers: [],
  };
}

/**
 * BUILD: turns a PREPARE report into the intent that may be signed. Refuses anything that is not
 * the fixed plan (type, sender, 400 blocks, one transaction, untargeted, not native-only, no extra
 * scope), or that exceeds the signing limits, or whose value cannot cover the deployment.
 */
export function windowIntent(prepared, plan = WINDOW_PLAN, limits = SIGNING_LIMITS) {
  const w = prepared?.window ?? {};
  const fee = BigInt(feeFor(plan.gasLimit, plan.gasPrice));
  let maxValue;
  try { maxValue = BigInt(w.maxValueUqor); } catch { maxValue = -1n; }
  const matches = prepared?.mode === 'prepare' && prepared.signed === false && prepared.broadcast === false
    && w.typeUrl === OPEN_WINDOW_TYPE_URL && w.sender === plan.native
    && plan.windowBlocks === limits.windowBlocks && w.blocks === String(limits.windowBlocks)
    && plan.maxTxs === limits.maxTxs && w.maxTxs === String(limits.maxTxs)
    && plan.nativeOnly === false && w.nativeOnly === false
    && scopeMatches(w.allowedTargets,plan.allowedTargets)
    && windowParameterFailures({...plan,maxValueUqor:1n},{secondsPerBlock:1}).length===0
    && prepared.chainId === plan.chainId && prepared.evmChainId === plan.evmChainId
    && prepared.account === plan.native && prepared.evmAccount === plan.evm
    && prepared.accountNumber === plan.accountNumber && prepared.sequence === plan.sequence && prepared.evmNonce === plan.sequence
    && prepared.pqcPublicKeySha256 === plan.pqcPublicKeySha256 && prepared.signBytesVersion === plan.signBytesVersion
    && prepared.unitsConsistent === true && prepared.existingWindow?.live === false
    && prepared.cosmosTx?.gasFitsWithHeadroom === true && prepared.cosmosTx.feeCeiling === fee + plan.denom;
  if (!matches) throw new Error('Window intent does not match the plan');
  if (maxValue <= 0n || (plan.paymentRun===true&&maxValue>256500n) || maxValue > limits.maxWindowValueUqor || maxValue * WEI_PER_UQOR < BigInt(prepared.deployment?.maxCostWei ?? -1)) {
    throw new Error('Window value above the signing limit');
  }
  if (plan.gasLimit > limits.maxGasLimit || fee > limits.maxFeeUqor) throw new Error('Fee above the signing limit');
  const intentPlan = Object.freeze({ ...plan, maxValueUqor: maxValue });
  const message = windowMessage(intentPlan);
  const value = expectedWindowValue(intentPlan);
  if (message.typeUrl !== OPEN_WINDOW_TYPE_URL || JSON.stringify(message.value) !== JSON.stringify(value)) throw new Error('Window intent does not match the plan');
  return Object.freeze({ plan: intentPlan, fingerprint: stateFingerprint(prepared), maxValueUqor: maxValue });
}

/** Message-level check of a body's messages: exactly one, the window type, every field as planned, no unknown bytes. */
export function windowMessageFailures(messages, plan, registry = sdk.qorechainRegistry()) {
  if (!Array.isArray(messages) || messages.length !== 1 || messages[0]?.typeUrl !== OPEN_WINDOW_TYPE_URL) return ['Wrong message type'];
  let decoded;
  try { decoded = MsgOpenEVMWindow.decode(messages[0].value); } catch { return ['Wrong message type']; }
  const failures = [];
  const expected = expectedWindowValue(plan);
  if (decoded.sender !== expected.sender) failures.push('Wrong window sender');
  if (decoded.blocks !== expected.blocks || decoded.maxTxs !== expected.maxTxs || decoded.maxValue !== expected.maxValue) failures.push('Wrong window bounds');
  if (decoded.nativeOnly !== false || !scopeMatches(decoded.allowedTargets,plan.allowedTargets) || decoded.validators.length || decoded.stakingValidators.length || decoded.ibcReceivers.length) {
    failures.push('Wrong window scope');
  }
  if (!failures.length && !sameBytes(messages[0].value, registry.encodeAsAny(windowMessage(plan)).value)) failures.push('Wrong window encoding');
  return failures;
}

/**
 * Checks a hybrid-signed window transaction against the plan, with public keys only. Same rules as
 * the self-send verifier (one extension in extension_options, ML-DSA-87 over v2 sign bytes of B0 and
 * A, no attached PQC key, planned signer and fee, classical signature over the final SignDoc), with
 * the window message check in place of the MsgSend one.
 */
export function windowFormatFailures(txRawBytes, { classicalPublicKeyHex, pqcPublicKey, plan, registry = sdk.qorechainRegistry() }) {
  let raw, body, auth;
  try {
    raw = TxRaw.decode(txRawBytes);
    body = TxBody.decode(raw.bodyBytes);
    auth = AuthInfo.decode(raw.authInfoBytes);
  } catch {
    return ['Unreadable transaction'];
  }
  const failures = [...windowMessageFailures(body.messages, plan, registry)];
  const expected = unsignedHybridParts({ publicKeyHex: classicalPublicKeyHex, plan, registry, message: windowMessage(plan) });
  const b0 = TxBody.encode(TxBody.fromPartial({ messages: body.messages, memo: body.memo, timeoutHeight: body.timeoutHeight })).finish();
  if (!sameBytes(b0, expected.b0)) failures.push('Wrong message');
  if (body.nonCriticalExtensionOptions.length) failures.push('Hybrid extension not in extension_options');
  const exts = body.extensionOptions.filter(e => e.typeUrl === sdk.HYBRID_SIG_TYPE_URL);
  if (exts.length !== 1 || body.extensionOptions.length !== 1) {
    failures.push('Missing or extra hybrid extension');
  } else {
    let ext;
    try { ext = PQCHybridSignature.decode(exts[0].value); } catch { ext = undefined; }
    if (!ext) failures.push('Missing or extra hybrid extension');
    else {
      if (ext.algorithmId !== sdk.AlgorithmDilithium5) failures.push('Wrong PQC algorithm');
      if (ext.pqcSignature.length !== sdk.ML_DSA_87_SIGNATURE_LENGTH) failures.push('Wrong PQC signature length');
      if (ext.pqcPublicKey.length !== 0) failures.push('PQC public key must not be attached');
      let ok = false;
      try { ok = sdk.pqcVerify(pqcPublicKey, sdk.hybridSignBytes(plan.signBytesVersion, plan.chainId, b0, raw.authInfoBytes), ext.pqcSignature); } catch { ok = false; }
      if (!ok) failures.push('PQC signature does not verify');
    }
  }
  const signer = auth.signerInfos;
  const expectedKey = PubKey.encode(PubKey.fromPartial({ key: Buffer.from(classicalPublicKeyHex.replace(/^0x/, ''), 'hex') })).finish();
  const signerOk = signer.length === 1 && signer[0].modeInfo?.single?.mode === SignMode.SIGN_MODE_DIRECT && signer[0].sequence === BigInt(plan.sequence)
    && signer[0].publicKey?.typeUrl === sdk.ETHSECP256K1_PUBKEY_TYPE && sameBytes(signer[0].publicKey.value, expectedKey);
  const fee = auth.fee;
  const feeOk = fee?.gasLimit === BigInt(plan.gasLimit) && fee.amount?.length === 1 && fee.amount[0].denom === plan.denom
    && fee.amount[0].amount === feeFor(plan.gasLimit, plan.gasPrice) && fee.granter === '' && fee.payer === '';
  if (!signerOk) failures.push('Wrong signer info');
  if (!feeOk) failures.push('Wrong fee');
  if (signerOk && feeOk && !sameBytes(raw.authInfoBytes, expected.authInfoBytes)) failures.push('Wrong signer info');
  const signDoc = SignDoc.encode(SignDoc.fromPartial({ bodyBytes: raw.bodyBytes, authInfoBytes: raw.authInfoBytes, chainId: plan.chainId, accountNumber: BigInt(plan.accountNumber) })).finish();
  let classicalOk = false;
  try {
    classicalOk = raw.signatures.length === 1 && raw.signatures[0].length === 64
      && secp256k1.verify(raw.signatures[0], sdk.keccak256(signDoc), Buffer.from(classicalPublicKeyHex.replace(/^0x/, ''), 'hex'), { prehash: false });
  } catch { classicalOk = false; }
  if (!classicalOk) failures.push('Classical signature does not verify');
  return failures;
}

/** SIGN: the intent's message, signed once. The only signing call in this file. */
export function signWindow(account, intent, timeoutHeight, deps = {}) {
  const { plan } = intent;
  const registry = sdk.qorechainRegistry();
  return (deps.signHybrid ?? sdk.signHybridEth)({
    account: { privateKey: account.privateKey, publicKey: account.publicKey, pqc: account.pqc },
    chainId: plan.chainId, accountNumber: BigInt(plan.accountNumber), sequence: BigInt(plan.sequence),
    messages: [windowMessage(plan)],
    fee: { amount: [{ denom: plan.denom, amount: feeFor(plan.gasLimit, plan.gasPrice) }], gas: String(plan.gasLimit) },
    memo: plan.memo, timeoutHeight, encodeMessage: m => registry.encodeAsAny(m), signBytesVersion: plan.signBytesVersion,
  });
}

/** PREPARE again and require the same chain state as the first PREPARE. */
async function samePrepare(ctx) {
  const fresh = await prepareDeploymentWindow({ network: ctx.network, plan: ctx.plan, artifact: ctx.artifact, now: ctx.now, write: () => {} });
  if (stateFingerprint(fresh) !== ctx.intent.fingerprint) throw new Error('Chain state changed since PREPARE');
  return fresh;
}

/** Pre-sign: record keys tied to the on-chain keys, the balance covering fee + window, and an unchanged chain. */
async function presign(account, summary, ctx) {
  const checked = await presignChecks(account, summary, ctx.network, { ...ctx.plan, amount: ctx.intent.maxValueUqor.toString() });
  await samePrepare(ctx);
  return checked;
}

/** Signs, then refuses anything that is not exactly the planned transaction. Returns the signed object (caller zeroes it). */
function signAndCheck(account, ctx, live, onChainKey, timeoutHeight) {
  const txPlan = { ...ctx.intent.plan, timeoutHeight: timeoutHeight.toString() };
  const parts = unsignedHybridParts({ publicKeyHex: onChainKey, plan: txPlan, message: windowMessage(txPlan) });
  const signed = signWindow(account, ctx.intent, timeoutHeight, ctx.deps);
  if (!sameBytes(signed.authInfoBytes, parts.authInfoBytes)) return { signed, parts, error: new Error('Signed transaction differs from the plan') };
  const format = windowFormatFailures(signed.txRawBytes, { classicalPublicKeyHex: onChainKey, pqcPublicKey: live.pqc.publicKey, plan: txPlan });
  if (format.length) return { signed, parts, error: new FormatError(format) };
  return { signed, parts };
}

/** One broadcast attempt, never retried. Returns ACCEPTED / REFUSED (public code only) / UNKNOWN. */
export async function broadcastOnce(txBytes, network) {
  network.allowBroadcast.value = true;
  let answer;
  try {
    const response = await network.fetch(network.rest.replace(/\/+$/, '') + '/cosmos/tx/v1beta1/txs', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tx_bytes: Buffer.from(txBytes).toString('base64'), mode: 'BROADCAST_MODE_SYNC' }),
      signal: AbortSignal.timeout(BROADCAST_TIMEOUT_MS),
    });
    answer = (await response.json())?.tx_response;
  } catch {
    answer = undefined;
  } finally {
    network.allowBroadcast.value = false;
  }
  if (!answer || answer.code === undefined || typeof answer.txhash !== 'string') return { outcome: 'UNKNOWN' };
  if (Number(answer.code) !== 0) return { outcome: 'REFUSED', code: Number(answer.code), codespace: String(answer.codespace ?? ''), txhash: String(answer.txhash).toUpperCase() };
  return { outcome: 'ACCEPTED', txhash: String(answer.txhash).toUpperCase() };
}

/** The read-only conditions that settle a broadcast, printed with the result. */
export function verificationConditions(txHash, timeoutHeight, intent, prepared) {
  const { plan } = intent;
  return {
    command: 'node .\\diana-window-open.mjs --verify ' + txHash,
    lastIncludableHeight: timeoutHeight.toString(),
    conditions: [
      'GET /cosmos/tx/v1beta1/txs/' + txHash + ': code 0; one ' + OPEN_WINDOW_TYPE_URL + ' with sender ' + plan.native + ', blocks ' + plan.windowBlocks + ', max_txs ' + plan.maxTxs + ', max_value ' + intent.maxValueUqor + ', native_only false, no targets or scope; fee ' + feeFor(plan.gasLimit, plan.gasPrice) + plan.denom + ', gas limit ' + plan.gasLimit,
      'Account sequence ' + (BigInt(plan.sequence) + 1n) + ' and EVM nonce ' + (BigInt(plan.sequence) + 1n) + ' (before any deployment)',
      'Registered ML-DSA-87 key unchanged (' + plan.pqcPublicKeySha256.slice(0, 12) + '...)',
      'GET /qorechain/pqc/v1/evm_window/' + plan.native + ': found and live, opened at the transaction height, expiry = opened + ' + plan.windowBlocks + ', max_txs ' + plan.maxTxs + ', max_value ' + intent.maxValueUqor + ', used 0, native_only false, no targets',
      'uqor balance lower than ' + prepared.uqorBalance + ' by more than 0 and at most ' + feeFor(plan.gasLimit, plan.gasPrice),
    ],
  };
}

/**
 * The full BUILD -> SIGN -> BROADCAST flow with every outside effect injected: `network` (with
 * `allowBroadcast`), `readRecord()` (only after the first confirmation), `confirm(phrase)`, `write(report)`.
 */
export async function runWindowBroadcast({ network, readRecord, confirm, write, plan = WINDOW_PLAN, expected = INVOICE_OWNER, artifact = loadArtifact(), now = () => Math.floor(Date.now() / 1000), limits = SIGNING_LIMITS, deps = {} }) {
  const prepared = await prepareDeploymentWindow({ network, plan, artifact, now, write });
  const intent = windowIntent(prepared, plan, limits);
  const ctx = { network, plan, artifact, now, intent, deps };
  const signPhrase = signConfirmation(intent);
  if ((await confirm(signPhrase)) !== signPhrase) throw new Error('Not confirmed');
  let record = readParsedRecord(readRecord);

  return withVerifiedAccount(record, { native: expected.native, evm: expected.evm }, async (account, summary) => {
    record = undefined;
    const { live, onChainKey } = await presign(account, summary, ctx);
    const timeoutHeight = (await latestHeight(network)) + BigInt(BROADCAST_TIMEOUT_BLOCKS);
    const { signed, parts, error } = signAndCheck(account, ctx, live, onChainKey, timeoutHeight);
    try {
      if (error) throw error;
      const txHash = sha256Hex(signed.txRawBytes).toUpperCase();

      // The exact bytes that would be broadcast are the ones simulated.
      const simulation = await simulateSigned(signed.txRawBytes, network);
      const report = {
        mode: 'broadcast', signed: true, broadcast: false, windowOpened: false, deployed: false,
        chainId: plan.chainId, account: plan.native, accountNumber: plan.accountNumber, sequence: plan.sequence, uqorBalance: prepared.uqorBalance,
        message: OPEN_WINDOW_TYPE_URL, window: expectedWindowValue(intent.plan),
        classicalPublicKey: onChainKey, pqcPublicKeySha256: summary.pqcPublicKeySha256, formatCheck: 'pass',
        b0Sha256: sha256Hex(parts.b0), authInfoSha256: sha256Hex(parts.authInfoBytes), pqcSignBytesSha256: sha256Hex(parts.pqcSignBytes),
        gasLimit: plan.gasLimit, gasPrice: plan.gasPrice, feeCeiling: feeFor(plan.gasLimit, plan.gasPrice) + plan.denom,
        preparedEstimate: prepared.cosmosTx.estimatedGas, simulation: simulation.outcome, timeoutHeight: timeoutHeight.toString(), txHash,
        expectedDeploymentNonce: prepared.deployment.expectedNonce, predictedContractAddress: prepared.deployment.predictedContractAddress,
      };
      if (simulation.outcome !== 'ok') {
        write({ ...report, code: simulation.code });
        throw new Error('Simulation did not succeed');
      }
      const exactGas = sdk.exactHybridGas(simulation.gasUsed);
      Object.assign(report, { gasUsed: simulation.gasUsed, exactHybridGas: exactGas });
      if (exactGas > plan.gasLimit) {
        write(report);
        throw new Error('Simulated gas exceeds the gas limit');
      }
      write({ ...report, warning: 'The next step broadcasts this transaction to ' + plan.chainId + '. It opens an EVM window of ' + plan.windowBlocks + ' blocks admitting ' + plan.maxTxs + ' transaction and up to ' + intent.maxValueUqor + ' uqor, and spends up to ' + report.feeCeiling + '. It cannot be undone.' });
      const broadcastPhrase = broadcastConfirmation(txHash);
      if ((await confirm(broadcastPhrase)) !== broadcastPhrase) throw new Error('Not confirmed');

      // Pre-broadcast: the chain must still be exactly as PREPAREd.
      await samePrepare(ctx);
      if ((await latestHeight(network)) + BigInt(MIN_BLOCKS_LEFT) > timeoutHeight) throw new Error('Timeout height too close');
      if (sha256Hex(signed.txRawBytes).toUpperCase() !== txHash) throw new Error('Signed bytes changed before broadcast');

      const result = await broadcastOnce(signed.txRawBytes, network);
      const after = { ...report, broadcast: result.outcome, verify: verificationConditions(txHash, timeoutHeight, intent, prepared) };
      if (result.outcome === 'UNKNOWN') {
        write({ ...after, next: 'Do not re-run. Check the hash read-only; after height ' + timeoutHeight + ' it can no longer be included.' });
        throw new Error('Broadcast result unknown');
      }
      if (result.outcome === 'REFUSED') {
        write({ ...after, code: result.code, codespace: result.codespace });
        throw new Error('Broadcast refused by the node');
      }
      if (result.txhash !== txHash) {
        write(after);
        throw new Error('Broadcast hash mismatch');
      }
      write({ ...after, code: 0, next: 'Accepted into the mempool only. Run the verify command; the window is open only when every condition passes.' });
      return { ...after, code: 0 };
    } finally {
      zeroSigned(signed);
    }
  }, deps);
}

/**
 * SIGN-AND-VERIFY-LOCAL: signs the intent (no timeout height) and verifies it locally. The network is
 * sealed right before signing: from then on no request of any kind can leave.
 */
export async function runWindowSignLocal({ network, readRecord, confirm, write, plan = WINDOW_PLAN, expected = INVOICE_OWNER, artifact = loadArtifact(), now = () => Math.floor(Date.now() / 1000), limits = SIGNING_LIMITS, deps = {} }) {
  const gate = sealableNetwork(network);
  const prepared = await prepareDeploymentWindow({ network: gate.network, plan, artifact, now, write });
  const intent = windowIntent(prepared, plan, limits);
  const ctx = { network: gate.network, plan, artifact, now, intent, deps };
  if ((await confirm(LOCAL_CONFIRMATION)) !== LOCAL_CONFIRMATION) throw new Error('Not confirmed');
  let record = readParsedRecord(readRecord);
  return withVerifiedAccount(record, { native: expected.native, evm: expected.evm }, async (account, summary) => {
    record = undefined;
    const { live, onChainKey } = await presign(account, summary, ctx);
    gate.seal();
    const { signed, parts, error } = signAndCheck(account, ctx, live, onChainKey, 0n);
    try {
      if (error) throw error;
      const report = {
        mode: 'sign-and-verify-local', signed: true, sentToNetwork: false, broadcast: false, windowOpened: false,
        chainId: plan.chainId, account: plan.native, accountNumber: plan.accountNumber, sequence: plan.sequence,
        message: OPEN_WINDOW_TYPE_URL, window: expectedWindowValue(intent.plan), formatCheck: 'pass',
        classicalSignature: 'verified with the on-chain eth_secp256k1 key', pqcSignature: 'verified with the registered ML-DSA-87 key',
        b0Sha256: sha256Hex(parts.b0), authInfoSha256: sha256Hex(parts.authInfoBytes), pqcSignBytesSha256: sha256Hex(parts.pqcSignBytes),
        matchesPrepare: prepared.cosmosTx.b0Sha256 === sha256Hex(parts.b0) && prepared.cosmosTx.authInfoSha256 === sha256Hex(parts.authInfoBytes)
          && prepared.cosmosTx.pqcSignBytesSha256 === sha256Hex(parts.pqcSignBytes),
      };
      write(report);
      return report;
    } finally {
      zeroSigned(signed);
    }
  }, deps);
}

async function getJson(network, route) {
  try {
    const response = await network.fetch(network.rest.replace(/\/+$/, '') + route);
    return { status: response.status, body: await response.json() };
  } catch (error) {
    if (error?.message === 'Network request blocked') throw error;
    throw new Error('Chain state unreadable');
  }
}
const scopeMatches=(actual,expected=[])=>JSON.stringify((actual??[]).map(x=>x.toLowerCase()))===JSON.stringify(expected.map(x=>x.toLowerCase()));
const isEmpty = v => v === undefined || v === null || (Array.isArray(v) && v.length === 0);

/**
 * VERIFY (read-only, after a broadcast): settles whether the planned window was opened, from the
 * chain alone. `before` (optional) is the PREPAREd balance, for the fee check. Returns every check
 * by name and the list of failures; `verified` only when there are none.
 */
export async function verifyOpenedWindow({ network, txHash, plan = WINDOW_PLAN, limits = SIGNING_LIMITS, before }) {
  const tx = await getJson(network, '/cosmos/tx/v1beta1/txs/' + txHash);
  const r = tx.body?.tx_response;
  if (tx.status !== 200 || !r) throw new Error('Transaction not found');
  const failures = [];
  const fail = f => { if (!failures.includes(f)) failures.push(f); };
  const height = BigInt(r.height ?? 0);
  if (Number(r.code) !== 0 || height <= 0n || String(r.txhash).toUpperCase() !== txHash.toUpperCase()) fail('Transaction failed or not included');
  const body = tx.body?.tx?.body ?? r.tx?.body;
  const auth = tx.body?.tx?.auth_info ?? r.tx?.auth_info;
  const msgs = body?.messages ?? [];
  const m = msgs[0] ?? {};
  let maxValue;
  try { maxValue = BigInt(m.max_value); } catch { maxValue = -1n; }
  if (msgs.length !== 1 || m['@type'] !== OPEN_WINDOW_TYPE_URL || m.sender !== plan.native || String(m.blocks) !== String(plan.windowBlocks)
    || String(m.max_txs) !== String(plan.maxTxs) || maxValue <= 0n || maxValue > limits.maxWindowValueUqor
    || (plan.maxValueUqor !== undefined && maxValue !== BigInt(plan.maxValueUqor))
    || m.native_only === true || !scopeMatches(m.allowed_targets,plan.allowedTargets) || !isEmpty(m.validators) || !isEmpty(m.staking_validators) || !isEmpty(m.ibc_receivers)
    || (body?.extension_options ?? []).length !== 1 || body.extension_options[0]['@type'] !== sdk.HYBRID_SIG_TYPE_URL) {
    fail('Transaction is not the planned window');
  }
  const fee = auth?.fee;
  if (String(fee?.gas_limit) !== String(plan.gasLimit) || fee?.amount?.length !== 1 || fee.amount[0].denom !== plan.denom
    || fee.amount[0].amount !== feeFor(plan.gasLimit, plan.gasPrice) || String(auth?.signer_infos?.[0]?.sequence) !== plan.sequence
    || !(Number(r.gas_used) > 0 && Number(r.gas_used) <= plan.gasLimit)) {
    fail('Transaction fee or gas is not the planned one');
  }

  const next = (BigInt(plan.sequence) + 1n).toString();
  const account = await getJson(network, '/cosmos/auth/v1beta1/accounts/' + plan.native);
  const base = account.body?.account?.base_account ?? account.body?.account;
  if (String(base?.sequence) !== next || String(base?.account_number) !== plan.accountNumber) fail('Account sequence did not advance by one');
  let nonce;
  try {
    const answer = await (await network.fetch(network.evmRpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionCount', params: [plan.evm, 'latest'] }) })).json();
    nonce = BigInt(answer?.result).toString();
  } catch (error) {
    if (error?.message === 'Network request blocked') throw error;
    nonce = undefined;
  }
  if (nonce !== next) fail('EVM nonce is not the new sequence');
  const pqc = await getJson(network, '/qorechain/pqc/v1/account/' + plan.native);
  const key = typeof pqc.body?.account?.public_key === 'string' ? Buffer.from(pqc.body.account.public_key, 'base64') : Buffer.alloc(0);
  if (pqc.body?.found !== true || Number(pqc.body.account?.algorithm_id) !== sdk.AlgorithmDilithium5 || sha256Hex(key) !== plan.pqcPublicKeySha256) fail('Registered PQC key changed');

  const w = (await getJson(network, '/qorechain/pqc/v1/evm_window/' + plan.native)).body ?? {};
  const big = v => { try { return BigInt(v); } catch { return -1n; } };
  if (w.found !== true) fail('Window not found');
  else {
    if (w.live !== true) fail('Window not live');
    if (big(w.opened_height) !== height) fail('Window not opened by this transaction');
    if (big(w.expiry_height) - big(w.opened_height) !== BigInt(plan.windowBlocks)) fail('Window length differs from the plan');
    if (big(w.max_txs) !== BigInt(plan.maxTxs) || big(w.max_value) !== maxValue) fail('Window bounds differ from the plan');
    if (big(w.used_txs) !== 0n || big(w.used_value) !== 0n || big(w.remaining_txs) !== BigInt(plan.maxTxs) || big(w.remaining_value) !== maxValue) fail('Window already used');
    if (w.native_only === true || !scopeMatches(w.allowed_targets,plan.allowedTargets)) fail('Window scope differs from the plan');
  }
  let balanceAfter;
  if (before !== undefined) {
    const balance = await getJson(network, '/cosmos/bank/v1beta1/balances/' + plan.native + '/by_denom?denom=' + plan.denom);
    balanceAfter = balance.body?.balance?.amount;
    const drop = /^\d+$/.test(balanceAfter ?? '') ? BigInt(before) - BigInt(balanceAfter) : -1n;
    if (drop <= 0n || drop > BigInt(feeFor(plan.gasLimit, plan.gasPrice))) fail('Balance drop is not the window fee');
  }
  return {
    mode: 'verify', txHash: txHash.toUpperCase(), height: height.toString(), verified: failures.length === 0, failures,
    window: { found: w.found === true, live: w.live === true, openedHeight: String(w.opened_height ?? ''), expiryHeight: String(w.expiry_height ?? ''), maxTxs: String(w.max_txs ?? ''), maxValue: String(w.max_value ?? ''), usedTxs: String(w.used_txs ?? ''), usedValue: String(w.used_value ?? '') },
    sequence: String(base?.sequence ?? ''), evmNonce: nonce ?? '', ...(balanceAfter !== undefined ? { uqorBalance: balanceAfter } : {}),
  };
}

/** Fixed messages only: never an SDK error, a chain message, or record contents. */
export function failureMessage(error) {
  if (error instanceof WindowCheckError) return prepareFailureMessage(error);
  if (OPEN_FAILURES.includes(error?.message)) return error.message;
  if (error instanceof CheckError || error instanceof FormatError) return signFailureMessage(error);
  const sign = signFailureMessage(error);
  return sign === 'Prepare stopped' ? prepareFailureMessage(error) : sign;
}

export function parseArgs(args) {
  if(args.includes('--sequence')){
    const index=args.indexOf('--sequence'),value=args[index+1];
    if(index!==args.length-2||!/^\d+$/.test(value??'')||BigInt(value)>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Unknown option');
    return {...parseArgs(args.slice(0,index)),sequence:BigInt(value).toString()};
  }
  if (args.length === 0) return { mode: 'prepare' };
  if (args.length === 1 && args[0] === '--sign-and-verify-local') return { mode: 'local' };
  if (args.length === 1 && args[0] === '--broadcast') return { mode: 'broadcast' };
  if (args.length === 2 && args[0] === '--verify' && /^[0-9A-Fa-f]{64}$/.test(args[1])) return { mode: 'verify', txHash: args[1].toUpperCase() };
  throw new Error('Unknown option');
}

const writeReport = report => process.stdout.write(JSON.stringify(report, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n');

async function main() {
  const { mode, txHash, sequence } = parseArgs(process.argv.slice(2));
  const plan=sequence===undefined?WINDOW_PLAN:Object.freeze({...WINDOW_PLAN,sequence});
  if (mode === 'prepare') {
    // PREPARE: the 7C-22 guard, which has no broadcast route at all.
    await prepareDeploymentWindow({ network: prepareNetwork(), plan, write: writeReport });
    return;
  }
  if (mode === 'verify') {
    const result = await verifyOpenedWindow({ network: prepareNetwork(), txHash, plan });
    writeReport(result);
    if (!result.verified) process.exitCode = 1;
    return;
  }
  if (process.platform !== 'win32' || !process.stdin.isTTY || !process.stdout.isTTY || process.execArgv.length || process.env.NODE_OPTIONS) {
    throw new Error('Interactive Windows terminal required');
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  try {
    process.stdout.write((mode === 'local' ? 'Diana EVM window SIGN-AND-VERIFY-LOCAL for ' : 'Diana EVM window BROADCAST for ') + INVOICE_OWNER.native + '\n'
      + (mode === 'local'
        ? 'The signed window transaction is verified locally. The network is sealed before signing; the signed bytes never leave this process.\n'
        : 'Two typed confirmations: one naming the window, before signing; one naming the transaction hash, before the single broadcast.\n')
      + 'Only public values are shown.\n');
    await (mode === 'local' ? runWindowSignLocal : runWindowBroadcast)({
      network: mode === 'local' ? prepareNetwork() : dianaWindowNetwork(), plan,
      readRecord: () => readRecordBytes(RECORD_PATH),
      confirm: async phrase => (await prompt.question('\n*** Type ' + phrase + ' to continue, anything else stops: ')).trim(),
      write: writeReport,
    });
  } finally {
    prompt.close();
  }
}

// Runs only when started directly (`node .\diana-window-open.mjs`), not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase()) {
  main().catch(error => {
    process.stderr.write('Diana EVM window tool stopped: ' + failureMessage(error) + '. No file was written.\n');
    process.exitCode = 1;
  });
}
