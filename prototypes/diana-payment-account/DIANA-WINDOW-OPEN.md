# Diana deployment window: signing and broadcast path (7C-23)

This step adds the tool only. Nothing has been signed or broadcast, no window has been opened, and nothing has been deployed. Running `--broadcast` for real is a later step and needs its own approval.

`diana-window-open.mjs` signs and broadcasts the `MsgOpenEVMWindow` that `diana-window-prepare.mjs` (7C-22) prepares. It is a separate path from the 1 uqor self-send. The self-send files (`diana-hybrid-prepare.mjs`, `diana-hybrid-sign.mjs`, `diana-hybrid-broadcast.mjs`) and their checks are unchanged. The two verifiers refuse each other's transactions, and a test checks this.

## Modes

| Command | What it does | Key | Network |
|---|---|---|---|
| `node .\diana-window-open.mjs` | PREPARE only (same output as 7C-22) | none | 7C-22 guard: reads, simulation, read-only EVM methods. No broadcast route. |
| `--sign-and-verify-local` | Signs the window and verifies it locally | recovery record, after a typed confirmation | Sealed before signing; the signed bytes never leave the process. |
| `--broadcast` | Builds, signs, simulates and broadcasts once | recovery record, after the first confirmation | Broadcast route opened for one request, after the second confirmation. |
| `--verify <TXHASH>` | Post-broadcast verification | none | Reads only. |

`--sign-and-verify-local` and `--broadcast` need the user's own interactive Windows terminal. Redirected input, `NODE_OPTIONS` or extra Node flags are refused before the vault is touched. Every other option is refused.

## Phases, kept apart

1. **BUILD** (`windowIntent`). The PREPARE report becomes a frozen intent. It is refused unless it is exactly the plan:
   - type `/qorechain.pqc.v1.MsgOpenEVMWindow`, sender the Invoice Owner;
   - 400 blocks, 1 transaction;
   - no `allowedTargets`, `nativeOnly` false, no validator, staking or IBC scope;
   - chain ID, account number, sequence, EVM nonce, PQC key and v2 sign bytes as expected;
   - no live window, consistent units, and gas within the limit with headroom.
2. **Signing limits** (`SIGNING_LIMITS`). These are independent of what the chain suggests:
   - window value at most 300,000 uqor (the plan is 256,500), above 0, and covering the deployment's maximum cost;
   - fee at most 52,500 uqor;
   - gas limit at most 350,000.
3. **First confirmation**, bound to the window: `SIGN EVM WINDOW 400 BLOCKS 1 TX 256500 UQOR FOR 16046`. The phrase is built from the intent, so a different window would need a different phrase. The recovery record is read only after this confirmation.
4. **Pre-sign.**
   - The record's keys must be the on-chain classical key and the registered ML-DSA-87 key.
   - The balance must cover the fee plus the whole window value.
   - PREPARE runs again, and its state fingerprint must equal the first one. The fingerprint covers chain IDs, account, sequence, EVM nonce, balance, PQC key, sign-bytes version, existing window, every window field, the unsigned transaction hashes, fee, deployment gas limit, live gas price and base fee, maximum cost, and the predicted nonce and address. Any difference stops the tool with `Chain state changed since PREPARE`.
5. **SIGN** (`signWindow`). There is one signing call. The timeout height is set 300 blocks ahead.
6. **Format check** (`windowFormatFailures`, public keys only):
   - exactly one message, of the window type;
   - every decoded field as planned, and byte-identical to the SDK encoding;
   - B0 as planned;
   - one hybrid extension in `extension_options`, ML-DSA-87, a 4,627-byte signature, no attached key, verified over the v2 sign bytes;
   - signer, sequence and fee as planned, and the auth info byte-identical;
   - the classical signature verified over the final SignDoc.
7. **Simulation** of those exact bytes. A failed simulation, or `exactHybridGas` above the gas limit, stops the tool.
8. **Second confirmation**, bound to the bytes: `BROADCAST EVM WINDOW <first 8 hex of the hash> TO QORECHAIN-DIANA`.
9. **Pre-broadcast.** PREPARE runs again and the fingerprint must still match. At least 20 blocks must be left before the timeout height, and the bytes must still have the hash that was shown.
10. **BROADCAST** (`broadcastOnce`). One sync-mode request. A lost or unreadable answer is UNKNOWN and is never retried. A refusal reports only its code.

## Post-broadcast verification (`--verify <TXHASH>`)

The broadcast answer only means the transaction entered the mempool. The window counts as open only when every condition below holds. Run the check before any deployment, because a deployment moves the sequence.

- The transaction has code 0, the same hash, and a height.
- It carries exactly one `MsgOpenEVMWindow` with the planned fields:
  - sender, 400 blocks and 1 transaction;
  - `max_value` within the limit (and equal to the prepared value when known);
  - no targets or scope.
- It has one hybrid extension, the planned fee and gas limit, and signer sequence 2. Gas used is at most the gas limit.
- The account sequence is 3, and the EVM nonce is 3.
- The registered ML-DSA-87 key is unchanged.
- The window:
  - is found and live, and was opened at the transaction height;
  - `expiry_height − opened_height` = 400;
  - has `max_txs` 1 and `max_value` equal to the transaction's;
  - has nothing used yet;
  - has no targets, and `native_only` is false.
- When run after a broadcast in the same flow, the balance has dropped by more than 0 and at most the 52,500 uqor fee ceiling.

## Read-only PREPARE result (17 November 2026)

`node .\diana-window-open.mjs` against Diana returned the 7C-22 plan unchanged:

- sequence 2, EVM nonce 2, and 99,857,500 uqor;
- no window yet;
- 400 blocks, 1 transaction, `maxValue` 256,500 uqor;
- B0, auth info and PQC sign bytes `6a4775b0…`, `84061cd2…` and `af1490dd…`;
- estimated gas 226,651;
- deployment nonce 3, at the predicted address `0x8a278Cf5B0D34cF844cF19C74116e9DdfB7Aba9d`.

The BUILD step accepted that report within the signing limits. Its first confirmation phrase is `SIGN EVM WINDOW 400 BLOCKS 1 TX 256500 UQOR FOR 16046`.

## What is not verified

- **Gas of the real signed window transaction.** It has never been simulated with real signatures; only the fake-key tests do that.
- **Window expiry convention.** `expiry_height = opened_height + blocks` follows the message documentation ("counted from the block that opens it"). It has not yet been observed on Diana. If the chain counts differently, `--verify` reports `Window length differs from the plan`, and the tool should be adjusted. Nothing is spent as a result.
- **Strict fingerprint.** Any change in balance, gas price or base fee between PREPARE and signing or broadcasting stops the tool. If that happens the run must start again from PREPARE.
