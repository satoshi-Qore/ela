# Explicitly approved Diana schedule — 2026-11-20

Trusted source: `prototypes/diana-payment-account/approved-payment-policy.mjs`. The explicit user schedule approval is recorded separately from fixed-policy and duration approval. No recipient, role, amount, count, duration or start-delay values change.

| Stage | Europe/Istanbul (UTC+03:00) | Unix seconds |
|---|---|---|
| Planned deployment | 2026-11-20 21:30:00 | 1795199400 |
| Start | 2026-11-20 21:45:00 | 1795200300 |
| End | 2026-11-20 22:45:00 | 1795203900 |

The Unix-to-local conversions, 900-second delay and 3600-second duration match exactly. `timing.approvalStatus` is approved, with the user's explicit 2026-11-20 approval source. The checklist rejects a shifted start even if its duration is still one hour. At or after planned deployment it reports EXPIRED and fails dates; no schedule moves automatically. PREPARE evaluates the clock after network reads.

## Current evidence (not a continuing readiness guarantee)

At **2026-11-20 18:20:07 UTC / 21:20:07 Istanbul**, the recorded schedule was VALID. The real read-only PREPARE with explicitly approved public constructor inputs remained BLOCKED (`readyToSign: false`). Chain identity, deployer, registered PQC key, nonce, fees, units, gas estimate, balance, artifact, predicted address availability and constructor checks passed. The remaining failed checks were window-live, window-unused, window-untargeted and window-bounds: no qualifying live EVM window was available. No window was opened.

Gas estimate: 1365431; nonce: 2 at the checked state. The public unsigned package uses that nonce and binds the approved constructor to the runtime SHA-256 pin. Its status public_data_only is reproducible artifact data, including after expiry; it is never permission to execute and does not replace a fresh PREPARE.

Evidence files in `docs/evidence/diana-approved-timing/`:

- `prepare-live.json`: default null constructor; no initcode estimate, execution refused.
- `prepare-approved-live.json`: approved public inputs; read-only estimate; window blockers retained.
- `public-package.json`: public unsigned package from the live nonce, executionAuthorized false.

The reports are timestamped snapshots, not promises that the schedule remains valid later. At/after 21:30 Istanbul this approved deployment schedule is EXPIRED; a later schedule would need a new explicit user decision.

## Verification and authority boundary

21 targeted tests pass (11 approved-policy, 10 existing deployment-package regressions), including exact dates and delay, wrong interval or shifted dates, planned/start/end expiry boundaries, public pin generation, default PREPARE and zero invoked execution effects. Production build passes. Fixtures and real network evidence are separate. No cryptography experiments were rerun.

`executionAuthorized = false` and `LIVE_CONSTRUCTOR_PARAMS = null` remain unchanged. Approval allows public parameter validation, not activation of the CLI signing path. No seed, private key or keystore was read; no signing, window opening, deployment or broadcast occurred. CORE, Model2Vec, Solidity and RPC permission boundaries are unchanged.

Remaining prerequisites: separate explicit authority for actual operations, an explicitly authorized activation of the live constructor, and fresh passing PREPARE checks including a qualifying EVM window, nonce, gas, fees and balance before the schedule deadline. Exact schedule and fixed policy values need no renewed approval while this schedule is valid. If the deadline passes, stop: do not reuse the expired schedule.
