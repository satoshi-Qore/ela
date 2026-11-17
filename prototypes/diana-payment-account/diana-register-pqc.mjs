// Diana Invoice Owner: canonical ML-DSA-87 key registration (MsgRegisterPQCKeyV2), run by the user
// in their own interactive Windows PowerShell session.
//
// Default (no option): PREPARE ONLY. It reads the existing recovery record read-only, derives the
// account in memory, re-reads the live chain (chain id, account number, sequence, balance, PQC
// status, minimum gas price, PoP support), builds the registration message, and simulates it
// WITHOUT any signature: the simulated transaction carries a 64-byte all-zero placeholder where
// the signature goes and no proof of possession. Nothing is signed or broadcast.
//
// `--broadcast`: after the prepare step passes, a first typed confirmation allows signing (the
// proof of possession and the transaction, both in memory); the exact final transaction is then
// simulated again and the chain re-read; only a second, different typed confirmation broadcasts it.
//
// Only public values are printed: addresses, account number, sequence, balance, fee and gas, the
// PQC public key's SHA-256 fingerprint, and the transaction hash. The mnemonic, password, private
// key, PQC secret key and record contents are never printed, logged or written anywhere.
import { createHash } from 'node:crypto';
import { win32 as path } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import * as sdk from '@qorechain/sdk';
import { AuthInfo, Fee, ModeInfo, SignerInfo, TxBody, TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import { SignMode } from 'cosmjs-types/cosmos/tx/signing/v1beta1/signing';
import { PubKey } from 'cosmjs-types/cosmos/crypto/secp256k1/keys';
import { SAFE_FAILURES, withVerifiedAccount } from './diana-canonical-pqc.mjs';
import { INVOICE_OWNER, RECORD_PATH, readRecordBytes } from './diana-verify-recovery.mjs';

const MAX_RECORD_BYTES = 4096;

/** The fixed plan for the first (bootstrap) registration of the Invoice Owner's canonical key. */
export const PLAN = Object.freeze({
  chainId: 'qorechain-diana',
  evmChainId: 9800,
  accountNumber: '16046',
  sequence: '0',
  denom: 'uqor',
  gasLimit: 600000,
  gasPrice: '0.15',
  // Measured on Diana with a throwaway key: a proof of possession adds 49,050 gas. Used only to
  // estimate the PoP-carrying transaction in prepare mode, where no PoP is signed.
  popGasAllowance: 60000,
  // The final, exact simulation must fit the gas limit with this headroom, or nothing is sent.
  gasHeadroom: 1.3,
});

export const PREPARE_CONFIRMATION = 'PREPARE DIANA PQC REGISTRATION';
export const SIGN_CONFIRMATION = 'SIGN PQC REGISTRATION FOR ' + PLAN.accountNumber;
export const BROADCAST_CONFIRMATION = 'BROADCAST TO ' + PLAN.chainId.toUpperCase();

/** The only messages this tool shows, besides the verifier's own; anything else is generic. */
export const REGISTER_FAILURES = Object.freeze([
  'Interactive Windows terminal required',
  'Unknown option',
  'Not confirmed',
  'Record is not EFS-encrypted',
  'Network request blocked',
  'Chain state unreadable',
  'Simulation failed',
  'Simulated gas exceeds the safe gas limit',
  'Proof of possession does not verify',
  'Broadcast refused by the node',
  'Broadcast hash mismatch',
  'Broadcast result unknown',
  'Signed transaction differs from the simulation',
]);
const BROADCAST_TIMEOUT_MS = 60000;
export const PREFLIGHT_FAILURES = Object.freeze([
  'Wrong chain id',
  'Account not found on chain',
  'Unexpected account number',
  'Account sequence changed',
  'On-chain classical key is a different key',
  'PQC key already registered',
  'Insufficient uqor balance',
  'Gas price below the chain minimum',
  'Chain does not support proof of possession',
]);

export class PreflightError extends Error {
  constructor(failures) {
    super('Pre-flight failed');
    this.failures = failures;
  }
}

/** Fee in the smallest unit: ceil(gas × price), with the price as a decimal string. */
export function feeFor(gas, price) {
  const [whole, fraction = ''] = String(price).split('.');
  const scale = 10n ** BigInt(fraction.length);
  const scaled = BigInt(whole + fraction);
  return ((BigInt(gas) * scaled + scale - 1n) / scale).toString();
}

function decimalAtLeast(a, b) {
  const [aw, af = ''] = String(a).split('.');
  const [bw, bf = ''] = String(b).split('.');
  const digits = Math.max(af.length, bf.length);
  return BigInt(aw + af.padEnd(digits, '0')) >= BigInt(bw + bf.padEnd(digits, '0'));
}

/**
 * The only network access the tool has. HTTPS to the two Diana testnet hosts only; GET is free on
 * the REST host; POST is allowed for the signature-less simulation, for `eth_chainId` on the EVM
 * host, and for the broadcast route only while `allowBroadcast()` is true.
 */
export function guardedFetch(endpoints, { allowBroadcast = () => false, fetchImpl = globalThis.fetch } = {}) {
  const rest = new URL(endpoints.rest);
  const evm = new URL(endpoints.evmRpc);
  let broadcastUsed = false; // the broadcast route passes at most once per guard
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

/** Reads, without changing anything, the chain state the registration depends on. */
export async function fetchLiveState(native, { rest, evmRpc, fetch }) {
  try {
    const nodeInfo = await getJson(fetch, rest, '/cosmos/base/tendermint/v1beta1/node_info');
    const evmAnswer = await (await fetch(evmRpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) })).json();
    const auth = await getJson(fetch, rest, '/cosmos/auth/v1beta1/accounts/' + native);
    const balance = await getJson(fetch, rest, '/cosmos/bank/v1beta1/balances/' + native + '/by_denom?denom=' + PLAN.denom);
    sdk.clearPqcStatusCache();
    const pqc = await sdk.fetchPqcStatus({ rest, address: native, fetch });
    const minGasPrice = await sdk.fetchMinGasPriceUqor({ rest, fetch });
    const popSupported = await sdk.isUpgradeApplied({ rest, upgrade: sdk.CHAIN_UPGRADE_V3_2_3, fetch, fresh: true });
    const raw = auth.body?.account;
    const base = raw?.base_account ?? raw;
    if (auth.status !== 200 && auth.status !== 404) throw new Error('auth');
    if (balance.status !== 200 || typeof balance.body?.balance?.amount !== 'string') throw new Error('balance');
    return {
      chainId: nodeInfo.body?.default_node_info?.network,
      evmChainId: Number.parseInt(evmAnswer?.result, 16),
      account: auth.status === 200 && base
        ? { exists: true, accountNumber: String(base.account_number), sequence: String(base.sequence), pubKey: base.pub_key?.key ?? null }
        : { exists: false },
      uqor: balance.body.balance.amount,
      pqcRegistered: pqc.registered === true,
      minGasPrice: String(minGasPrice),
      popSupported: popSupported === true,
    };
  } catch (error) {
    if (error?.message === 'Network request blocked') throw error;
    throw new Error('Chain state unreadable');
  }
}

