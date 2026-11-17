// Diana Invoice Owner: PREPARE the first hybrid-signed (classical + ML-DSA-87) Cosmos transaction,
// a 1 uqor MsgSend from the account to itself. PREPARE ONLY: this file has no access to any key,
// recovery record or vault, has no signing code, and has no broadcast route.
//
// Everything it needs is public and read from the chain: the account number, sequence, balance,
// the on-chain eth_secp256k1 public key, and the registered ML-DSA-87 public key. It builds the
// exact unsigned transaction a later, separately approved signing step would sign, simulates it
// with all-zero placeholders in place of both signatures, and prints the fields, the hashes of the
// bytes each key would sign, the gas estimate and the fee ceiling.
//
// The SDK 0.14.0 hybrid format it targets (`signHybridEth`):
//   1. B0 = TxBody{messages, memo, timeoutHeight} (no extension); A = AuthInfo (eth_secp256k1 key,
//      SIGN_MODE_DIRECT, sequence, fee).
//   2. The ML-DSA-87 key signs hybridSignBytes("v2", chainId, B0, A) =
//      "qorechain-pqc-hybrid-v2" || be64(len chainId) || chainId || be32(len B0) || B0 || be32(len A) || A.
//   3. B = B0 + extension_options[ /qorechain.pqc.v1.PQCHybridSignature{algorithm_id 1, 4627-byte
//      signature, no public key (the key is registered)} ].
//   4. The classical key signs SignDoc{B, A, chainId, accountNumber} (keccak256, secp256k1, 64 bytes).
import { createHash } from 'node:crypto';
import { win32 as path } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sdk from '@qorechain/sdk';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { AuthInfo, Fee, ModeInfo, SignDoc, SignerInfo, TxBody, TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import { SignMode } from 'cosmjs-types/cosmos/tx/signing/v1beta1/signing';
import { PubKey } from 'cosmjs-types/cosmos/crypto/secp256k1/keys';

const { PQCHybridSignature } = sdk.qorechainTypes.pqcHybrid;

/** The fixed plan: 1 uqor from the Invoice Owner to itself, at sequence 1. */
export const PLAN = Object.freeze({
  chainId: 'qorechain-diana',
  evmChainId: 9800,
  native: 'qor1dfw567en2l0edze2xqzqw8kwnrcpt3u5m9n88r',
  evm: '0x6a5d4D7B3357df968b2A3004071eCe98f015C794',
  accountNumber: '16046',
  sequence: '1',
  pqcPublicKeySha256: 'a3b2c32d6e5d35138c69c2154d36ba0ba1779658cd4f9bc1567b5e35831bab5a',
  denom: 'uqor',
  amount: '1',
  memo: '',
  signBytesVersion: 'v2',
  gasLimit: 350000,
  gasPrice: '0.15',
  // A placeholder signature is not a valid one, so the simulation may not charge the ML-DSA-87
  // verification. The SDK's documented verification cost is added to the simulated gas.
  hybridVerifyGas: sdk.HYBRID_VERIFY_GAS,
  gasHeadroom: 1.3,
});

export const PREPARE_FAILURES = Object.freeze([
  'Wrong chain id',
  'Account not found on chain',
  'Unexpected account number',
  'Account sequence changed',
  'On-chain classical key missing or not this account',
  'PQC key not registered',
  'Registered PQC key is not the expected key',
  'Registered PQC algorithm is not ML-DSA-87',
  'Chain does not use v2 hybrid sign bytes',
  'Insufficient uqor balance',
  'Gas price below the chain minimum',
]);
export const FORMAT_FAILURES = Object.freeze([
  'Unreadable transaction',
  'Wrong message',
  'Missing or extra hybrid extension',
  'Hybrid extension not in extension_options',
  'Wrong PQC algorithm',
  'Wrong PQC signature length',
  'PQC public key must not be attached',
  'PQC signature does not verify',
  'Wrong signer info',
  'Wrong fee',
  'Classical signature does not verify',
]);
const OTHER_FAILURES = Object.freeze(['Network request blocked', 'Chain state unreadable', 'Simulation failed', 'Estimated gas exceeds the safe gas limit']);

export class CheckError extends Error {
  constructor(failures) { super('Check failed'); this.failures = failures; }
}

const sha256Hex = bytes => createHash('sha256').update(bytes).digest('hex');

export function feeFor(gas, price) {
  const [whole, fraction = ''] = String(price).split('.');
  const scale = 10n ** BigInt(fraction.length);
  return ((BigInt(gas) * BigInt(whole + fraction) + scale - 1n) / scale).toString();
}
function decimalAtLeast(a, b) {
  const [aw, af = ''] = String(a).split('.');
  const [bw, bf = ''] = String(b).split('.');
  const n = Math.max(af.length, bf.length);
  return BigInt(aw + af.padEnd(n, '0')) >= BigInt(bw + bf.padEnd(n, '0'));
}

/** HTTPS to the two Diana hosts only: GET on REST, the simulation route, and eth_chainId. No broadcast route exists. */
export function guardedFetch(endpoints, fetchImpl = globalThis.fetch) {
  const rest = new URL(endpoints.rest);
  const evm = new URL(endpoints.evmRpc);
  return async (url, init = {}) => {
    const target = new URL(String(url));
    const method = (init.method ?? 'GET').toUpperCase();
    let allowed = false;
    if (target.protocol === 'https:' && target.host === rest.host) {
      allowed = method === 'GET' || (method === 'POST' && target.pathname === '/cosmos/tx/v1beta1/simulate');
    } else if (target.protocol === 'https:' && target.host === evm.host && method === 'POST') {
      try { allowed = JSON.parse(init.body).method === 'eth_chainId'; } catch { allowed = false; }
    }
    if (!allowed) throw new Error('Network request blocked');
    return fetchImpl(target.href, { ...init, redirect: 'error', credentials: 'omit' });
  };
}

async function getJson(fetch, rest, route) {
  const response = await fetch(rest.replace(/\/+$/, '') + route);
  let body;
  try { body = await response.json(); } catch { body = undefined; }
  return { status: response.status, body };
}

/** Public chain state for the account, read without changing anything. */
export async function fetchLiveState(native, { rest, evmRpc, fetch }) {
  try {
    const nodeInfo = await getJson(fetch, rest, '/cosmos/base/tendermint/v1beta1/node_info');
    const evmAnswer = await (await fetch(evmRpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) })).json();
    const auth = await getJson(fetch, rest, '/cosmos/auth/v1beta1/accounts/' + native);
    const balance = await getJson(fetch, rest, '/cosmos/bank/v1beta1/balances/' + native + '/by_denom?denom=' + PLAN.denom);
    const pqc = await getJson(fetch, rest, '/qorechain/pqc/v1/account/' + native);
    const minGasPrice = await sdk.fetchMinGasPriceUqor({ rest, fetch });
    const signBytesVersion = await sdk.resolveSignBytesVersion({ chainId: PLAN.chainId, rest, fetch, forceRefresh: true });
    if (auth.status !== 200 && auth.status !== 404) throw new Error('auth');
    if (balance.status !== 200 || typeof balance.body?.balance?.amount !== 'string') throw new Error('balance');
    if (pqc.status !== 200 || typeof pqc.body?.found !== 'boolean') throw new Error('pqc');
    const raw = auth.body?.account;
    const base = raw?.base_account ?? raw;
    const pqcKey = pqc.body.found && typeof pqc.body.account?.public_key === 'string' ? Buffer.from(pqc.body.account.public_key, 'base64') : undefined;
    return {
      chainId: nodeInfo.body?.default_node_info?.network,
      evmChainId: Number.parseInt(evmAnswer?.result, 16),
      account: auth.status === 200 && base
        ? { exists: true, accountNumber: String(base.account_number), sequence: String(base.sequence), pubKeyType: base.pub_key?.['@type'] ?? null, pubKey: base.pub_key?.key ?? null }
        : { exists: false },
      uqor: balance.body.balance.amount,
      pqc: { registered: pqc.body.found, algorithmId: Number(pqc.body.account?.algorithm_id), publicKey: pqcKey },
      minGasPrice: String(minGasPrice),
      signBytesVersion,
    };
  } catch (error) {
    if (error?.message === 'Network request blocked') throw error;
    throw new Error('Chain state unreadable');
  }
}

