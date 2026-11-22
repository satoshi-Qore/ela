# Bounded Diana autonomous payments

This adds a browser-independent Node worker to the existing prototype tools; the repository has no existing server/service lifecycle. It does not alter CORE, Model2Vec, Solidity, GitHub Actions or Pages. Only Diana 9800, the fixed Executor/Invoice Owner and recipient, three 0.001 QOR payments and the 0.003 QOR total are accepted. An optional public contract/runtime configuration permits a future deployment of the same attested contract without deploying anything.

## One start command

```powershell
npm run payment:autopay -- --start "2026-11-20 23:25:00"
```

One interactive confirmation authorizes the bounded run. The command launches an independent detached Node process (hidden on Windows) and returns its PID and durable state path. Per-payment Codex commands or confirmations are not required. `--status` reads its status and `--resume` resumes the existing journal after a process/OS restart; a second concurrent worker is refused. The browser and Codex window do not own the timer. After an OS restart the same resume command must launch the worker again; no machine startup service is installed.

Times use explicit `YYYY-MM-DD HH:mm:ss` Europe/Istanbul (UTC+03 for current/future dates). Targets are T, T+60 and T+120; each must be in the chain-attested [startsAt, endsAt) interval. The first target must be future at initial authorization. The actual contract ends on 20 November 2026 at **23:30**, not 23:45. The subsequently approved 23:25/23:26/23:27 targets are valid. No expiry is moved automatically.

State and append-only fsynced journal reside under `.diana-autopay/<contract>.json*`, excluded from Git. Public invoice IDs, intended and observed send times, transaction hashes, receipt block timestamps, events and errors are retained. Exclusive per-contract PID/token locks exclude parallel workers and stale locks are archived. Public plan SHA-256 detects accidental changes, not malicious local-file edits; the same trusted OS account that can edit the signing tools must protect these files. Keys and raw signed transactions are not persisted. A durable transaction hash and public intent are committed **before** any broadcast.

## Existing signing/window path

The Invoice Owner is derived/verified in memory with the existing recovery-record helper. The on-chain PQC registration, ownership proof, canonical public key and classical key must match. `invoiceDigest` is computed from the Solidity ABI and compared with the contract's canonical block read. The SDK signs the exact 32 digest bytes using ML-DSA-87 and verifies locally. The exact `pay()` call is gas-estimated and simulated, then signed through the existing EIP-1559 signer. Network, contract bytecode including immutable fields, exact recipient, invoice ID/nonce/amount, calldata, zero transaction value, fees and gas are checked again before one guarded broadcast.

One **contract-scoped, three-transaction** EVM window is opened about 90 seconds before T using the existing hybrid-signing, exact signed simulation and verification mechanism. Defaults for deployment/funding stay one transaction. The autonomous window requires exactly three transactions and exactly one allowed target, the selected contract. Its maxValue stays at 256500 uqor, below the unchanged 300000 uqor hard ceiling; gas cap is 570000 per payment (aggregate 1710000), fee cap 150 gwei, priority 12.5 gwei, window fee ceiling 52500 uqor. A larger estimate stops the run. No funding is added automatically. Gas fees come from the executor, separately from the contract's 0.003 QOR budget.

The previous payment must be receipt/event/state-confirmed before the next is signed/sent. Slow inclusion is logged as lateness while targets retain 60-second spacing. Actual submission attempts are at least 60 seconds apart, including after delayed initial preparation: late targets are never compressed into a burst. Insufficient remaining validity for all remaining intervals blocks before sending. Receipt `PaymentExecuted` must match nonce/recipient/invoice/amount, and canonical `paidInvoices`, `nextNonce`, `totalSpent`, runtime and block time must agree. An unknown result is never blindly resent: restart reconciles the saved hash read-only. Failed/unknown results block the sequence; blocked runs require investigation and do not automatically resume. Three confirmed payments stop the worker.

## Evidence and validation

Fake-clock tests cover fixed targets, invoice uniqueness, ordering, failures, expiry, durable checkpoints, restart and duplicate prevention. Adapter tests cover domain-bound digests, envelope restrictions, exact event validation, journal recovery and concurrent-worker refusal; existing window regressions retain the original boundaries. Production build is checked separately. Live payment evidence, if executed, is archived independently from these tests.

For the 20 November run, see [the actual run outcome](DIANA-AUTOPAY-20261120-RESULT.md). Test success is not evidence that live payments completed.