/** Every reason the live state does not allow this registration; empty when it does. */
export function preflightFailures(state, publicKeyHex, plan = PLAN) {
  const failures = [];
  if (state.chainId !== plan.chainId || state.evmChainId !== plan.evmChainId) failures.push('Wrong chain id');
  if (!state.account?.exists) {
    failures.push('Account not found on chain');
  } else {
    if (state.account.accountNumber !== plan.accountNumber) failures.push('Unexpected account number');
    if (state.account.sequence !== plan.sequence) failures.push('Account sequence changed');
    if (state.account.pubKey !== null && state.account.pubKey !== Buffer.from(publicKeyHex.replace(/^0x/, ''), 'hex').toString('base64')) {
      failures.push('On-chain classical key is a different key');
    }
  }
  if (state.pqcRegistered !== false) failures.push('PQC key already registered');
  if (!/^\d+$/.test(state.uqor ?? '') || BigInt(state.uqor) < BigInt(feeFor(plan.gasLimit, plan.gasPrice))) failures.push('Insufficient uqor balance');
  if (!/^\d+(\.\d+)?$/.test(state.minGasPrice ?? '') || !decimalAtLeast(plan.gasPrice, state.minGasPrice)) failures.push('Gas price below the chain minimum');
  if (state.popSupported !== true) failures.push('Chain does not support proof of possession');
  return failures;
}

