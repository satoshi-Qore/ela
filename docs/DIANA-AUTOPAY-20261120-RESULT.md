# Autonomous-payment run — actual outcome

**Live three-payment run did not complete. No payment transaction was broadcast.** Test completion and live success are separate below.

## Implemented and verified without spending payment funds

- Durable independent Node worker, one initial run authorization, configurable Istanbul start, targets T/T+60/T+120, stable unique invoice IDs and contract nonces 0/1/2.
- Fsynced public journal before broadcast, atomic state replacement, exclusive per-contract worker lock, restart reconciliation and no blind retransmission. A torn journal recovery issue found in review was fixed with preservation of the interrupted bytes and atomic replacement of the valid prefix.
- Existing secure account verifier, ML-DSA-87 invoice signing/local verification, exact on-chain `invoiceDigest` comparison, scoped hybrid window, EIP-1559 signing, signed-field checks, exact `pay()` simulation and canonical receipt/event/state reconciliation.
- Three-transaction window restricted to the selected contract, maxValue 256500 uqor, unchanged 300000 uqor hard ceiling, aggregate gas cap 1710000 (570000 each), fee cap 150 gwei, opening fee ceiling 52500 uqor. Deployment/funding defaults retain their single-transaction scope.
- Actual attempts must remain at least 60 seconds apart; delayed targets do not produce catch-up bursts. Insufficient remaining validity blocks further sends. A future deployment of the same attested runtime can be selected through the public config; no deployment mechanism was added.
- Final tests: **32 targeted checks plus 4 existing window regressions pass (36 total)**. Production build passes. These use fake clocks/public fixtures; they do not prove three real payments.

## Actual authorized run

User explicitly selected and authorized **20 November 23:25/23:26/23:27 Europe/Istanbul**. The earlier 23:30 proposal was rejected because all targets must precede the actual immutable end. The user's later 23:45 statement did not change the deployed contract: chain reads consistently showed startsAt 1795203000 (22:30), endsAt 1795206600 (23:30).

Run ID: `38cfb9d0-72fb-447c-b004-9433c27839b5`. Initial daemon PID 25912 was observed running after the interactive start command exited, independently of the browser/Codex window. The state/journal and three invoice IDs were durable before any key use.

The worker automatically opened and verified the scoped window:

- Hash `E05CE8BB215A1F45BC9856A07AF017B5AB58F0C75F2346E992F39FE249B97D3F`.
- Block 10452744, expiry 10453144; maxTxs 3, maxValue 256500 uqor, target only `0x8a278cf5b0d34cf844cf19c74116e9ddfb7aba9d`.
- Sequence/EVM nonce advanced from 6 to 7. Window fee **52500 uqor / 0.0525 QOR** was spent. No payment gas fee was spent.

At **23:25:16**, the first payment stopped before the prebroadcast checkpoint: viem omits the decoded `value` field for canonical zero-value EIP-1559 calls, while the new checker incorrectly required an explicit `0n`. This was an implementation defect. It was reproduced without a key, fixed by the same exact zero normalization used by the existing deployment checker, and tested to continue rejecting nonzero values. Local ML-DSA verification and exact contract-call simulation had passed before this signed-field check; no payment bytes were sent.

Before a reviewed resume, read-only checks confirmed contract nonce 0, totalSpent 0, balance 0.003 QOR, sender nonce 7, unused window and no saved payment hash. The original blocked state was preserved. Targets/invoices/authorization were unchanged. The resumed process then stopped at **23:26:51** on a QoreChain RPC **HTTP 503**, again before any payment broadcast.

No blind retry, compressed payment sequence, new time approval, extra funding or new contract deployment followed. By the time of investigation there was insufficient validity remaining for three real payments at least 60 seconds apart. The live run remained blocked. Final canonical chain evidence is retained separately; no payment hash or PaymentExecuted event is invented.

## Evidence and next concrete prerequisite

`docs/evidence/diana-autopay-20261120/` retains the armed public plan, prebroadcast blocked state, stop state, public event log, final tests/build and canonical final chain state. Live worker journals remain in ignored `.diana-autopay/`. No secrets or raw signed transactions were committed. No PR was created or merged.

To perform a new real three-payment run, an explicitly authorized contract with a new valid interval and a new approved start is required. This task does not deploy or fund a replacement. The current contract has no withdrawal/recovery function; funds remaining after expiry cannot be paid through its expired `pay()` window. Its existing 0.003 QOR was not transferred by this run.
