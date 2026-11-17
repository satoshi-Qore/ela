# Diana Invoice Owner: first hybrid-signed transaction

This document covers preparation (7C-13), the signing tool (7C-14) and local verification of a real hybrid signature (7C-14B, [result](#local-verification-result)). Nothing has been broadcast. Broadcasting the real transaction is a separate step that needs its own approval.

The Invoice Owner registered its canonical ML-DSA-87 key at block 10228530 (see `DIANA-PQC-REGISTRATION.md`). Diana requires hybrid signatures (`hybrid_signature_mode: required`), so every later Cosmos transaction from this account carries a classical signature and an ML-DSA-87 signature.

The planned first transaction is a 1 uqor `MsgSend` from the account to itself.

| | |
|---|---|
| Account | `qor1dfw567en2l0edze2xqzqw8kwnrcpt3u5m9n88r`, account number 16046, sequence 1 |
| Registered key SHA-256 | `a3b2c32d6e5d35138c69c2154d36ba0ba1779658cd4f9bc1567b5e35831bab5a` |
| Gas limit / price / fee ceiling | 350,000 / 0.15 uqor per gas / 52,500 uqor (0.0525 QOR) |

## The hybrid format (SDK 0.14.0 `signHybridEth`)
1. **B0** is the `TxBody` (messages, memo, timeout height) with no extension. **A** is the `AuthInfo`: the account's eth_secp256k1 public key, `SIGN_MODE_DIRECT`, the sequence and the fee.
2. The ML-DSA-87 key signs the v2 sign bytes. Diana uses v2: the `pqc-sign-bytes-v2` protocol feature is enabled. The bytes are, in order:
   - `"qorechain-pqc-hybrid-v2"`
   - `be64(len chainId)`, then `chainId`
   - `be32(len B0)`, then B0
   - `be32(len A)`, then A
3. The final body is B0 plus one `extension_options` entry, `/qorechain.pqc.v1.PQCHybridSignature`:
   - `algorithm_id` is 1;
   - the signature is 4627 bytes;
   - no public key is attached, because the key is already registered.
4. The classical key signs `SignDoc{final body, A, chainId, accountNumber}` using keccak256 and secp256k1, giving a 64-byte signature.

`hybridFormatFailures` checks a signed transaction against the plan using only public keys. It checks:
- the message;
- where the extension is placed, and its shape;
- the ML-DSA-87 signature over the v2 bytes of B0 and A;
- the signer info and the fee;
- the classical signature over the final body.

## PREPARE tool
`node .\diana-hybrid-prepare.mjs` needs no key, no recovery record and no vault, and it is safe to run anywhere. It has no signing code and no broadcast route.

It reads these values from the chain:
- chain ID and EVM chain ID;
- account number, sequence, and the on-chain classical key, which must derive this address;
- the registered PQC key: its fingerprint and algorithm;
- the sign-bytes version, the balance and the minimum gas price.

It then builds the exact unsigned B0 and A, and prints the SHA-256 of the bytes each key would sign. It also simulates the transaction with **all-zero placeholders** in place of both signatures.

## Gas: an estimate, not a measured value
- A simulation with placeholder signatures passes on Diana. It also passes **without any extension**, which shows the simulation does not enforce or verify the hybrid signature.
- The placeholder simulation used **186,999 gas**. The tool adds the SDK's `HYBRID_VERIFY_GAS` (40,000), giving an estimate of **226,999**. 350,000 gas covers that with 1.54× headroom; the tool requires at least 1.3×.
- The exact gas needs a simulation of the **really signed** transaction. The SDK's `TxClient.simulateHybrid` does this by signing first. That belongs to the separately approved signing step.

## Signing tool (7C-14): `diana-hybrid-sign.mjs`
- **`node .\diana-hybrid-sign.mjs`** (default): runs the same PREPARE step. It is read-only and needs no vault, record or key.
- **`node .\diana-hybrid-sign.mjs --sign-and-simulate`**: runs only in your own interactive Windows terminal.
  1. Runs PREPARE and prints the plan.
  2. Asks you to type `SIGN AND SIMULATE HYBRID SELF-SEND FOR 16046`. The recovery record is read only after that, read-only, and checked: the expected addresses, the canonical ML-DSA-87 key, the registered fingerprint, and the on-chain classical key.
  3. Re-reads the chain right before signing. Any change stops the tool.
  4. Signs with the SDK's `signHybridEth`. All fields come from the fixed plan, except the timeout height, which is set to the latest height plus 5. A signed copy relayed later therefore cannot be included.
  5. Checks the signed bytes with `hybridFormatFailures`, which verifies both signatures with the on-chain public keys, and requires the planned auth info byte for byte.
  6. Sends the signed bytes to `/cosmos/tx/v1beta1/simulate` only, once and with no retry. It reports the gas used, `exactHybridGas` and whether that fits 350,000. A refusal or an unclear answer is reported with its public code only.
  7. Zeroes the signed bytes, the record bytes and every ML-DSA-87 secret buffer.

The tool has no broadcast route. Its network guard allows only GET reads, `eth_chainId` and the simulation route; the tests check that `/txs`, `eth_sendRawTransaction` and RPC broadcast are refused.

**What remains a risk:** the simulation endpoint receives a really signed transaction. In principle, an operator of the public node could relay it before its timeout height, a few seconds away. That would be the planned 1 uqor self-send, at a fee of at most 52,500 uqor. The account's sequence would then move to 2, and any later run would stop at the sequence check.

**What the simulation cannot show:** Diana's simulation does not verify the hybrid signature. A simulation without any extension also passes. The signature's validity comes from the local `hybridFormatFailures` check, not from the simulation.

## Local verification (7C-14B): `--sign-and-verify-local`
`node .\diana-hybrid-sign.mjs --sign-and-verify-local` runs only in your own interactive Windows terminal. It signs the transaction and verifies it **without sending the signed bytes to any node**.
1. Runs PREPARE: read-only, with one placeholder simulation and no key.
2. Asks you to type `SIGN AND VERIFY LOCALLY FOR 16046`. The recovery record is read only after that, and checked exactly as in the simulate mode.
3. Re-reads the account, sequence and PQC registration from the chain right before signing.
4. **Seals the network.** From this point every request is refused before it reaches the transport, including reads.
5. Signs the exact planned transaction with SDK 0.14.0 `signHybridEth`: classical ECDSA plus ML-DSA-87, no timeout height.
6. Requires the auth info (key, sequence, fee) to match the plan byte for byte. Runs `hybridFormatFailures`, which checks:
   - the body;
   - the ML-DSA-87 signature, against the registered key over the v2 sign bytes;
   - the classical signature, against the on-chain key over the SignDoc with chain ID `qorechain-diana` and account number 16046.
7. Prints only public values: both verification results, the SHA-256 of B0, the auth info and the PQC sign bytes, and `matchesPrepare`. The signed bytes, and even their hash, are never printed, written or sent. They are zeroed together with the record bytes and every ML-DSA-87 secret buffer.

The seal stops the tool's own code from sending anything after signing. It cannot stop a compromised dependency that opens its own network connection.

## Local verification result
You ran `--sign-and-verify-local` once, in your own terminal, on the real Invoice Owner record. The tool printed:

| Field | Value |
|---|---|
| `formatCheck` | `pass` |
| `classicalSignature` | verified with the on-chain eth_secp256k1 key |
| `pqcSignature` | verified with the registered ML-DSA-87 key |
| `matchesPrepare` | `true` |
| `sentToNetwork` | `false` |
| `broadcast` | `false` |
| Account number / sequence | 16046 / 1 |

The hybrid signature that SDK 0.14.0 produces for this account is valid under both on-chain keys, and it signs exactly the transaction PREPARE planned. The signed bytes were not sent, stored or printed. The transaction has not been simulated with real signatures or broadcast.
