# Payment Account completed evidence — 22 November 2026

The existing module 04 now shows the completed 21 November Diana chain-9800 run: contract, policy window (06:30–07:30 Europe/Istanbul), 3/3 receipts, 0.003 QOR paid, final nonce 3, archived zero balance, all targets/submission/block times, full transaction hashes, deployment/funding and source links. No new application page was added. CORE and PQC source files are unchanged. The static archive has no running-payment animation.

## Evidence boundary

`src/payment/evidence.json` exactly copies the already verified public `final-chain-state.json`. The displayed archive is explicitly dated 21 November 2026 06:46:25 UTC+03:00, block 10471302. The archive includes the receipt-read interruption and controlled recovery; target timing is not presented as exact or fully unattended.

An explicit read-only recheck lazy-loads `src/payment/verify.ts`. It checks chain 9800, the SHA-256 runtime pin, the entire contract policy including nonce/totalSpent, current balance, all three receipt identities/statuses, canonical block hashes/timestamps, and the exact single PaymentExecuted event (nonce, recipient, invoice ID, amount and log identity). State reads use a canonical block-hash snapshot and finish with a chain/snapshot consistency check. A later donation is reported as a separate current balance. Errors never promote the archive into fresh verification. No signer, payment worker, wallet, secret or raw signed transaction is imported into the browser.

This session could not connect to the live Diana RPC from its local execution environment (`fetch failed`). Consequently no fresh live-chain success is claimed. The explorer's Testnet selector was verified in the browser, but its search returned transaction-not-found for the first EVM hash; the module explains potential EVM indexing limitations and offers archived receipts plus RPC recheck instead. Explorer links use the official explore.qore.network host; selecting Testnet may be required.

## Preserved local automation

The original clean operational worktree remains at 7a1548b. Its six commits after current remote main 1cad76a were copied without modifying their files: c4a6e00, 426d886, 733023c, e25ab34, a554e5e, 7a1548b. They cover guarded deployment and one-time funding, bounded restartable worker/scheduler, exact spacing and zero decoding, directed read-only retries, receipt-first reconciliation, canonical post-payment counters/balances, relocked execution, and dated evidence/recovery logs. No ignored keystore or durable worker state was copied. Other dirty worktrees were left untouched.

The PR's first commit reproduces that automation tree on main; its second adds this UI. Original local commit identities remain in the source worktree. Source links pin the preserved automation commit, not a moving branch.

## Validation

- Production TypeScript/Vite build passed.
- 84 targeted tests passed: readiness, deployment policy/package, live adapter, scheduler, retry and 16 new payment-evidence tests. Fixtures are not represented as fresh live-chain reads.
- New tests reject wrong chain, missing/failed receipt, wrong hash, event amount/nonce/recipient/invoice, removed event, changed runtime/counters, noncanonical blocks, 503 and CORS/network failures; a later donation stays separate from archived zero.
- Real browser inspection: English/Turkish at 1440 and 320 pixels. At 200% text (32px root), an event-label wrapping defect was found and fixed. The final payment module had no overflowing descendants at either width. The temporary font override was removed before the final build. All three final rendered hashes match the archived sequence.
- Existing browser characterization expectations were updated for the completed card and read-only controls; tests cover timing, both languages, no activity animation and RPC failure separation. Local automated Chrome characterization could not finish its before-hook startup; it is NOT reported as passed. Existing CORE/PQC checks remain in the suite for CI.
- Main JS budget changes only by 0.15 KiB gzip / 0.25 KiB raw for the lazy payment-panel mount; payment archive/verifier stay separate chunks.

Remaining verification: automated browser suite/CI, fresh live RPC access, and explorer EVM indexing. No new payment, funding, signing, deployment or merge was performed.
