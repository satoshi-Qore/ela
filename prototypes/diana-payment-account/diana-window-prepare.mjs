// Diana Invoice Owner: PREPARE the deployment EVM window (`MsgOpenEVMWindow`) for DianaPaymentAccount.
// PREPARE ONLY: no key, no recovery record, no vault, no signing code, no broadcast route. It never
// opens or closes a window and never deploys.
//
// It reads the live chain, builds the exact `MsgOpenEVMWindow` (SDK 0.14.0 `openEvmWindowMsg`) for a
// one-transaction, untargeted deployment window, simulates the hybrid Cosmos transaction that would
// carry it with all-zero placeholder signatures, estimates the contract deployment with
// `eth_estimateGas`, derives the window's `maxValue` from the deployment's maximum fee, and predicts the
// deployment nonce and CREATE address.
//
// Units (verified against the chain, see `unitsConsistent`): the EVM denom is uqor with 18-decimal
// extended unit aqor, so 1 QOR = 10^6 uqor = 10^18 wei and 1 uqor = 10^12 wei. `maxValue` is in uqor and
// covers value + gas limit x max fee per gas, converted from wei rounding UP (SDK `weiToUqorCeil`).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { win32 as path } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sdk from '@qorechain/sdk';
import { encodeAbiParameters, getContractAddress, keccak256, toHex } from 'viem';
import {
  CheckError, PLAN as SELF_SEND_PLAN, PREPARE_FAILURES, classicalKeyHex, feeFor, fetchLiveState, placeholderSimulationTx,
  prepareFailures, simulate, unsignedHybridParts,
} from './diana-hybrid-prepare.mjs';

const WEI_PER_UQOR = 10n ** 12n;
const GWEI = 10n ** 9n;
export const ARTIFACT_PATH = fileURLToPath(new URL('./out/DianaPaymentAccount.sol/DianaPaymentAccount.json', import.meta.url));
export const SOURCE_PATH = fileURLToPath(new URL('./src/DianaPaymentAccount.sol', import.meta.url));

/**
 * The deployment window plan. The account and its keys are the Invoice Owner's (7C-21: Deployer =
 * Executor = Invoice Owner). The sequence is the one expected after the 7C-18 self-send; it is
 * re-read and must match.
 */
export const WINDOW_PLAN = Object.freeze({
  ...SELF_SEND_PLAN,
  sequence: '2',
  // About 9.5 minutes at Diana's ~1.42 s blocks: room to read the nonce, sign and send one deployment
  // after the window opens, short enough that an unused window expires soon. Checked against the
  // live block time.
  windowBlocks: 400,
  minWindowBlocks: 100,
  maxWindowBlocks: 1000,
  maxTxs: 1,
  allowedTargets: Object.freeze([]),
  nativeOnly: false,
  // The later deployment transaction: gas limit = estimate x 1.25 rounded up to 10,000; fee cap
  // 150 gwei (1.5x the 100 gwei base fee, above eth_gasPrice); priority fee 12.5 gwei.
  deployGasMultiplier: 1.25,
  maxFeePerGasWei: 150n * GWEI,
  maxPriorityFeePerGasWei: 25n * GWEI / 2n,
  deployValueWei: 0n, // the constructor is not payable
});

export const WINDOW_FAILURES = Object.freeze([
  'EVM nonce is not the account sequence',
  'A window is already live',
  'Invalid window parameters',
  'Window too short or too long for the live block time',
  'Fee cap below the live gas price',
  'Artifact does not match the contract source',
  'Deployment estimate failed',
  'Window cannot cover the deployment',
]);
const OTHER_FAILURES = Object.freeze(['Network request blocked', 'Chain state unreadable', 'Simulation failed', 'Estimated gas exceeds the safe gas limit']);

export class WindowCheckError extends Error {
  constructor(failures) { super('Window check failed'); this.failures = failures; }
}

const EVM_READ_METHODS = new Set(['eth_chainId', 'eth_getTransactionCount', 'eth_getBalance', 'eth_gasPrice', 'eth_estimateGas']);

/** HTTPS to the two Diana hosts only: GET on REST, the simulation route, and read-only EVM methods. No broadcast route exists. */
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
      try { allowed = EVM_READ_METHODS.has(JSON.parse(init.body).method); } catch { allowed = false; }
    }
    if (!allowed) throw new Error('Network request blocked');
    return fetchImpl(target.href, { ...init, redirect: 'error', credentials: 'omit' });
  };
}