function requirePreflight(state, publicKeyHex, plan) {
  const failures = preflightFailures(state, publicKeyHex, plan);
  if (failures.length) throw new PreflightError(failures);
}

/** `TxRaw` bytes, built with the same protobuf types the SDK uses. */
export function encodeTxRaw(bodyBytes, authInfoBytes, signatures) {
  return TxRaw.encode(TxRaw.fromPartial({ bodyBytes, authInfoBytes, signatures })).finish();
}

/**
 * The body and auth-info bytes `signClassicalEth` signs, built WITHOUT any key: the same eth_secp256k1
 * public key, SIGN_MODE_DIRECT, sequence and fee. The tests check they are byte-identical.
 */
export function unsignedTxParts({ publicKeyHex, message, sequence, plan = PLAN, registry = sdk.qorechainRegistry() }) {
  const bodyBytes = TxBody.encode(TxBody.fromPartial({ messages: [registry.encodeAsAny(message)], memo: '', timeoutHeight: 0n })).finish();
  const authInfoBytes = AuthInfo.encode(AuthInfo.fromPartial({
    signerInfos: [SignerInfo.fromPartial({
      publicKey: { typeUrl: sdk.ETHSECP256K1_PUBKEY_TYPE, value: PubKey.encode(PubKey.fromPartial({ key: Buffer.from(publicKeyHex.replace(/^0x/, ''), 'hex') })).finish() },
      modeInfo: ModeInfo.fromPartial({ single: { mode: SignMode.SIGN_MODE_DIRECT } }),
      sequence: BigInt(sequence),
    })],
    fee: Fee.fromPartial({ amount: [{ denom: plan.denom, amount: feeFor(plan.gasLimit, plan.gasPrice) }], gasLimit: BigInt(plan.gasLimit), granter: '', payer: '' }),
  })).finish();
  return { bodyBytes, authInfoBytes };
}