/** The account's compressed eth_secp256k1 key as 0x-hex, when it is on chain and derives this address. */
export function classicalKeyHex(state, plan) {
  if (state.account?.pubKeyType !== sdk.ETHSECP256K1_PUBKEY_TYPE || typeof state.account.pubKey !== 'string') return undefined;
  const key = Buffer.from(state.account.pubKey, 'base64');
  try {
    return sdk.validateClassicalKeyForSender(plan.native, new Uint8Array(key)) === 'eth' ? '0x' + key.toString('hex') : undefined;
  } catch {
    return undefined;
  }
}

/** Every reason the live state does not allow the planned transaction; empty when it does. */
export function prepareFailures(state, plan = PLAN) {
  const failures = [];
  if (state.chainId !== plan.chainId || state.evmChainId !== plan.evmChainId) failures.push('Wrong chain id');
  if (!state.account?.exists) {
    failures.push('Account not found on chain');
  } else {
    if (state.account.accountNumber !== plan.accountNumber) failures.push('Unexpected account number');
    if (state.account.sequence !== plan.sequence) failures.push('Account sequence changed');
    if (!classicalKeyHex(state, plan)) failures.push('On-chain classical key missing or not this account');
  }
  if (state.pqc?.registered !== true) {
    failures.push('PQC key not registered');
  } else {
    if (!(state.pqc.publicKey instanceof Uint8Array) || state.pqc.publicKey.length !== sdk.ML_DSA_87_PUBLIC_KEY_LENGTH || sha256Hex(state.pqc.publicKey) !== plan.pqcPublicKeySha256) failures.push('Registered PQC key is not the expected key');
    if (state.pqc.algorithmId !== sdk.AlgorithmDilithium5) failures.push('Registered PQC algorithm is not ML-DSA-87');
  }
  if (state.signBytesVersion !== plan.signBytesVersion) failures.push('Chain does not use v2 hybrid sign bytes');
  const needed = BigInt(feeFor(plan.gasLimit, plan.gasPrice)) + BigInt(plan.amount);
  if (!/^\d+$/.test(state.uqor ?? '') || BigInt(state.uqor) < needed) failures.push('Insufficient uqor balance');
  if (!/^\d+(\.\d+)?$/.test(state.minGasPrice ?? '') || !decimalAtLeast(plan.gasPrice, state.minGasPrice)) failures.push('Gas price below the chain minimum');
  return failures;
}

