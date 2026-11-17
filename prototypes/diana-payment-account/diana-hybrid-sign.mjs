// Diana Invoice Owner: hybrid (classical ECDSA + ML-DSA-87) signing of the planned 1 uqor self-send,
// sent ONLY to the simulation endpoint. This tool has no broadcast route: the network guard it uses
// (from diana-hybrid-prepare.mjs) allows GET reads, `eth_chainId` and POST /cosmos/tx/v1beta1/simulate,
// and refuses everything else.
//
// `node .\diana-hybrid-sign.mjs` (default): PREPARE. Read-only; no vault, no record, no key, no signature.
//
// `node .\diana-hybrid-sign.mjs --sign-and-simulate`: in the user's own interactive Windows terminal:
//   1. PREPARE runs and prints the plan (fields, hashes of the bytes each key will sign, gas, fee ceiling).
//   2. The user types the confirmation. Only then is the Invoice Owner recovery record read (read-only),
//      the account derived in memory and checked: expected addresses, canonical ML-DSA-87 key, the
//      registered key's fingerprint, and the on-chain classical key.
//   3. The chain is re-read right before signing; any change stops the tool.
//   4. The transaction is signed with the SDK's `signHybridEth`. The fields come from the fixed plan;
//      only the timeout height is set, a few blocks ahead, so this signed simulation transaction
//      cannot be included later even if someone relayed it.
//   5. The signed bytes must pass `hybridFormatFailures` (both signatures verified locally with the
//      on-chain public keys) and match the planned auth info byte for byte.
//   6. The signed bytes go to the simulation endpoint only. The gas used (or the refusal) is reported,
//      and the signed bytes are zeroed.
//
// Only public values are printed. The mnemonic, password, private key, PQC secret key, record
// contents and the signed transaction bytes are never printed, logged or written anywhere.
import { createHash } from 'node:crypto';
import { win32 as path } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import * as sdk from '@qorechain/sdk';
import { SAFE_FAILURES, withVerifiedAccount } from './diana-canonical-pqc.mjs';
import {
  CheckError, PLAN, PREPARE_FAILURES, classicalKeyHex, dianaNetwork, failureMessage as prepareFailureMessage,
  feeFor, fetchLiveState, hybridFormatFailures, prepareFailures, prepareHybridSelfSend, selfSendMessage, unsignedHybridParts,
} from './diana-hybrid-prepare.mjs';
import { INVOICE_OWNER, RECORD_PATH, readRecordBytes } from './diana-verify-recovery.mjs';

export const SIGN_CONFIRMATION = 'SIGN AND SIMULATE HYBRID SELF-SEND FOR ' + PLAN.accountNumber;
/** Blocks between the latest height and the signed simulation transaction's timeout height. */
export const SIMULATION_TIMEOUT_BLOCKS = 5;
const MAX_RECORD_BYTES = 4096;
const SIMULATION_TIMEOUT_MS = 30000;

export const SIGN_FAILURES = Object.freeze([
  'Interactive Windows terminal required',
  'Unknown option',
  'Not confirmed',
  'Record is not EFS-encrypted',
  'Record PQC key is not the registered key',
  'Record classical key is not the on-chain key',
  'Signed transaction differs from the plan',
  'Simulation rejected the hybrid signature',
  'Simulation refused by the node',
  'Simulation result unknown',
  'Latest height unreadable',
]);

export class FormatError extends Error {
  constructor(failures) { super('Signed transaction failed the format check'); this.failures = failures; }
}

const sha256Hex = bytes => createHash('sha256').update(bytes).digest('hex');

async function latestHeight({ rest, fetch }) {
  try {
    const response = await fetch(rest.replace(/\/+$/, '') + '/cosmos/base/tendermint/v1beta1/blocks/latest');
    const height = BigInt((await response.json())?.block?.header?.height);
    if (!response.ok || height <= 0n) throw new Error('height');
    return height;
  } catch (error) {
    if (error?.message === 'Network request blocked') throw error;
    throw new Error('Latest height unreadable');
  }
}

/**
 * Sends signed bytes to the simulation endpoint only. Never retried. A missing, unreadable or timed
 * out answer is "unknown"; a refusal reports only its public code.
 */