export function dianaNetwork(fetchImpl = globalThis.fetch) {
  const { rest, evmRpc } = sdk.NETWORKS.testnet.endpoints;
  return { rest, evmRpc, fetch: guardedFetch({ rest, evmRpc }, fetchImpl) };
}

async function evmCall(network, method, params) {
  let body;
  try {
    body = await (await network.fetch(network.evmRpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json();
  } catch (error) {
    if (error?.message === 'Network request blocked') throw error;
    throw new Error('Chain state unreadable');
  }
  if (body?.error) return { error: true };
  return { result: body?.result };
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

/** Live EVM-side facts: nonce, balance, gas price, base fee, window, block time, EVM denom. */
export async function fetchEvmState(plan, network) {
  const nonce = await evmCall(network, 'eth_getTransactionCount', [plan.evm, 'latest']);
  const balance = await evmCall(network, 'eth_getBalance', [plan.evm, 'latest']);
  const gasPrice = await evmCall(network, 'eth_gasPrice', []);
  const feemarket = await getJson(network, '/cosmos/evm/feemarket/v1/params');
  const vm = await getJson(network, '/cosmos/evm/vm/v1/params');
  const window = await getJson(network, '/qorechain/pqc/v1/evm_window/' + plan.native);
  const latest = await getJson(network, '/cosmos/base/tendermint/v1beta1/blocks/latest');
  const height = BigInt(latest.body?.block?.header?.height ?? 0);
  const earlier = height > 1000n ? await getJson(network, '/cosmos/base/tendermint/v1beta1/blocks/' + (height - 1000n)) : undefined;
  if ([nonce, balance, gasPrice].some(r => r.error || typeof r.result !== 'string') || height <= 0n || !earlier) throw new Error('Chain state unreadable');
  const t1 = Date.parse(latest.body.block.header.time);
  const t0 = Date.parse(earlier.body?.block?.header?.time);
  const baseFee = String(feemarket.body?.params?.base_fee ?? '');
  return {
    nonce: BigInt(nonce.result).toString(),
    balanceWei: BigInt(balance.result),
    gasPriceWei: BigInt(gasPrice.result),
    // feemarket base_fee is in the 18-decimal unit per gas, i.e. "0.1" uqor = 100 gwei.
    baseFeeWei: /^\d+(\.\d+)?$/.test(baseFee) ? decimalToWei(baseFee) : undefined,
    evmDenom: vm.body?.params?.evm_denom,
    extendedDenom: vm.body?.params?.extended_denom_options?.extended_denom,
    window: window.body,
    height,
    secondsPerBlock: Number.isFinite(t1 - t0) && t1 > t0 ? (t1 - t0) / 1000 / 1000 : undefined,
  };
}

function decimalToWei(dec) {
  // A decimal amount of uqor per gas to wei per gas (x 10^12).
  const [whole, fraction = ''] = dec.split('.');
  return BigInt(whole + fraction.padEnd(12, '0').slice(0, 12)) + (fraction.length > 12 && /[1-9]/.test(fraction.slice(12)) ? 1n : 0n);
}

export const weiToUqorCeil = wei => (wei + WEI_PER_UQOR - 1n) / WEI_PER_UQOR;

/** The deployment artifact, refused unless it was compiled from the source in this folder. */
export function loadArtifact({ artifactPath = ARTIFACT_PATH, sourcePath = SOURCE_PATH, read = readFileSync } = {}) {
  let artifact;
  let source;
  try {
    artifact = JSON.parse(read(artifactPath, 'utf8'));
    source = read(sourcePath);
  } catch {
    throw new WindowCheckError(['Artifact does not match the contract source']);
  }
  const recorded = artifact?.metadata?.sources?.['src/DianaPaymentAccount.sol']?.keccak256;
  // The compiler hashed the file as it was on disk; accept that, or the same file with LF line endings.
  const raw = Buffer.from(source);
  const normalized = Buffer.from(raw.toString('utf8').replace(/\r\n/g, '\n'));
  const matches = recorded === keccak256(toHex(raw)) || recorded === keccak256(toHex(normalized));
  if (typeof artifact?.bytecode?.object !== 'string' || !/^0x[0-9a-f]+$/i.test(artifact.bytecode.object) || !matches) {
    throw new WindowCheckError(['Artifact does not match the contract source']);
  }
  return { bytecode: artifact.bytecode.object, compiler: artifact.metadata.compiler?.version, evmVersion: artifact.metadata.settings?.evmVersion, sourceKeccak: recorded };
}

/**
 * Placeholder constructor arguments for the gas estimate only. Executor and issuer are the planned
 * account; the recipient is not chosen yet, so a placeholder with all non-zero bytes (the costlier
 * calldata) stands in. The real values are fixed in the deployment step.
 */
export function placeholderConstructorArgs(plan, nowSeconds) {
  return encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'address' }],
    [plan.evm, '0x3333333333333333333333333333333333333333', 10n ** 12n, 3n * 10n ** 12n, 3n, BigInt(nowSeconds), BigInt(nowSeconds + 7 * 86400), plan.evm],
  );
}