/** Simulates a transaction that carries NO signature (a 64-byte all-zero placeholder). */
export async function simulateUnsigned(parts, { rest, fetch }) {
  const txBytes = encodeTxRaw(parts.bodyBytes, parts.authInfoBytes, [new Uint8Array(64)]);
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

export function registrationMessage(native, publicKey, proofOfPossession) {
  return sdk.buildRegisterPqcKeyMsg(native, { pqcKeypair: { publicKey }, keyType: 'hybrid', proofOfPossession });
}

/** The proof of possession, checked locally exactly as the chain checks it. */
export function signedProofOfPossession(native, keypair, plan = PLAN, deps = {}) {
  const proof = (deps.signPop ?? sdk.signProofOfPossession)({ chainId: plan.chainId, account: native, keypair });
  if (!sdk.verifyProofOfPossession({ chainId: plan.chainId, account: native, publicKey: keypair.publicKey, proof })) {
    throw new Error('Proof of possession does not verify');
  }
  return proof;
}

const sha256Hex = bytes => createHash('sha256').update(bytes).digest('hex');

/**
 * The whole flow, with every outside effect injected: `network` (guarded fetch and endpoints),
 * `confirm(phrase)` (resolves to the user's typed answer), and `write(report)` (public output).
 * The record bytes are zeroed when this returns or throws.
 */
export async function runRegistration({ recordBytes, expected = INVOICE_OWNER, plan = PLAN, broadcast = false, network, confirm, write, deps = {} }) {
  let record;
  try {
    if (!(recordBytes instanceof Uint8Array) || recordBytes.length === 0 || recordBytes.length > MAX_RECORD_BYTES) throw new Error('Unreadable recovery record');
    try {
      record = JSON.parse(Buffer.from(recordBytes.buffer, recordBytes.byteOffset, recordBytes.byteLength).toString('utf8'));
    } catch {
      throw new Error('Unreadable recovery record');
    }
  } finally {
    if (recordBytes instanceof Uint8Array) recordBytes.fill(0);
  }
  return withVerifiedAccount(record, expected, async (account, summary) => {
    record = undefined;
    const native = account.cosmos;
    const state = await fetchLiveState(native, network);
    requirePreflight(state, account.publicKey, plan);
    const prepareGas = await simulateUnsigned(unsignedTxParts({ publicKeyHex: account.publicKey, message: registrationMessage(native, account.pqc.publicKey), sequence: state.account.sequence, plan }), network);
    const estimate = prepareGas + plan.popGasAllowance;
    const report = {
      role: expected.role ?? 'invoice-owner',
      mode: broadcast ? 'broadcast' : 'prepare',
      native, evm: account.evm,
      chainId: state.chainId, evmChainId: state.evmChainId,
      accountNumber: state.account.accountNumber, sequence: state.account.sequence,
      uqorBalance: state.uqor, pqcRegistered: state.pqcRegistered,
      algorithmId: summary.algorithmId, pqcPublicKeySha256: summary.pqcPublicKeySha256,
      minGasPrice: state.minGasPrice, gasPrice: plan.gasPrice, gasLimit: plan.gasLimit,
      fee: feeFor(plan.gasLimit, plan.gasPrice) + plan.denom,
      simulatedGasWithoutPop: prepareGas,
      estimatedGasWithPop: estimate,
      gasFitsWithHeadroom: Math.ceil(estimate * plan.gasHeadroom) <= plan.gasLimit,
      signed: false, broadcast: false,
    };
    if (!broadcast) {
      write(report);
      return report;
    }
    if (!report.gasFitsWithHeadroom) throw new Error('Simulated gas exceeds the safe gas limit');
    write(report);
    if ((await confirm(SIGN_CONFIRMATION)) !== SIGN_CONFIRMATION) throw new Error('Not confirmed');
    // Pre-sign: the user may have waited at the prompt; re-read the chain before anything is signed.
    requirePreflight(await fetchLiveState(native, network), account.publicKey, plan);

    // Everything the signature covers is fixed here, from the plan and the verified account only:
    // chain id, account number, sequence, sender, PQC public key, PoP, gas limit and fee.
    const proof = signedProofOfPossession(native, account.pqc, plan, deps);
    const message = registrationMessage(native, account.pqc.publicKey, proof);
    const parts = unsignedTxParts({ publicKeyHex: account.publicKey, message, sequence: plan.sequence, plan });
    const finalGas = await simulateUnsigned(parts, network);
    if (Math.ceil(finalGas * plan.gasHeadroom) > plan.gasLimit) throw new Error('Simulated gas exceeds the safe gas limit');
    const registry = sdk.qorechainRegistry();
    const signed = (deps.signClassical ?? sdk.signClassicalEth)({
      account: { privateKey: account.privateKey, publicKey: account.publicKey },
      chainId: plan.chainId, accountNumber: BigInt(plan.accountNumber), sequence: BigInt(plan.sequence),
      messages: [message], fee: { amount: [{ denom: plan.denom, amount: feeFor(plan.gasLimit, plan.gasPrice) }], gas: String(plan.gasLimit) },
      memo: '', encodeMessage: m => registry.encodeAsAny(m),
    });
    if (Buffer.compare(Buffer.from(signed.bodyBytes), Buffer.from(parts.bodyBytes)) !== 0 || Buffer.compare(Buffer.from(signed.authInfoBytes), Buffer.from(parts.authInfoBytes)) !== 0) {
      throw new Error('Signed transaction differs from the simulation');
    }
    const txHash = sha256Hex(signed.txRawBytes).toUpperCase();
    write({ ...report, signed: true, finalSimulatedGas: finalGas, txHash, warning: 'The next step broadcasts this transaction to ' + plan.chainId + ' and spends up to the fee. It cannot be undone.' });
    if ((await confirm(BROADCAST_CONFIRMATION)) !== BROADCAST_CONFIRMATION) throw new Error('Not confirmed');
    // Pre-broadcast: re-read the chain after the last confirmation; a changed sequence or a PQC
    // key registered meanwhile stops here, before the broadcast route is opened.
    requirePreflight(await fetchLiveState(native, network), account.publicKey, plan);

    // One attempt only, never retried. If the answer is lost (timeout, network error, unreadable
    // reply) the transaction may or may not be on chain: report its hash and stop. Re-running the
    // tool is safe: the pre-flight refuses once the sequence moves or the key is registered, and
    // the same sequence can be included at most once.
    network.allowBroadcast.value = true;
    let answer;
    try {
      const response = await network.fetch(network.rest.replace(/\/+$/, '') + '/cosmos/tx/v1beta1/txs', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tx_bytes: Buffer.from(signed.txRawBytes).toString('base64'), mode: 'BROADCAST_MODE_SYNC' }),
        signal: AbortSignal.timeout(BROADCAST_TIMEOUT_MS),
      });
      answer = (await response.json())?.tx_response;
    } catch {
      answer = undefined;
    } finally {
      network.allowBroadcast.value = false;
    }
    if (!answer || answer.code === undefined) {
      write({ ...report, signed: true, broadcast: 'unknown', txHash, next: 'Do not re-run. Check this hash and the account read-only first.' });
      throw new Error('Broadcast result unknown');
    }
    if (Number(answer.code) !== 0) {
      const refused = { ...report, signed: true, broadcast: false, txHash, code: Number(answer?.code ?? -1), codespace: String(answer?.codespace ?? '') };
      write(refused);
      throw new Error('Broadcast refused by the node');
    }
    if (String(answer.txhash).toUpperCase() !== txHash) throw new Error('Broadcast hash mismatch');
    const done = { ...report, signed: true, broadcast: true, finalSimulatedGas: finalGas, txHash, code: 0 };
    write(done);
    return done;
  }, deps);
}