export async function simulateSigned(txBytes, { rest, fetch }) {
  let response;
  let body;
  try {
    response = await fetch(rest.replace(/\/+$/, '') + '/cosmos/tx/v1beta1/simulate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tx_bytes: Buffer.from(txBytes).toString('base64') }),
      signal: AbortSignal.timeout(SIMULATION_TIMEOUT_MS),
    });
    body = await response.json();
  } catch (error) {
    if (error?.message === 'Network request blocked') throw error;
    return { outcome: 'unknown' };
  }
  const gas = Number(body?.gas_info?.gas_used);
  if (response.ok && Number.isSafeInteger(gas) && gas > 0) return { outcome: 'ok', gasUsed: gas };
  if (!response.ok && typeof body?.message === 'string') {
    return { outcome: sdk.isHybridSignBytesRejection({ rawLog: body.message, message: body.message }) ? 'rejected-hybrid' : 'refused', code: Number(body.code ?? -1), httpStatus: response.status };
  }
  return { outcome: 'unknown' };
}

/**
 * SIGN-AND-SIMULATE with every outside effect injected: `network` (the guarded Diana network),
 * `readRecord()` (returns the record bytes; called only after the confirmation), `confirm(phrase)`
 * (the user's typed answer) and `write(report)` (public output).
 */
/** Reads the record (only ever after the confirmation), parses it, and zeroes its bytes. */
function readParsedRecord(readRecord) {
  const recordBytes = readRecord();
  try {
    if (!(recordBytes instanceof Uint8Array) || recordBytes.length === 0 || recordBytes.length > MAX_RECORD_BYTES) throw new Error('Unreadable recovery record');
    try {
      return JSON.parse(Buffer.from(recordBytes.buffer, recordBytes.byteOffset, recordBytes.byteLength).toString('utf8'));
    } catch {
      throw new Error('Unreadable recovery record');
    }
  } finally {
    if (recordBytes instanceof Uint8Array) recordBytes.fill(0);
  }
}

/** Pre-sign: re-reads the chain (nothing from PREPARE is taken as still true) and ties the record's keys to the on-chain keys. */
async function presignChecks(account, summary, network, plan) {
  if (summary.pqcPublicKeySha256 !== plan.pqcPublicKeySha256) throw new Error('Record PQC key is not the registered key');
  const live = await fetchLiveState(plan.native, network);
  const failures = prepareFailures(live, plan);
  if (failures.length) throw new CheckError(failures);
  const onChainKey = classicalKeyHex(live, plan);
  if (account.publicKey.toLowerCase() !== onChainKey.toLowerCase()) throw new Error('Record classical key is not the on-chain key');
  if (sha256Hex(live.pqc.publicKey) !== summary.pqcPublicKeySha256) throw new Error('Record PQC key is not the registered key');
  return { live, onChainKey };
}

function signPlanned(account, plan, timeoutHeight, deps) {
  const registry = sdk.qorechainRegistry();
  return (deps.signHybrid ?? sdk.signHybridEth)({
    account: { privateKey: account.privateKey, publicKey: account.publicKey, pqc: account.pqc },
    chainId: plan.chainId, accountNumber: BigInt(plan.accountNumber), sequence: BigInt(plan.sequence),
    messages: [selfSendMessage(plan)],
    fee: { amount: [{ denom: plan.denom, amount: feeFor(plan.gasLimit, plan.gasPrice) }], gas: String(plan.gasLimit) },
    memo: plan.memo, timeoutHeight, encodeMessage: m => registry.encodeAsAny(m), signBytesVersion: plan.signBytesVersion,
  });
}

const zeroSigned = signed => { for (const bytes of [signed?.txRawBytes, signed?.bodyBytes, signed?.classicalSignature]) if (bytes instanceof Uint8Array) bytes.fill(0); };

/** Wraps a network so that, once sealed, every request is refused before it reaches the transport. */
export function sealableNetwork(network) {
  let sealed = false;
  return {
    seal: () => { sealed = true; },
    network: { ...network, fetch: async (url, init) => { if (sealed) throw new Error('Network request blocked'); return network.fetch(url, init); } },
  };
}