/** The window's own parameter rules for a deployment window; empty when the plan is valid. */
export function windowParameterFailures(plan, live) {
  const failures = [];
  const integer = n => Number.isSafeInteger(n);
  if (plan.maxTxs !== 1 || plan.allowedTargets.length !== 0 || plan.nativeOnly !== false
    || !integer(plan.windowBlocks) || plan.windowBlocks <= 0 || BigInt(plan.windowBlocks) > sdk.MAX_EVM_WINDOW_BLOCKS
    || typeof plan.maxValueUqor !== 'bigint' || plan.maxValueUqor <= 0n) {
    failures.push('Invalid window parameters');
  }
  if (plan.windowBlocks < plan.minWindowBlocks || plan.windowBlocks > plan.maxWindowBlocks || !(live?.secondsPerBlock > 0)) {
    failures.push('Window too short or too long for the live block time');
  }
  return failures;
}

/** PREPARE: read, check, build, simulate with placeholders, estimate the deployment, and report. */
export async function prepareDeploymentWindow({ network, plan = WINDOW_PLAN, write, artifact = loadArtifact(), now = () => Math.floor(Date.now() / 1000) }) {
  // Cosmos side: chain, account, sequence, classical key, PQC key, sign bytes, gas price.
  const state = await fetchLiveState(plan.native, network);
  const evm = await fetchEvmState(plan, network);

  // Deployment estimate: the artifact's creation code with placeholder constructor arguments.
  const initcode = artifact.bytecode + placeholderConstructorArgs(plan, now()).slice(2);
  const estimate = await evmCall(network, 'eth_estimateGas', [{ from: plan.evm, data: initcode, value: '0x0' }, 'latest']);
  if (estimate.error || typeof estimate.result !== 'string') throw new WindowCheckError(['Deployment estimate failed']);
  const deployGasEstimate = BigInt(estimate.result);
  const deployGasLimit = ((BigInt(Math.ceil(Number(deployGasEstimate) * plan.deployGasMultiplier)) + 9999n) / 10000n) * 10000n;
  const deployMaxCostWei = plan.deployValueWei + deployGasLimit * plan.maxFeePerGasWei;
  const maxValueUqor = weiToUqorCeil(deployMaxCostWei);
  const windowPlan = { ...plan, maxValueUqor };

  // The Cosmos fee of the window transaction plus everything the window may spend must be on hand.
  const failures = prepareFailures(state, { ...plan, amount: maxValueUqor.toString() });
  if (evm.nonce !== state.account?.sequence) failures.push('EVM nonce is not the account sequence');
  if (evm.window?.live === true) failures.push('A window is already live');
  failures.push(...windowParameterFailures(windowPlan, evm));
  if (plan.maxFeePerGasWei < evm.gasPriceWei || evm.baseFeeWei === undefined || plan.maxFeePerGasWei < evm.baseFeeWei) failures.push('Fee cap below the live gas price');
  if (deployMaxCostWei > maxValueUqor * WEI_PER_UQOR) failures.push('Window cannot cover the deployment');
  const blocking = failures.filter(f => PREPARE_FAILURES.includes(f));
  if (blocking.length) throw new CheckError(blocking);
  if (failures.length) throw new WindowCheckError(failures);

  // The exact message, built and bounds-checked by the SDK.
  let message;
  try {
    message = sdk.openEvmWindowMsg({ sender: plan.native, blocks: plan.windowBlocks, maxTxs: plan.maxTxs, maxValue: maxValueUqor, nativeOnly: plan.nativeOnly, allowedTargets: [...plan.allowedTargets] });
  } catch {
    throw new WindowCheckError(['Invalid window parameters']);
  }

  // The hybrid Cosmos transaction that would carry it, simulated with all-zero placeholder signatures.
  const publicKeyHex = classicalKeyHex(state, plan);
  const parts = unsignedHybridParts({ publicKeyHex, plan, message });
  const simulatedGas = await simulate(placeholderSimulationTx(parts, plan), network);
  const estimatedGas = simulatedGas + plan.hybridVerifyGas;
  const gasFits = Math.ceil(estimatedGas * plan.gasHeadroom) <= plan.gasLimit;

  // Nonces: the Cosmos sequence is the EVM nonce. Opening the window is one Cosmos transaction, so
  // the deployment is expected at sequence + 1, which fixes the CREATE address.
  const deployNonce = BigInt(state.account.sequence) + 1n;
  const predictedAddress = getContractAddress({ from: plan.evm, nonce: deployNonce });
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const report = {
    mode: 'prepare', signed: false, broadcast: false, windowOpened: false, deployed: false,
    chainId: plan.chainId, evmChainId: state.evmChainId, account: plan.native, evmAccount: plan.evm,
    accountNumber: state.account.accountNumber, sequence: state.account.sequence, evmNonce: evm.nonce,
    uqorBalance: state.uqor, unitsConsistent: evm.balanceWei === BigInt(state.uqor) * WEI_PER_UQOR && evm.evmDenom === 'uqor',
    pqcAlgorithmId: state.pqc.algorithmId, pqcPublicKeySha256: sha(state.pqc.publicKey), signBytesVersion: state.signBytesVersion,
    existingWindow: { found: evm.window?.found === true, live: evm.window?.live === true },
    window: {
      typeUrl: message.typeUrl, sender: message.value.sender, blocks: message.value.blocks, maxTxs: message.value.maxTxs,
      maxValueUqor: message.value.maxValue, maxValueQor: (Number(maxValueUqor) / 1e6).toFixed(6), nativeOnly: message.value.nativeOnly,
      allowedTargets: message.value.allowedTargets, secondsPerBlock: Number(evm.secondsPerBlock.toFixed(3)),
      approximateMinutes: Number((plan.windowBlocks * evm.secondsPerBlock / 60).toFixed(1)),
    },
    cosmosTx: {
      b0Sha256: sha(parts.b0), authInfoSha256: sha(parts.authInfoBytes), pqcSignBytesSha256: sha(parts.pqcSignBytes),
      gasLimit: plan.gasLimit, gasPrice: plan.gasPrice, feeCeiling: feeFor(plan.gasLimit, plan.gasPrice) + plan.denom,
      simulatedGasWithPlaceholders: simulatedGas, estimatedGas, estimateIsExact: false, gasFitsWithHeadroom: gasFits,
    },
    deployment: {
      artifactCompiler: artifact.compiler, artifactEvmVersion: artifact.evmVersion, sourceKeccak: artifact.sourceKeccak,
      gasEstimate: deployGasEstimate.toString(), gasEstimateNote: 'eth_estimateGas with placeholder constructor arguments; not a measured deployment.',
      gasLimit: deployGasLimit.toString(), maxFeePerGasWei: plan.maxFeePerGasWei.toString(), maxPriorityFeePerGasWei: plan.maxPriorityFeePerGasWei.toString(),
      liveGasPriceWei: evm.gasPriceWei.toString(), liveBaseFeeWei: evm.baseFeeWei.toString(), valueWei: plan.deployValueWei.toString(),
      maxCostWei: deployMaxCostWei.toString(), maxCostUqor: maxValueUqor.toString(),
      expectedNonce: deployNonce.toString(), predictedContractAddress: predictedAddress,
    },
    assumptions: [
      'The window transaction is included (success or failure) and no other transaction is sent from this account before the deployment, so the deployment uses nonce sequence + 1.',
      'The deployment is the first and only transaction through the window.',
      'Real constructor arguments (recipient, limits, dates) change the deployment gas slightly; the 1.25x gas limit covers that.',
      'The real hybrid-signed window transaction is not simulated here; its gas is an estimate.',
    ],
  };
  if (!gasFits) {
    write(report);
    throw new Error('Estimated gas exceeds the safe gas limit');
  }
  write(report);
  return report;
}

export function failureMessage(error) {
  if (error instanceof CheckError) return 'Check failed: ' + error.failures.filter(f => PREPARE_FAILURES.includes(f)).join('; ');
  if (error instanceof WindowCheckError) return 'Window check failed: ' + error.failures.filter(f => WINDOW_FAILURES.includes(f)).join('; ');
  return OTHER_FAILURES.includes(error?.message) ? error.message : 'Prepare stopped';
}

// Runs only when started directly (`node .\diana-window-prepare.mjs`), not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase()) {
  Promise.resolve()
    .then(() => prepareDeploymentWindow({ network: dianaNetwork(), write: report => process.stdout.write(JSON.stringify(report, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n') }))
    .catch(error => {
      process.stderr.write('Diana window prepare stopped: ' + failureMessage(error) + '. Nothing was signed or sent.\n');
      process.exitCode = 1;
    });
}
