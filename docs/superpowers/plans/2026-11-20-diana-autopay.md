# Diana bounded autonomous-payment implementation

User spec supplies architecture and authorization: retain the existing contract/signers, add one durable Node scheduler, three fixed payments 60 seconds apart, fail closed on unknown outcomes. No alternative chain executor or GitHub worker. Explicit start was corrected from invalid 23:30 to 23:25 on 20 November, Istanbul; actual immutable end is 23:30.

1. Verify chain interval/funding and available service lifecycle; preserve previous evidence.
2. Build/test pure scheduler with durable checkpoints, restart reconciliation and sequential receipts.
3. Bind existing account verification/ML-DSA/EIP-1559 signer and guarded broadcaster to exact invoices/pay calldata. Support one scoped three-use window within existing aggregate monetary/gas limits.
4. Add independent persistent worker, atomic fsynced journal and per-contract process lock, one initial authorization, status/resume commands.
5. Run fake-clock/envelope/persistence/window regressions, review critical safety paths, build production.
6. Arm only the explicitly approved 23:25 schedule after checks pass. Observe real receipt/events individually; stop on a failure or expiry. Archive public evidence and distinguish simulation from actual transfers.
