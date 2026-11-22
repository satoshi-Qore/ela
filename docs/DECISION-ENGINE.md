# 05 — Decision Engine

Base: merged PR #44, main 347c72cbcbb42d6198dfda37f47595751883baef.

`src/decision/engine.ts` is a pure deterministic evaluator. It has no imports, network, hidden clock, randomness, storage, signing or execution path. Its explicit policy and evidence inputs return immutable ALLOW / BLOCK / WAIT / UNKNOWN results, a decisive control, all check values/requirements, source, block and reference times. executionAuthorized is always false. This is a rule engine, not a trained AI model, and it does not replace the existing agent safety gate.

Controls cover policy validity and provenance; network, contract and recipient; [start, end) timing; positive per-payment amount and aggregate spending; maximum payment count; used/future nonce and paid invoice; balance in wei; prior confirmation; RPC failure, timeout, missing data, freshness and contradictory facts. Invalid or contradictory data is UNKNOWN; a known denial is BLOCK; transient/unconfirmed conditions WAIT; only complete passing inputs ALLOW. UNKNOWN takes precedence over BLOCK, then WAIT, then ALLOW. A failed previous transaction blocks for explicit review; the evaluator never schedules a retry.

Trust boundary: the evaluator validates shapes, units and internal coherence, but does not authenticate a caller's claim that evidence is verified. Trusted read adapters must establish this independently. Source/time fields are provenance, not cryptographic attestation. The browser exposes no editable fact inputs and no live-action approval. Current input support is tested through deterministic fixtures; wiring a current proposal to a verified full-state read adapter is a separate, deliberately unimplemented capability.

## Real history without invented decisions

The view uses the already verified 21 November archive through `src/decision/history.ts`. For each successful receipt it evaluates repeating that same payment against the documented POST-receipt balance, totalSpent, nextNonce, paid-invoice event and block time. It never invents a pre-send balance or claims the engine actually decided anything in 2026 before it existed.

- Payment 01: BLOCK, consumed nonce 0 vs nextNonce 1; invoice also already paid.
- Payment 02: BLOCK, consumed nonce 1 vs nextNonce 2; invoice also already paid.
- Payment 03: BLOCK, total 0.003 + proposed repeat 0.001 > cap 0.003 QOR; count, nonce, invoice and zero-balance checks also block.

All twelve per-payment controls, their actual/expected technical values, transaction hash, invoice, source file, evidence block and UTC block time are visible. These are archived replays, independent of module 04's live recheck. Changing the selected payment performs no network read. The archive is not modified.

## UI and validation

Module 05 is added to the existing navigation and module grid. Existing 01–04, CORE, PQC, Payment Account and automation implementations are unchanged. English/Turkish labels and explanations identify evaluation-only authority and historical provenance. A separate view chunk shares the existing immutable evidence data; no signer or payment worker is bundled.

Local targeted checks: 97 tests passed (new engine scenarios plus existing agent/PQC isolation). Production TypeScript/Vite build passed. Tests cover ALLOW, network/contract/recipient denials, exclusive expiry, not-yet-open window, exact limits, total cap, balance, used/future nonce, invoice use, pending/failed/unknown predecessors, RPC/timeout, missing and contradictory data, invalid units, overflow, stale/future evidence, purity/immutability and all three real archived rows. Existing full Chrome layout, themes, 100%/200% text and CORE/PQC checks run in CI, alongside the new bilingual historical replay UI test.

No payment, funding, contract deployment, signing, key use or automation behavior change was made. No new server, proxy, AI model or automatic execution authority was added.