export function selfSendMessage(plan = PLAN) {
  return { typeUrl: '/cosmos.bank.v1beta1.MsgSend', value: { fromAddress: plan.native, toAddress: plan.native, amount: [{ denom: plan.denom, amount: plan.amount }] } };
}

/**
 * The unsigned parts, exactly as `signHybridEth` builds them: B0 (body without the extension), A
 * (auth info) and the bytes the ML-DSA-87 key would sign. No key is involved.
 */
export function unsignedHybridParts({ publicKeyHex, plan = PLAN, registry = sdk.qorechainRegistry(), message = selfSendMessage(plan) }) {
  const messages = [registry.encodeAsAny(message)];
  const b0 = TxBody.encode(TxBody.fromPartial({ messages, memo: plan.memo, timeoutHeight: BigInt(plan.timeoutHeight ?? 0) })).finish();
  const authInfoBytes = AuthInfo.encode(AuthInfo.fromPartial({
    signerInfos: [SignerInfo.fromPartial({
      publicKey: { typeUrl: sdk.ETHSECP256K1_PUBKEY_TYPE, value: PubKey.encode(PubKey.fromPartial({ key: Buffer.from(publicKeyHex.replace(/^0x/, ''), 'hex') })).finish() },
      modeInfo: ModeInfo.fromPartial({ single: { mode: SignMode.SIGN_MODE_DIRECT } }),
      sequence: BigInt(plan.sequence),
    })],
    fee: Fee.fromPartial({ amount: [{ denom: plan.denom, amount: feeFor(plan.gasLimit, plan.gasPrice) }], gasLimit: BigInt(plan.gasLimit), granter: '', payer: '' }),
  })).finish();
  const pqcSignBytes = sdk.hybridSignBytes(plan.signBytesVersion, plan.chainId, b0, authInfoBytes);
  return { messages, b0, authInfoBytes, pqcSignBytes };
}

