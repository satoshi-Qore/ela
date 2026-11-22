# Diana live autonomous-payment workflow — 21 November 2026

The user explicitly authorized a new deployment, exactly 0.003 QOR funding and three 0.001 QOR payments to the fixed recipient, with targets 06:40/06:41/06:42 Europe/Istanbul. No old contract is used. Main was checked at `1cad76a`; existing local automation and earlier evidence were preserved.

## Verified setup

| Item | Result |
|---|---|
| New contract | `0x127dd577174e8829a38AE6885bfe058855C04601` |
| Deployment hash | `0x3a2722d545b635e92023e1740897d414d3ccf1ba1e56865db97137e30c1e91e4` |
| Deployment receipt | success, block 10469518, gas used 1365455 / limit 1710000 |
| Deployment time | Unix 1795230229, before approved deadline 1795230900 |
| Funding hash | `0x478f47a7c713eb4cd54915f01ecfb59e6fc6b40d1d1aacab7908f1c77fffef7f` |
| Funding | receipt success, exactly 3000000000000000 wei; no previous balance and no extra funding |
| Runtime SHA-256 | `dde7b91ee1570fc0b22b323f956058d3cc35e182a176c45b837d549ca0478c19` |
| Policy | fixed recipient/roles; 1000000000000000 wei each, 3000000000000000 total, 3 payments |
| Contract interval | startsAt 1795231800 (06:30), endsAt 1795235400 (07:30) |
| Payment targets | 1795232400 / 1795232460 / 1795232520 (06:40 / 06:41 / 06:42) |
| Run | `cfd7d693-7ac2-4f0f-9188-7cfc51602865`; independent Node worker initially PID 3612 |

Constructor, source/compiler/immutable/runtime pins, chain, nonce, PQC, sender balance, gas/fee limits and canonical receipts were verified using existing tools. Deployment activation was then relocked (`LIVE_CONSTRUCTOR_PARAMS = null`, policy executionAuthorized false); the separate scheduled-run authorization remains bounded to its exact three payments. No global agent execution rights changed.

## Narrow reliability correction

`diana-read-retry.mjs` retries only pinned Diana reads and simulations, at most three attempts, with bounded delays for transport failure or HTTP 429/502/503/504. It never retries EVM raw transaction submission, Cosmos broadcast or unknown methods. Permission guards are unchanged. Wrong-chain, invalid response and semantic validation errors remain failures. Tests explicitly cover Cosmos/EVM broadcast and a lost write response remaining single-attempt.

Window CLI can accept an explicit `--sequence` for the real current nonce; it remains part of all PREPARE, signing, simulation and verification checks. The original default sequence is unchanged. Deployment preparation now uses the existing exact precisebank reconciliation, including the independently queried sub-uqor fraction; no rounded comparison or tolerance is introduced.

Final targeted setup regressions: 59 tests plus 4 window regressions pass (63 total); production build passes. Read-only code review found no critical/important findings in retry/guard changes. These tests are separate from live payment proof.

## Operational command

```powershell
npm run payment:autopay -- --config docs/evidence/diana-live-20261121/autopay-config.json --start "2026-11-21 06:40:00"
```

One bounded-run confirmation was entered under the user's explicit workflow approval. The independent worker follows the persisted state. Status uses the same public config and `--status`. Successful receipts and PaymentExecuted events, actual send/confirmation times, balances and counters will be recorded after execution; setup success alone is not payment success.

Evidence is additive under `docs/evidence/diana-live-20261121/` and `docs/evidence/diana-funding-20261121/`. Local durable state remains in ignored `.diana-autopay/`. No PR or merge is needed for this operational test.

## Actual completed payments

All three receipts are **status 0x1**, with the exact PaymentExecuted event, invoice ID, recipient, amount, canonical counter values and post-payment balance verified. All times below are 21 November, Europe/Istanbul.

| Contract nonce | Target | Actual submission | Receipt block time | Transaction |
|---|---|---|---|---|
| 0 | 06:40:00 | 06:40:21 | 06:40:21 | `0x93ad86e777f5afef32f607336586d927c3ecda4d198c3ce3405ae2e5e624569b` |
| 1 | 06:41:00 | 06:41:42 | 06:41:41 | `0x2ddba43246a070ab6a969ef6ca64d77be1755f4d0f2edc1b1d097ed71854d4a9` |
| 2 | 06:42:00 | 06:44:58 | 06:44:58 | `0xdc549e462e1946f129d3e8dc800b857a22808f588afc464149827dec8ecb1e4b` |

Targets were not met exactly. Actual submission intervals were **81 and 196 seconds**; none were compressed below 60 seconds. Block timestamps are the chain's clock, independently recorded from client submission/observation times (including the one-second difference on payment 1).

The payment window was opened automatically and verified: `CC4CFE64C82E6B0BC1A99DF70DB336642406E75B9B58DBA427B4A356A72162B7` (see the completed run's windowCheckpoint for full proof). It admitted exactly three transactions, only to the new contract, with the original maxValue ceiling. Final window usedTxs is 3. The three signed gas limits were 450000 / 380000 / 380000, sum 1210000, below the aggregate 1710000 ceiling. Actual gas used was 338115 / 278831 / 278783; effective price 112.5 gwei, below the 150-gwei cap.

### Receipt-read stop and controlled recovery

This was **not a completely unattended clean run**. After payment 1 was accepted, its initial receipt/transaction identity comparison stopped the worker. The prior code read transaction state before receipt state, permitting inclusion between those separate reads to yield an inconsistent pair. Fresh read-only investigation found the same expected transaction hash, sender, recipient, successful receipt and matching canonical block. The second transaction was not rebroadcast.

A deterministic regression reproducing the read-order transition was added. Reconciliation now reads the receipt first, then transaction identity, and treats temporarily unindexed transaction fields as bounded pending/unknown data; all strict identity, runtime, event and canonical-state checks remain. The original blocked state was preserved. Before the controlled resume, payment 1 was fully reverified, contract nonce was 2, totalSpent 0.002 QOR, balance 0.001 QOR and window usedTxs 2. The same authorization, invoice IDs and target times were retained. On restart the worker re-audited confirmed/uncertain history and sent only payment 2.

This recovery caused the third payment's delay. There were exactly three payment broadcasts, **zero resubmissions**, and no additional funding. The automatic worker completed and stopped at **06:45:02**, two seconds after the 06:45 verification target; independent final chain verification followed at **06:46:25**, before the user's 07:00 shutdown.

### Final state and closure

Canonical snapshot 10471302 (`0xaebd194ccd286cee92d843552d02cf4532b4ffc7934add93f9a969bd98396942`):

- Contract balance **0 wei**; nextNonce **3**; totalSpent **3000000000000000 wei / 0.003 QOR**.
- Receipt balances after the three payments: 0.002 / 0.001 / 0 QOR, verified at each canonical receipt block.
- Executor account nonce 15; payment window usedTxs 3. Worker status complete, no worker lock, original/resumed worker processes no longer running.
- No secret material or raw signed transactions were printed or committed. Deployment remains relocked, funding is protected by its one-attempt journal, and the completed run cannot automatically schedule additional payments.

The final adapter also explicitly includes post-payment balance/nonce/totalSpent in canonical receipt reconciliation; all three historical successful receipts passed this check. Final validation is **60 targeted tests plus 4 window regressions (64 total)** and a successful production build. `final-chain-state.json`, per-payment verification/balance records, completed public state and run events distinguish the actual chain outcome from mocked tests and preserve the recovery history.