export const LOCAL_CONFIRMATION = 'SIGN AND VERIFY LOCALLY FOR ' + PLAN.accountNumber;

/**
 * SIGN-AND-VERIFY-LOCAL: signs the planned transaction exactly as planned (no timeout height) and
 * verifies it locally. The network is sealed right before signing: from then on no request of any
 * kind can leave, so the signed bytes never reach a node. They are never printed, written or
 * hashed into the output, and are zeroed before this returns or throws.
 */
export async function runSignAndVerifyLocal({ network, readRecord, confirm, write, plan = PLAN, expected = INVOICE_OWNER, deps = {} }) {
  const gate = sealableNetwork(network);
  const prepared = await prepareHybridSelfSend({ network: gate.network, plan, write });
  if ((await confirm(LOCAL_CONFIRMATION)) !== LOCAL_CONFIRMATION) throw new Error('Not confirmed');
  let record = readParsedRecord(readRecord);
  return withVerifiedAccount(record, { native: expected.native, evm: expected.evm }, async (account, summary) => {
    record = undefined;
    const { live, onChainKey } = await presignChecks(account, summary, gate.network, plan);
    const parts = unsignedHybridParts({ publicKeyHex: onChainKey, plan });
    gate.seal();
    let signed;
    try {
      signed = signPlanned(account, plan, 0n, deps);
      if (Buffer.compare(Buffer.from(signed.authInfoBytes), Buffer.from(parts.authInfoBytes)) !== 0) throw new Error('Signed transaction differs from the plan');
      const format = hybridFormatFailures(signed.txRawBytes, { classicalPublicKeyHex: onChainKey, pqcPublicKey: live.pqc.publicKey, plan });
      if (format.length) throw new FormatError(format);
      const report = {
        mode: 'sign-and-verify-local', signed: true, sentToNetwork: false, broadcast: false,
        chainId: plan.chainId, accountNumber: plan.accountNumber, sequence: plan.sequence, uqorBalance: live.uqor,
        classicalPublicKey: onChainKey, pqcPublicKeySha256: summary.pqcPublicKeySha256,
        formatCheck: 'pass', classicalSignature: 'verified with the on-chain eth_secp256k1 key', pqcSignature: 'verified with the registered ML-DSA-87 key',
        b0Sha256: sha256Hex(parts.b0), authInfoSha256: sha256Hex(parts.authInfoBytes), pqcSignBytesSha256: sha256Hex(parts.pqcSignBytes),
        matchesPrepare: prepared.b0Sha256 === sha256Hex(parts.b0) && prepared.authInfoSha256 === sha256Hex(parts.authInfoBytes) && prepared.pqcSignBytesSha256 === sha256Hex(parts.pqcSignBytes),
        gasLimit: plan.gasLimit, feeCeiling: feeFor(plan.gasLimit, plan.gasPrice) + plan.denom,
      };
      write(report);
      return report;
    } finally {
      zeroSigned(signed);
    }
  }, deps);
}