/** The simulation transaction: B0 plus a hybrid extension whose 4627-byte signature is all zero, and a 64-byte all-zero classical signature. */
export function placeholderSimulationTx(parts, plan = PLAN) {
  const ext = sdk.encodeHybridExtension(sdk.buildHybridSignatureExtension({ algorithmId: sdk.AlgorithmDilithium5, signature: new Uint8Array(sdk.ML_DSA_87_SIGNATURE_LENGTH) }));
  const bodyBytes = TxBody.encode(TxBody.fromPartial({ messages: parts.messages, memo: plan.memo, timeoutHeight: BigInt(plan.timeoutHeight ?? 0), extensionOptions: [ext] })).finish();
  return TxRaw.encode(TxRaw.fromPartial({ bodyBytes, authInfoBytes: parts.authInfoBytes, signatures: [new Uint8Array(64)] })).finish();
}

export async function simulate(txBytes, { rest, fetch }) {
  let body;
  try {
    const response = await fetch(rest.replace(/\/+$/, '') + '/cosmos/tx/v1beta1/simulate', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tx_bytes: Buffer.from(txBytes).toString('base64') }),
    });
    body = await response.json();
    if (!response.ok) throw new Error('simulate');
  } catch (error) {
    if (error?.message === 'Network request blocked') throw error;
    throw new Error('Simulation failed');
  }
  const gas = Number(body?.gas_info?.gas_used);
  if (!Number.isSafeInteger(gas) || gas <= 0) throw new Error('Simulation failed');
  return gas;
}

/**
 * Checks a hybrid-signed transaction against the plan, with public keys only: the message, the
 * extension's place and shape, the ML-DSA-87 signature over the v2 sign bytes of B0 and A, the
 * signer info and fee, and the classical signature over the SignDoc of the final body. Returns the
 * list of format failures; empty when the transaction is the planned one, correctly signed.
 */
export function hybridFormatFailures(txRawBytes, { classicalPublicKeyHex, pqcPublicKey, plan = PLAN, registry = sdk.qorechainRegistry() }) {
  let raw, body, auth;
  try {
    raw = TxRaw.decode(txRawBytes);
    body = TxBody.decode(raw.bodyBytes);
    auth = AuthInfo.decode(raw.authInfoBytes);
  } catch {
    return ['Unreadable transaction'];
  }
  const failures = [];
  const expected = unsignedHybridParts({ publicKeyHex: classicalPublicKeyHex, plan, registry });
  const b0 = TxBody.encode(TxBody.fromPartial({ messages: body.messages, memo: body.memo, timeoutHeight: body.timeoutHeight })).finish();
  if (Buffer.compare(Buffer.from(b0), Buffer.from(expected.b0)) !== 0) failures.push('Wrong message');
  if (body.nonCriticalExtensionOptions.some(e => e.typeUrl === sdk.HYBRID_SIG_TYPE_URL)) failures.push('Hybrid extension not in extension_options');
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
      const signBytes = sdk.hybridSignBytes(plan.signBytesVersion, plan.chainId, b0, raw.authInfoBytes);
      let ok = false;
      try { ok = sdk.pqcVerify(pqcPublicKey, signBytes, ext.pqcSignature); } catch { ok = false; }
      if (!ok) failures.push('PQC signature does not verify');
    }
  }
  const signer = auth.signerInfos;
  const expectedKey = PubKey.encode(PubKey.fromPartial({ key: Buffer.from(classicalPublicKeyHex.replace(/^0x/, ''), 'hex') })).finish();
  const signerOk = signer.length === 1 && signer[0].modeInfo?.single?.mode === SignMode.SIGN_MODE_DIRECT && signer[0].sequence === BigInt(plan.sequence)
    && signer[0].publicKey?.typeUrl === sdk.ETHSECP256K1_PUBKEY_TYPE && Buffer.compare(Buffer.from(signer[0].publicKey.value), Buffer.from(expectedKey)) === 0;
  const fee = auth.fee;
  const feeOk = fee?.gasLimit === BigInt(plan.gasLimit) && fee.amount?.length === 1 && fee.amount[0].denom === plan.denom
    && fee.amount[0].amount === feeFor(plan.gasLimit, plan.gasPrice) && fee.granter === '' && fee.payer === '';
  if (!signerOk) failures.push('Wrong signer info');
  if (!feeOk) failures.push('Wrong fee');
  // Anything else in the auth info that differs from the plan is also refused.
  if (signerOk && feeOk && Buffer.compare(Buffer.from(raw.authInfoBytes), Buffer.from(expected.authInfoBytes)) !== 0) failures.push('Wrong signer info');
  const signDoc = SignDoc.encode(SignDoc.fromPartial({ bodyBytes: raw.bodyBytes, authInfoBytes: raw.authInfoBytes, chainId: plan.chainId, accountNumber: BigInt(plan.accountNumber) })).finish();
  let classicalOk = false;
  try {
    classicalOk = raw.signatures.length === 1 && raw.signatures[0].length === 64
      && secp256k1.verify(raw.signatures[0], sdk.keccak256(signDoc), Buffer.from(classicalPublicKeyHex.replace(/^0x/, ''), 'hex'), { prehash: false });
  } catch { classicalOk = false; }
  if (!classicalOk) failures.push('Classical signature does not verify');
  return failures;
}

