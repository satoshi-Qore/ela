# DianaPaymentAccount deployment: EVM transaction preparation (7C-24)

This step adds the tool only. Nothing was signed or broadcast, no window was opened, and nothing was deployed. The real deployment is **blocked in code**: `LIVE_CONSTRUCTOR_PARAMS` is `null` because the recipient has not been chosen. Every option other than PREPARE stops with `Constructor parameters not chosen` before it reads anything.

## Two signing formats, kept apart

| | Window (7C-23, `diana-window-open.mjs`) | Deployment (`diana-deploy.mjs`) |
|---|---|---|
| Lane | Cosmos | EVM |
| Encoding | protobuf `TxRaw` (body, auth info, signatures) | EIP-1559 type 2: `0x02 ‖ rlp([chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gas, to, value, data, accessList, v, r, s])` |
| Classical signature | secp256k1 over `keccak256(SignDoc)`, `eth_secp256k1` key | secp256k1 over `keccak256(0x02 ‖ rlp(fields))` |
| Post-quantum | ML-DSA-87 over the v2 hybrid sign bytes, in `extension_options` | none in the transaction. Diana admits it only from an account with a registered ML-DSA-87 key and a live window. |
| Chain ID | `qorechain-diana` | `9800` |
| Route | `POST /cosmos/tx/v1beta1/txs` | `eth_sendRawTransaction` |

The deployment tool has no Cosmos signing code and no Cosmos simulation or broadcast route. Its guard allows only:
- REST GET;
- read-only EVM methods;
- `eth_call` for a contract creation only;
- `eth_sendRawTransaction` once, and only while explicitly opened.

Tests check that each verifier refuses the other format.

## Phases

1. **PREPARE** (`prepareDeployment`, the default). Read-only. It reports each condition as a named check, `readyToSign`, and the list of blockers:

   | Check | Condition |
   |---|---|
   | `chain` | `qorechain-diana`, EVM chain ID 9800 |
   | `deployer` | Invoice Owner account 16046, with the on-chain `eth_secp256k1` key of `0x6a5d…C794` |
   | `pqc` | Registered ML-DSA-87 key `a3b2c32d…` |
   | `window-live` | Found and live, with at least 30 blocks left |
   | `window-unused` | 0 transactions and 0 value used |
   | `window-untargeted` | `allowedTargets` empty, `nativeOnly` false |
   | `window-bounds` | `maxTxs` 1, `maxValue` ≤ 300,000 uqor, remaining value ≥ the deployment's window cost |
   | `nonce` | Read live: `latest` = `pending` = Cosmos sequence |
   | `gas` | Estimate succeeds; gas limit = estimate × 1.25, rounded up to 10,000, at most 1,710,000 and the chain's EVM cap |
   | `fee-cap` | 150 gwei ≥ live gas price and base fee; priority fee 12.5 gwei |
   | `balance` | Covers gas limit × fee cap + value |
   | `units` | EVM denom uqor; 1 uqor = 10¹² wei |
   | `artifact` | Compiled from `src/DianaPaymentAccount.sol` (source hash check) |
   | `address-free` | No code at the predicted CREATE address |
   | `constructor` | The live checklist below passes |

2. **BUILD** (`deploymentIntent`). Builds a frozen EIP-1559 creation, but only from a PREPARE with no blockers. Test parameters are refused.
3. **SIGN** (`signDeployment`). One `signTransaction` call. It runs after a typed confirmation bound to the nonce, gas and predicted address. After that confirmation the record is read, the record key is checked against the on-chain key, and PREPARE runs again; any change stops the tool.
4. **CHECK** (`deploymentFormatFailures`, `dryRunCreation`). The signed bytes must decode to exactly the intent:
   - type 2 on chain 9800, no `to`, value 0;
   - the planned nonce, gas and fees;
   - the planned initcode;
   - no access or authorization list;
   - signer recovered as the deployer.

   An `eth_call` of the creation must then return the expected runtime code.
5. **BROADCAST** (`broadcastOnce`). It runs after a second confirmation bound to the hash, and after another PREPARE that must match. `eth_sendRawTransaction` is sent once and never retried. A refusal reports only its code and window category (`no-window`, `exhausted`, …).
6. **VERIFY** (`verifyDeployment`). Read-only:
   - the transaction is type 2, from the deployer, a creation, with the same nonce, gas and input;
   - receipt status 1;
   - `contractAddress` is the predicted address;
   - `eth_getCode` equals the compiled runtime code with the constructor values written into its immutable slots;
   - the nonce has advanced by one;
   - the window records one use.

## Address and code verification

- **Predicted address.** The address is `CREATE(sender, nonce) = keccak256(rlp([sender, nonce]))[12:]`. Tests check it against a hand-built RLP for several nonces.
- **Nonce.** The nonce is always read live. Today it is 2. Opening the window takes nonce 2, so the deployment is expected at nonce **3**, giving **`0x8a278Cf5B0D34cF844cF19C74116e9DdfB7Aba9d`**. This matches 7C-22.
- **Immutables.** The runtime code of `DianaPaymentAccount` carries its eight immutables. The tool takes the artifact's `immutableReferences` and maps them to names by declaration order. It confirms that mapping against their uses in the source: `recipient` 4, `invoiceIssuer` 3, the others 2. It then writes each constructor value into its slots. A different recipient, or any changed byte, fails verification.

