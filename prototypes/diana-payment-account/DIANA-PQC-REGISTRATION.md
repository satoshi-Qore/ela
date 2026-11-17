# Diana Invoice Owner: canonical PQC key registration

The registration was prepared (7C-10A), audited (7C-10B) and run once by the user on 17 November 2026. It is confirmed on chain; see [On-chain result](#on-chain-result-7c-11).

`diana-register-pqc.mjs` registers the Invoice Owner's canonical ML-DSA-87 key with `MsgRegisterPQCKeyV2` (QoreChain SDK 0.14.0). It runs only in the user's own interactive Windows PowerShell session and reads the existing recovery record read-only, through the same reader as `diana-verify-recovery.mjs`. It never writes a file, and it never prints the mnemonic, password, private key, PQC secret key or record contents.

| | |
|---|---|
| Account | `qor1dfw567en2l0edze2xqzqw8kwnrcpt3u5m9n88r` / `0x6a5d4D7B3357df968b2A3004071eCe98f015C794` |
| Chain | `qorechain-diana`, EVM chain ID 9800 |
| Expected account number / sequence (before registration) | `16046` / `0` |
| Gas limit / price / fee | 600,000 / 0.15 uqor per gas / 90,000 uqor (0.09 QOR) |

## Modes

**`node .\diana-register-pqc.mjs`** (default): prepare only. Nothing is signed or broadcast.
1. Asks you to type `PREPARE DIANA PQC REGISTRATION`, then reads the record and derives the account in memory.
2. Checks that the record derives the expected addresses and that its PQC key is the canonical key.
3. Re-reads the live chain and stops if any check fails:
   - chain ID and EVM chain ID;
   - the account exists, with account number 16046 and sequence 0;
   - the on-chain classical key is empty or is this account's own key;
   - no PQC key is registered yet;
   - the uqor balance covers the fee;
   - 0.15 is at or above the chain's minimum gas price;
   - the chain supports proof of possession (upgrade v3.2.3).
4. Simulates the registration **without any signature**: the transaction carries a 64-byte all-zero placeholder in place of the signature, and no proof of possession.
5. Prints the public plan, including the simulated gas and an estimate with the proof of possession added.

**`node .\diana-register-pqc.mjs --broadcast`**: runs the same prepare step, then asks for two more confirmations.
1. Type `SIGN PQC REGISTRATION FOR 16046`. The tool re-reads the chain, then:
   - signs the proof of possession and checks it locally, as the chain will;
   - simulates the exact final transaction and requires at least 1.3× gas headroom under 600,000;
   - signs the transaction classically, with the chain ID, account number, sequence, gas and fee taken from the fixed plan (first registrations are exempt from hybrid signing);
   - refuses if the signed body or auth info differs in any byte from what was simulated.
2. Type `BROADCAST TO QORECHAIN-DIANA`. The tool re-reads the chain once more, then sends the transaction exactly once, in sync mode, and prints the transaction hash and code.
   - If the sequence has changed or a PQC key has appeared at either re-read, the tool stops.
   - The broadcast route passes once per run.
   - If the answer is lost (timeout, network error, unreadable reply), the tool reports `broadcast: "unknown"` with the hash and stops; it never retries. Check the hash and the account read-only before doing anything else. A re-run is refused once the sequence has moved, and one sequence can be included only once.

Any other answer stops the tool. Network access is limited to HTTPS calls to the two Diana testnet hosts:
- reads (GET);
- the simulation route;
- `eth_chainId`;
- the broadcast route, which opens only after the second confirmation.

## What is measured, and what is not
- **Proxy simulation:** this was a throwaway random key on the Invoice Owner address. The tx had no public key and no signature, and nothing was broadcast.
  - With a proof of possession: **275,101 gas**.
  - Without one: **226,051 gas**.
  - A wrong sequence is refused by the chain.
- **Gas for the canonical key:** this is measured by the tool's own simulation in the user's session. It should be close to the proxy figure, because the key and proof sizes are the same. 600,000 gas leaves about 2.2× headroom over 275,101.
- **Secrets that cannot be wiped:** JavaScript strings, which are the mnemonic and the SDK's hex private key, and the SDK's internal copy of the classical key bytes. Every ML-DSA-87 secret buffer and the record bytes are zeroed.

## After a broadcast
Re-run the read-only checks:
- the PQC REST record shows `found: true` with `algorithm_id` 1 and `possession_proven: true`;
- the SDK `fetchPqcStatus` and the `pqcKeyStatus` precompile show it as registered;
- the account sequence is 1 and its classical public key is set;
- the uqor balance has dropped by the fee.

## On-chain result (7C-11)
The user ran `--broadcast` in their own session, and the tool printed `broadcast: true`, `code: 0`. Read-only queries on 17 November 2026 (GET and read-only `eth_call` only) confirm it:

| Check | Result |
|---|---|
| Transaction | `480E146FC5603464E3F38EED9D0CE867CF2242F6263C1E8591F3517BCEA347C6` |
| Block | **10228530**, `qorechain-diana`, 2026-11-17 01:59:09 UTC, `code: 0` |
| Message | one `/qorechain.pqc.v1.MsgRegisterPQCKeyV2`: `algorithm_id` 1, `key_type` hybrid, empty `ecdsa_pubkey`, 2592-byte key, and a 4627-byte PoP that verifies locally |
| Events | `pqc_key_registered` (hybrid, dilithium5); `pqc_hybrid_classical_only` (the classical-only bootstrap path) |
| PQC status | **`registered: true`**, **`algorithmId: 1`**, **`possession_proven: true`** from REST, SDK `fetchPqcStatus` and the `pqcKeyStatus` precompile; REST `created_at_height` 10228530 |
| Registered key SHA-256 | `a3b2c32d6e5d35138c69c2154d36ba0ba1779658cd4f9bc1567b5e35831bab5a`, identical in all three sources and in the transaction's message |
| Gas | **297,023** used of 600,000. This equals the prepare-mode simulation (247,973) plus the measured PoP cost (49,050). |
| Fee | **90,000 uqor** (0.09 QOR), charged on the gas limit |
| Account after | account number 16046, **sequence 1**, eth_secp256k1 public key set, EVM nonce 1, balance 99,910,000 uqor (99.91 QOR) |

All answers agree with each other. No further transaction was sent.