export async function runSignAndSimulate({ network, readRecord, confirm, write, plan = PLAN, expected = INVOICE_OWNER, deps = {} }) {
  const prepared = await prepareHybridSelfSend({ network, plan, write });
  if ((await confirm(SIGN_CONFIRMATION)) !== SIGN_CONFIRMATION) throw new Error('Not confirmed');
  let record = readParsedRecord(readRecord);

  return withVerifiedAccount(record, { native: expected.native, evm: expected.evm }, async (account, summary) => {
    record = undefined;
    const { live, onChainKey } = await presignChecks(account, summary, network, plan);

    const timeoutHeight = (await latestHeight(network)) + BigInt(SIMULATION_TIMEOUT_BLOCKS);
    const simPlan = { ...plan, timeoutHeight: timeoutHeight.toString() };
    const parts = unsignedHybridParts({ publicKeyHex: onChainKey, plan: simPlan });
    const signed = signPlanned(account, plan, timeoutHeight, deps);
    try {
      if (Buffer.compare(Buffer.from(signed.authInfoBytes), Buffer.from(parts.authInfoBytes)) !== 0) throw new Error('Signed transaction differs from the plan');
      const format = hybridFormatFailures(signed.txRawBytes, { classicalPublicKeyHex: onChainKey, pqcPublicKey: live.pqc.publicKey, plan: simPlan });
      if (format.length) throw new FormatError(format);
      const txHash = sha256Hex(signed.txRawBytes).toUpperCase();
      const result = await simulateSigned(signed.txRawBytes, network);
      const report = {
        mode: 'sign-and-simulate', signed: true, broadcast: false,
        chainId: plan.chainId, accountNumber: live.account.accountNumber, sequence: live.account.sequence, uqorBalance: live.uqor,
        pqcPublicKeySha256: summary.pqcPublicKeySha256, classicalPublicKey: onChainKey,
        formatCheck: 'pass', pqcSignBytesSha256: sha256Hex(parts.pqcSignBytes), simulationTimeoutHeight: timeoutHeight.toString(),
        simulationTxHash: txHash, gasLimit: plan.gasLimit, feeCeiling: feeFor(plan.gasLimit, plan.gasPrice) + plan.denom,
        preparedEstimate: prepared.estimatedGas, simulation: result.outcome,
      };
      if (result.outcome === 'ok') {
        Object.assign(report, { gasUsed: result.gasUsed, exactHybridGas: sdk.exactHybridGas(result.gasUsed), fitsGasLimit: sdk.exactHybridGas(result.gasUsed) <= plan.gasLimit });
        write(report);
        return report;
      }
      write({ ...report, code: result.code, httpStatus: result.httpStatus });
      throw new Error(result.outcome === 'rejected-hybrid' ? 'Simulation rejected the hybrid signature' : result.outcome === 'refused' ? 'Simulation refused by the node' : 'Simulation result unknown');
    } finally {
      zeroSigned(signed);
    }
  }, deps);
}

/** Fixed messages only: never an SDK error, a chain message, or record contents. */
export function failureMessage(error) {
  if (error instanceof CheckError) return 'Check failed: ' + error.failures.filter(f => PREPARE_FAILURES.includes(f)).join('; ');
  if (error instanceof FormatError) return 'Format check failed: ' + error.failures.filter(f => typeof f === 'string' && /^[A-Za-z0-9 _-]+$/.test(f)).join('; ');
  const message = error?.message;
  if (SIGN_FAILURES.includes(message) || SAFE_FAILURES.includes(message)) return message;
  return prepareFailureMessage(error);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--sign-and-simulate' && args[0] !== '--sign-and-verify-local')) throw new Error('Unknown option');
  const local = args[0] === '--sign-and-verify-local';
  const writeReport = report => process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (args.length === 0) {
    await prepareHybridSelfSend({ network: dianaNetwork(), write: writeReport });
    return;
  }
  if (process.platform !== 'win32' || !process.stdin.isTTY || !process.stdout.isTTY || process.execArgv.length || process.env.NODE_OPTIONS) {
    throw new Error('Interactive Windows terminal required');
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  try {
    process.stdout.write((local ? 'Diana hybrid SIGN-AND-VERIFY-LOCAL for ' : 'Diana hybrid SIGN-AND-SIMULATE for ') + INVOICE_OWNER.native + '\n'
      + (local
        ? 'The signed transaction is verified locally. The network is sealed before signing; the signed bytes never leave this process.\n'
        : 'The signed transaction goes to the simulation endpoint only. It is never broadcast.\n')
      + 'Only public values are shown.\n');
    await (local ? runSignAndVerifyLocal : runSignAndSimulate)({
      network: dianaNetwork(),
      readRecord: () => readRecordBytes(RECORD_PATH),
      confirm: async phrase => (await prompt.question('\n*** Type ' + phrase + ' to continue, anything else stops: ')).trim(),
      write: writeReport,
    });
  } finally {
    prompt.close();
  }
}

// Runs only when started directly (`node .\diana-hybrid-sign.mjs`), not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase()) {
  main().catch(error => {
    process.stderr.write('Diana hybrid signer stopped: ' + failureMessage(error) + '. Nothing was broadcast and no file was written.\n');
    process.exitCode = 1;
  });
}
