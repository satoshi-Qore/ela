// Diana Invoice Owner: the first real hybrid-signed (ECDSA + ML-DSA-87, v2) transaction, a 1 uqor
// self-send. It reuses the PREPARE plan, checks and format verifier (diana-hybrid-prepare.mjs) and
// the signing steps (diana-hybrid-sign.mjs); no signing logic is written here a second time.
//
// `node .\diana-hybrid-broadcast.mjs` (default): PREPARE. Read-only; no vault, record or key; no
// signature; no broadcast route is ever opened.
//
// `node .\diana-hybrid-broadcast.mjs --broadcast`: in the user's own interactive Windows terminal:
//   1. PREPARE runs and prints the plan.
//   2. First typed confirmation. Only then is the recovery record read and the account checked.
//   3. The chain is re-read right before signing. The transaction is signed ONCE, with a timeout
//      height BROADCAST_TIMEOUT_BLOCKS ahead, so it can never be included after that height.
//   4. The signed auth info must match the plan byte for byte and `hybridFormatFailures` must pass
//      (both signatures verified locally with the on-chain public keys).
//   5. Those exact bytes are simulated. A failed simulation, or `exactHybridGas` above the gas limit,
//      stops here.
//   6. The transaction hash and the simulation result are printed; then a second, different typed
//      confirmation.
//   7. The chain is re-read again (sequence, keys, balance, and the timeout height still ahead).
//   8. The SAME bytes, checked against the hash shown, are broadcast once (sync mode). The network
//      guard lets the broadcast route through at most once. A lost or unreadable answer is UNKNOWN:
//      never retried.
//
// Only public values are printed. The mnemonic, password, private key, PQC secret key, record
// contents and signed transaction bytes are never printed, logged or written.
import { createHash } from 'node:crypto';
import { win32 as path } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import * as sdk from '@qorechain/sdk';
import { withVerifiedAccount } from './diana-canonical-pqc.mjs';
import {
  CheckError, PLAN, feeFor, fetchLiveState, hybridFormatFailures, prepareFailures, prepareHybridSelfSend, unsignedHybridParts,
} from './diana-hybrid-prepare.mjs';
import {
  FormatError, failureMessage as signFailureMessage, latestHeight, presignChecks, readParsedRecord, signPlanned, simulateSigned, zeroSigned,
} from './diana-hybrid-sign.mjs';
import { guardedFetch } from './diana-register-pqc.mjs';
import { INVOICE_OWNER, RECORD_PATH, readRecordBytes } from './diana-verify-recovery.mjs';

export const SIGN_CONFIRMATION = 'SIGN HYBRID SELF-SEND FOR ' + PLAN.accountNumber;
export const BROADCAST_CONFIRMATION = 'BROADCAST HYBRID SELF-SEND TO ' + PLAN.chainId.toUpperCase();
/** The signed transaction can be included only up to latest height + this (about 7 minutes on Diana). */
export const BROADCAST_TIMEOUT_BLOCKS = 300;
/** Broadcast only while at least this many blocks are left before the timeout height. */
export const MIN_BLOCKS_LEFT = 20;
const BROADCAST_TIMEOUT_MS = 60000;

export const BROADCAST_FAILURES = Object.freeze([
  'Simulation did not succeed',
  'Simulated gas exceeds the gas limit',
  'Timeout height too close',
  'Signed bytes changed before broadcast',
  'Broadcast refused by the node',
  'Broadcast result unknown',
  'Broadcast hash mismatch',
]);

const sha256Hex = bytes => createHash('sha256').update(bytes).digest('hex');

/** Diana network for this tool: reads, simulation and eth_chainId; the broadcast route only while opened, and only once. */
export function dianaBroadcastNetwork(fetchImpl = globalThis.fetch) {
  const { rest, evmRpc } = sdk.NETWORKS.testnet.endpoints;
  const allowBroadcast = { value: false };
  return { rest, evmRpc, allowBroadcast, fetch: guardedFetch({ rest, evmRpc }, { allowBroadcast: () => allowBroadcast.value, fetchImpl }) };
}