## Live constructor checklist (`constructorChecklist`)

Each item must pass before a live deployment can be signed. `LIVE_CONSTRUCTOR_PARAMS` stays `null` until then.

| # | Item | Requirement |
|---|---|---|
| 1 | `chosen` | A parameter set chosen for the live deployment, not the test set |
| 2 | `reviewed` | Every value reviewed and approved by the Invoice Owner (`reviewed: true`) |
| 3 | `executor` | `0x6a5d4D7B3357df968b2A3004071eCe98f015C794` (the Invoice Owner) |
| 4 | `invoiceIssuer` | The same Invoice Owner address (7C-21), which holds the registered ML-DSA-87 key the contract checks |
| 5 | `recipient-address` | **Not chosen yet.** Must be EIP-55 checksummed, not zero, not a precompile (≤ `0xffff`), not the placeholder `0x3333…3333` |
| 6 | `recipient-distinct` | Not the executor, the issuer, or the contract itself |
| 7 | `recipient-code` | No contract code on Diana (a plain account that can receive native QOR) |
| 8 | `amounts` | `0 < maxPerPayment ≤ spendingLimit ≤ 1 QOR` (10¹⁸ wei); both whole uqor (multiples of 10¹² wei). Amounts are **wei**, as the contract compares them with `address(this).balance`. |
| 9 | `maxPayments` | 1 to 100 |
| 10 | `dates` | `startsAt < endsAt`; `endsAt` at least 1 day ahead; at most 1 year long; starts within 30 days (Unix seconds) |

These ceilings are review guards, not chosen values. The test set (`testConstructorParams`) uses a placeholder recipient, 1 uqor per payment, 3 uqor in total, 3 payments and a 7-day period. It is used only for PREPARE's gas estimate and for the tests. Real values change the gas a little; the 1.25× limit absorbs that, and PREPARE re-estimates.

## Read-only PREPARE result (17 November 2026)

`node .\diana-deploy.mjs` against Diana, with the test constructor set:

- **Passed:** chain (9800), deployer (16046), PQC key `a3b2c32d…`, nonce (latest = pending = sequence = 2), gas, fee cap, balance, units, artifact and free address.
  - Gas estimate 1,365,419, so the gas limit is 1,710,000.
  - Fee cap 150 gwei, against a gas price of 112.5 gwei and a base fee of 100 gwei.
  - Balance 99,857,500 uqor.
- **Window cost:** 256,500 uqor, equal to the 7C-22 window `maxValue`.
- **Blockers:** `window-live`, `window-unused`, `window-untargeted` and `window-bounds` (no window exists), and `constructor` (test set: `chosen`, `reviewed`, `recipient-address`).
- **Address:** with the window opened first, nonce 3 gives `0x8a278Cf5B0D34cF844cF19C74116e9DdfB7Aba9d`.
- **Hashes:** initcode keccak (test arguments) `0x91b075f1…`; artifact source keccak `0x8e31d4f8…`.

## Remaining blockers for the live deployment

1. **Recipient and the other constructor values** are not chosen or reviewed. Fill in `LIVE_CONSTRUCTOR_PARAMS` and pass the checklist in a reviewed change.
2. **The deployment window** is not open. It needs the 7C-23 `--broadcast` run, its `--verify`, and its own approval.
3. **The CLI broadcast path is disabled** while `LIVE_CONSTRUCTOR_PARAMS` is `null`. Enabling it should add the same interactive-terminal check as 7C-23.
4. **Not verified on chain:**
   - the real deployment gas with the real arguments;
   - that Diana's `eth_call` for a creation returns the runtime code exactly as a standard EVM does (the dry run depends on it);
   - the window's `used_value` accounting after an EVM transaction.

## 7I-2 continuation — 20 November 2026

See [the current deployment package, decision table and pre/post checklist](../../docs/DIANA-DEPLOY-7I2.md). The null live-parameter guard remains. Default PREPARE no longer substitutes test arguments; no real gas/runtime pin is claimed while policy is missing. The existing CLI dispatch is complete behind null/TTY/approval guards; future broadcast saves a separate public PREPARE JSON with --prepare-report, and read-only VERIFY consumes that same file. Canonical compiler/bytecode/immutable pins and receipt/fee/hash validation are enforced. Earlier dated results above are retained.

## 7I-3 approval update

The fixed recipient, roles, amounts, count and seven-day duration are now approved in the single trusted [policy configuration](approved-payment-policy.mjs). Earlier pending-policy statements above are historical. Only exact dates remain pending as policy inputs; transaction execution requires separate authority and the live null guard remains. See [7I-3](../../docs/DIANA-POLICY-7I3.md).

### Current one-hour competition policy (supersedes seven-day approval)

The latest explicit user decision replaces the approved duration with 3600 seconds and sets the start rule to 900 seconds after planned deployment. Exact timestamps remain null and need explicit approval. For this matching policy only, the CLI requires a future start, exactly 3600 seconds duration, and at least 3600 seconds remaining instead of the generic one-day guard. Generic policies and historical seven-day fixtures retain their previous limits. The contract is unchanged. See [current policy report](../../docs/DIANA-POLICY-ONE-HOUR.md).