/** The text shown for a failure: fixed messages only, never an SDK error or record contents. */
export function failureMessage(error) {
  if (error instanceof PreflightError) return 'Pre-flight failed: ' + error.failures.filter(f => PREFLIGHT_FAILURES.includes(f)).join('; ');
  const message = error?.message;
  return SAFE_FAILURES.includes(message) || REGISTER_FAILURES.includes(message) ? message : 'Registration stopped';
}

/** Network wiring for the real run: Diana testnet endpoints from the SDK, through the guard. */
export function dianaNetwork(fetchImpl = globalThis.fetch) {
  const { rest, evmRpc } = sdk.NETWORKS.testnet.endpoints;
  const allowBroadcast = { value: false };
  return { rest, evmRpc, allowBroadcast, fetch: guardedFetch({ rest, evmRpc }, { allowBroadcast: () => allowBroadcast.value, fetchImpl }) };
}

async function main() {
  if (process.platform !== 'win32' || !process.stdin.isTTY || !process.stdout.isTTY || process.execArgv.length || process.env.NODE_OPTIONS) {
    throw new Error('Interactive Windows terminal required');
  }
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--broadcast')) throw new Error('Unknown option');
  const broadcast = args[0] === '--broadcast';
  const prompt = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  try {
    process.stdout.write('Diana PQC registration for ' + INVOICE_OWNER.native + ' / ' + INVOICE_OWNER.evm + '\n'
      + (broadcast
        ? 'Mode: BROADCAST. Two further typed confirmations are needed before anything is signed or sent.\n'
        : 'Mode: PREPARE ONLY. Nothing is signed or broadcast; the simulation carries no signature.\n')
      + 'Only public values are shown.\n');
    const answer = await prompt.question('Type ' + PREPARE_CONFIRMATION + ' to continue: ');
    if (answer.trim() !== PREPARE_CONFIRMATION) throw new Error('Not confirmed');
    await runRegistration({
      recordBytes: readRecordBytes(RECORD_PATH),
      broadcast,
      network: dianaNetwork(),
      confirm: async phrase => (await prompt.question('\n*** Type ' + phrase + ' to continue, anything else stops: ')).trim(),
      write: report => process.stdout.write(JSON.stringify(report, null, 2) + '\n'),
    });
  } finally {
    prompt.close();
  }
}

// Runs only when started directly (`node .\diana-register-pqc.mjs`), not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase()) {
  main().catch(error => {
    process.stderr.write('Diana PQC registration stopped: ' + failureMessage(error) + '. No file was written.\n');
    process.exitCode = 1;
  });
}