/** PREPARE: read, check, build, simulate with placeholders, and report. Never signs, never broadcasts. */
export async function prepareHybridSelfSend({ network, plan = PLAN, write }) {
  const state = await fetchLiveState(plan.native, network);
  const failures = prepareFailures(state, plan);
  if (failures.length) throw new CheckError(failures);
  const publicKeyHex = classicalKeyHex(state, plan);
  const parts = unsignedHybridParts({ publicKeyHex, plan });
  const simulatedGas = await simulate(placeholderSimulationTx(parts, plan), network);
  const estimatedGas = simulatedGas + plan.hybridVerifyGas;
  const report = {
    mode: 'prepare', signed: false, broadcast: false,
    chainId: plan.chainId, evmChainId: state.evmChainId,
    message: '/cosmos.bank.v1beta1.MsgSend', from: plan.native, to: plan.native, amount: plan.amount + plan.denom,
    accountNumber: state.account.accountNumber, sequence: state.account.sequence, uqorBalance: state.uqor,
    classicalPublicKey: publicKeyHex, pqcAlgorithmId: state.pqc.algorithmId, pqcPublicKeySha256: sha256Hex(state.pqc.publicKey),
    signMode: 'SIGN_MODE_DIRECT', signBytesVersion: state.signBytesVersion,
    hybridExtension: { typeUrl: sdk.HYBRID_SIG_TYPE_URL, placement: 'extension_options', algorithmId: sdk.AlgorithmDilithium5, signatureBytes: sdk.ML_DSA_87_SIGNATURE_LENGTH, publicKeyAttached: false },
    b0Sha256: sha256Hex(parts.b0), authInfoSha256: sha256Hex(parts.authInfoBytes), pqcSignBytesSha256: sha256Hex(parts.pqcSignBytes),
    minGasPrice: state.minGasPrice, gasPrice: plan.gasPrice, gasLimit: plan.gasLimit,
    feeCeiling: feeFor(plan.gasLimit, plan.gasPrice) + plan.denom,
    simulatedGasWithPlaceholders: simulatedGas,
    estimatedGas,
    estimateIsExact: false,
    gasNote: 'Simulated with all-zero placeholder signatures, plus the SDK hybrid verification cost. Exact gas needs a simulation of the really signed transaction.',
    gasFitsWithHeadroom: Math.ceil(estimatedGas * plan.gasHeadroom) <= plan.gasLimit,
  };
  if (!report.gasFitsWithHeadroom) {
    write(report);
    throw new Error('Estimated gas exceeds the safe gas limit');
  }
  write(report);
  return report;
}

export function failureMessage(error) {
  if (error instanceof CheckError) return 'Check failed: ' + error.failures.filter(f => PREPARE_FAILURES.includes(f)).join('; ');
  return OTHER_FAILURES.includes(error?.message) ? error.message : 'Prepare stopped';
}

export function dianaNetwork(fetchImpl = globalThis.fetch) {
  const { rest, evmRpc } = sdk.NETWORKS.testnet.endpoints;
  return { rest, evmRpc, fetch: guardedFetch({ rest, evmRpc }, fetchImpl) };
}

// Runs only when started directly (`node .\diana-hybrid-prepare.mjs`), not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase()) {
  prepareHybridSelfSend({ network: dianaNetwork(), write: report => process.stdout.write(JSON.stringify(report, null, 2) + '\n') })
    .catch(error => {
      process.stderr.write('Diana hybrid prepare stopped: ' + failureMessage(error) + '. Nothing was signed or sent.\n');
      process.exitCode = 1;
    });
}