/** One broadcast attempt, never retried. Returns ok / refused (with public code) / unknown. */
async function broadcastOnce(txBytes, network) {
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

/** What to check afterwards, read-only, to settle the result. */
function verificationPlan(txHash, timeoutHeight, plan) {
  return {
    tx: 'GET /cosmos/tx/v1beta1/txs/' + txHash + ' (expect code 0)',
    account: 'GET /cosmos/auth/v1beta1/accounts/' + plan.native + ' (expect sequence ' + (BigInt(plan.sequence) + 1n) + ')',
    balance: 'GET /cosmos/bank/v1beta1/balances/' + plan.native + '/by_denom?denom=' + plan.denom + ' (expect a drop of the fee, at most ' + feeFor(plan.gasLimit, plan.gasPrice) + plan.denom + ')',
    lastIncludableHeight: timeoutHeight.toString(),
  };
}

/**
 * The full flow with every outside effect injected: `network` (with `allowBroadcast`), `readRecord()`
 * (called only after the first confirmation), `confirm(phrase)`, `write(report)`.
 */
export async function runHybridBroadcast({ network, readRecord, confirm, write, plan = PLAN, expected = INVOICE_OWNER, deps = {} }) {
  const prepared = await prepareHybridSelfSend({ network, plan, write });
  if ((await confirm(SIGN_CONFIRMATION)) !== SIGN_CONFIRMATION) throw new Error('Not confirmed');
  let record = readParsedRecord(readRecord);

  return withVerifiedAccount(record, { native: expected.native, evm: expected.evm }, async (account, summary) => {
    record = undefined;
    const { live, onChainKey } = await presignChecks(account, summary, network, plan);
    const timeoutHeight = (await latestHeight(network)) + BigInt(BROADCAST_TIMEOUT_BLOCKS);
    const txPlan = { ...plan, timeoutHeight: timeoutHeight.toString() };
    const parts = unsignedHybridParts({ publicKeyHex: onChainKey, plan: txPlan });
    const signed = signPlanned(account, plan, timeoutHeight, deps);
    try {
      if (Buffer.compare(Buffer.from(signed.authInfoBytes), Buffer.from(parts.authInfoBytes)) !== 0) throw new Error('Signed transaction differs from the plan');
      const format = hybridFormatFailures(signed.txRawBytes, { classicalPublicKeyHex: onChainKey, pqcPublicKey: live.pqc.publicKey, plan: txPlan });
      if (format.length) throw new FormatError(format);
      const txHash = sha256Hex(signed.txRawBytes).toUpperCase();

      // The exact bytes that would be broadcast are the ones simulated.
      const simulation = await simulateSigned(signed.txRawBytes, network);
      const report = {
        mode: 'broadcast', signed: true, broadcast: false,
        chainId: plan.chainId, from: plan.native, to: plan.native, amount: plan.amount + plan.denom,
        accountNumber: live.account.accountNumber, sequence: live.account.sequence, uqorBalance: live.uqor,
        classicalPublicKey: onChainKey, pqcPublicKeySha256: summary.pqcPublicKeySha256, formatCheck: 'pass',
        gasLimit: plan.gasLimit, gasPrice: plan.gasPrice, feeCeiling: feeFor(plan.gasLimit, plan.gasPrice) + plan.denom,
        preparedEstimate: prepared.estimatedGas, simulation: simulation.outcome, timeoutHeight: timeoutHeight.toString(), txHash,
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
      write({ ...report, warning: 'The next step broadcasts this transaction to ' + plan.chainId + ' and spends up to ' + report.feeCeiling + '. It cannot be undone.' });
      if ((await confirm(BROADCAST_CONFIRMATION)) !== BROADCAST_CONFIRMATION) throw new Error('Not confirmed');

      // Pre-broadcast: re-read the chain after the last confirmation.
      const now = await fetchLiveState(plan.native, network);
      const failures = prepareFailures(now, plan);
      if (failures.length) throw new CheckError(failures);
      if ((await latestHeight(network)) + BigInt(MIN_BLOCKS_LEFT) > timeoutHeight) throw new Error('Timeout height too close');
      if (sha256Hex(signed.txRawBytes).toUpperCase() !== txHash) throw new Error('Signed bytes changed before broadcast');

      const result = await broadcastOnce(signed.txRawBytes, network);
      const after = { ...report, broadcast: result.outcome, verify: verificationPlan(txHash, timeoutHeight, plan) };
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
      write({ ...after, code: 0 });
      return { ...after, code: 0 };
    } finally {
      zeroSigned(signed);
    }
  }, deps);
}

export function failureMessage(error) {
  return BROADCAST_FAILURES.includes(error?.message) ? error.message : signFailureMessage(error);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--broadcast')) throw new Error('Unknown option');
  const writeReport = report => process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (args.length === 0) {
    // PREPARE: the network object has a broadcast gate, but nothing in this path ever opens it.
    await prepareHybridSelfSend({ network: dianaBroadcastNetwork(), write: writeReport });
    return;
  }
  if (process.platform !== 'win32' || !process.stdin.isTTY || !process.stdout.isTTY || process.execArgv.length || process.env.NODE_OPTIONS) {
    throw new Error('Interactive Windows terminal required');
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  try {
    process.stdout.write('Diana hybrid BROADCAST for ' + INVOICE_OWNER.native + '\n'
      + 'Two typed confirmations: one before signing, one before the single broadcast.\n'
      + 'Only public values are shown.\n');
    await runHybridBroadcast({
      network: dianaBroadcastNetwork(),
      readRecord: () => readRecordBytes(RECORD_PATH),
      confirm: async phrase => (await prompt.question('\n*** Type ' + phrase + ' to continue, anything else stops: ')).trim(),
      write: writeReport,
    });
  } finally {
    prompt.close();
  }
}

// Runs only when started directly (`node .\diana-hybrid-broadcast.mjs`), not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase()) {
  main().catch(error => {
    process.stderr.write('Diana hybrid broadcast stopped: ' + failureMessage(error) + '. No file was written.\n');
    process.exitCode = 1;
  });
}
