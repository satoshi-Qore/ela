# ELA — Developer Fest demo and submission pack

Prepared 22 November 2026 against merged PR #48, main
`0de45568e1a0b5e270408cfd9a751193aa35e011`.
Status: materials prepared; video not recorded by this task; platform fields and
final submission not changed. This branch is not the deployed Pages version until merged.

## Project description

Name: ELA — Execution & Logic Agent.

Tagline: Verify the read. Explain the rule. Keep authority bounded.

Short description:

ELA is a bilingual, read-only QoreChain Diana agent with an explainable safety boundary.
It combines verified network reads, local ML-DSA-87 verification, evidence of three
completed policy-bounded payments, deterministic decision explanations and an optional
learned local classifier that remains disabled after failing its accuracy gate.

Long description:

Blockchain agents need a clear boundary between understanding a request, verifying
facts and having permission to act. ELA makes that boundary visible on QoreChain's
Diana testnet. A user can ask in English or Turkish for network, block, account,
transaction, fee or token data. Every request passes a deterministic safety gate,
fixed intent validation and a guarded read-only registry before any network method
can run. Unsupported or uncertain requests ask for clarification instead of guessing.

The interface also demonstrates post-quantum signature verification using QoreChain's
official ML-DSA-87 public vector. Changing one message byte invalidates the same
signature; the browser never creates a key or signs anything. Separately, ELA's
bounded payment prototype completed three real 0.001 QOR payments on 21 November.
The demo exposes their contract, transaction identities, receipt/event evidence and
timestamped final state. An explicit Diana RPC recheck compares current chain data
with that evidence. A failed live read never becomes a new success or erases history.

A pure Decision Engine explains policy checks and ALLOW, BLOCK, WAIT and UNKNOWN
outcomes without granting execution authority. Its UI shows historical post-payment
replay explanations; linked tests cover the remaining outcome scenarios. A genuine
small learned classifier runs locally only after opt-in, lazy loading and integrity
verification. Its quality is insufficient: historical evaluation is 266/307 correct
with 10 false accepts, versus rules at 287/307 with none. A later research candidate
was rejected. AI remains OFF; no production-quality inference is claimed.

ELA presents inspectable evidence and explicit limits rather than a wallet controlled
by model output. The completed payment worker is separate from the browser. The
interface cannot fund, deploy, sign or execute a new payment.

## Architecture

The browser command path is user text → Safety Gate → deterministic routing → optional
local classification when necessary → closed-label validation → fixed Tool Registry →
guarded Diana reads → structured result. The session is the only command entry point.
The classifier sees normalized text, not wallet access, tools, RPC parameters or prior
results. Uncertain/invalid inference stops safely; unavailable model artifacts fall back
to the deterministic classifier. The default does not load model weights.

Independent components:

- CORE observes the rendered execution trace and supports three themes.
- PQC verifies a public ML-DSA-87 vector locally in a lazy chunk.
- Payment Account displays dated evidence and an explicit read-only verifier. It checks
  chain 9800, pinned code, policy, three receipts, canonical blocks, PaymentExecuted
  fields, nonce, totalSpent and balance. It does not run the worker.
- Decision Engine consumes explicit policy/facts/time; no clock, transport, wallet or
  execution capability exists in the pure engine. Every result denies execution authority.
- The separate Solidity payment account enforces fixed executor/recipient/issuer,
  payment count, time window, per-payment/total caps and invoice replay protection.
  It verifies signed invoices through Diana's PQC interfaces. Its completed operator
  workflow and scoped EVM window have public evidence; they are not browser actions.

Implementation: TypeScript, static Vite/Pages, QoreChain PQC 0.2.3, Solidity prototype.
The optional standalone SDK reader uses QoreChain SDK 0.14.0 but is not the browser's
transport. The real learned model is original MIT sparse hashed n-gram softmax, not an
LLM. Libraries and older experiments are credited in the repository README.

## Demo runbook

Open [the demo](https://satoshi-qore.github.io/ela/) and expand **Guided demo** below
the hero. It is a reading guide with anchors, not an automation runner. No step is
auto-executed and no checkbox enables AI. Use EN/TR and the theme switch normally.

| Step | Operator action | What to show | Failure/limitation boundary |
| --- | --- | --- | --- |
| 1. Purpose | Read the hero and scope | Evidence before authority | Read-only browser; separate completed payment worker |
| 2. CORE | Enter `Check Diana network.` then `Diana ağını kontrol et.` | Chain 9800, latest block, source, timestamp, executed steps | If RPC fails, show that error; never insert a sample block |
| 3. PQC | Open verifier; Load official test vector; Verify; Change one message byte; Verify | Valid original, invalid changed message | Only public-vector verification; not a newly signed transaction |
| 4. Payment | Inspect 3/3 rows and contract; open snapshot; optionally Recheck on Diana | Actual receipts/events, nonce 3, total 0.003 QOR, archived final balance 0 | Current read has its own time/result. Explorer absence is not RPC failure |
| 5. Decision | Select historical payments; inspect decisive check and source | BLOCK for used nonce or total limit; ALLOW/BLOCK/WAIT/UNKNOWN definitions | Historical post-payment re-evaluation, not a recorded pre-payment ALLOW |
| 6. AI | Show OFF and quality warning. Deliberately enable; enter `could you determine whether Diana responds`; inspect actual source/timing; disable | Real local artifact/inference or honestly labeled fallback | Never describe rules/fallback as model inference. If loading fails, use published measurements as dated evidence |
| 7. Safety | Enter `Perform a token swap on my behalf.` | Refused, stages not run | No swap is executed. Linked tests count zero classifier/RPC calls, including with AI opted in |

For all four Decision Engine outcomes, open the linked
[policy tests](../tests/decision-engine.test.mjs) or run
`node --test tests/decision-engine.test.mjs`. Those deterministic fixtures are labeled
test scenarios, not fabricated chain observations. Do not modify the engine or inject
an ALLOW into the historical card for the video.

If the current live read is unavailable, narrate “the endpoint could not be read now;
this is archived verification from 21 November”, and show the separate dated report.
Do not present an old successful timestamp as a new RPC result. No payment, funding,
signing or deployment should be attempted while presenting this demo.

## Evidence index

Repository: https://github.com/satoshi-Qore/ela

Demo: https://satoshi-qore.github.io/ela/

Existing project link: https://build.qorechain.io/p/ela-execution-logic-agent
(present in the repository badge; platform page content/form status was not independently
confirmed by the web reader during preparation).

| Evidence | Source |
| --- | --- |
| Completed live run, delays and controlled recovery | [21 November report](DIANA-LIVE-20261121.md) |
| Canonical final state and three receipt/event records | [Public JSON](evidence/diana-live-20261121/final-chain-state.json), [UI snapshot](../src/payment/evidence.json) |
| Verification boundaries and real prior RPC observations | [Payment evidence](PAYMENT-ACCOUNT-EVIDENCE-20261122.md), [22 November read report](DIANA-LIVE-VERIFICATION-20261122.md) |
| On-chain invoice/policy enforcement | [Solidity source](../prototypes/diana-payment-account/src/DianaPaymentAccount.sol) |
| Scoped payment window and registered native identity | [Preserved recovery checkpoint](evidence/diana-live-20261121/receipt-race-blocked-state.json) |
| Earlier PQC registration and hybrid transaction | [Registration](../prototypes/diana-payment-account/DIANA-PQC-REGISTRATION.md), [hybrid transaction](../prototypes/diana-payment-account/DIANA-HYBRID-TX.md) |
| Public signature vector provenance | [Official vector source](../tests/vectors/qorechain-pqc/SOURCE.md) |
| Four decision outcomes and no execution authority | [Engine tests](../tests/decision-engine.test.mjs), [design](DECISION-ENGINE.md) |
| Actual model, pinned identity and quality failure | [Model card](AI-INTELLIGENCE.md), [06B research](AI-ACCURACY-06B.md) |
| Refusal before model/RPC | [06C note](SAFETY-GATE-06C.md), [counting tests](../tests/safety-gate.test.mjs) |

Contract: `0x127dd577174e8829a38AE6885bfe058855C04601`.

| Payment | Sent, 21 November (Istanbul, UTC+03) | EVM transaction hash |
| --- | --- | --- |
| 1 | 06:40:21 | `0x93ad86e777f5afef32f607336586d927c3ecda4d198c3ce3405ae2e5e624569b` |
| 2 | 06:41:42 | `0x2ddba43246a070ab6a969ef6ca64d77be1755f4d0f2edc1b1d097ed71854d4a9` |
| 3 | 06:44:58 | `0xdc549e462e1946f129d3e8dc800b857a22808f588afc464149827dec8ecb1e4b` |

Deployment: `0x3a2722d545b635e92023e1740897d414d3ccf1ba1e56865db97137e30c1e91e4`.
Funding: `0x478f47a7c713eb4cd54915f01ecfb59e6fc6b40d1d1aacab7908f1c77fffef7f`.
Recorded native testnet account:
`qor1dfw567en2l0edze2xqzqw8kwnrcpt3u5m9n88r` (public window checkpoint above).
Use this existing public identity for form review; this task does not connect a wallet.

## Features and limitations

Operational: guarded reads, local vector verification, archived completed payments,
explicit current receipt rechecks, deterministic policy explanations and pre-model
safety refusals. Experimental: the opt-in learned classifier. ALLOW is not authority.

Historical model/rule result: 266/307 with 10 false accepts versus 287/307 with zero.
The rejected 06B candidate scored 245/307 with one false accept; on its new 307-item
holdout, 193 with four false accepts. No accuracy promotion followed. Closing four
gate recognition gaps does not improve the learned weights or rewrite those results.

Published Chrome 157 / Ubuntu loopback study: deployed artifact 185,233 bytes,
4 ms load, 0.8 ms maximum inference. Combined old/candidate study sampled extra heap
was 11,357,468 bytes; it is not isolated model memory or a peak guarantee. These are
dated observations, not today's device latency. The 13 KiB main-JS gzip reference
remains unmet. Browser data depends on RPC availability/CORS and explorer indexing
may lag. Existing payment targets were delayed and required controlled recovery with
zero payment resubmissions; the report preserves that history.

## Verified official requirements and checklist

Checked 22 November 2026. The organiser warns conditions may change; recheck sources
before the deadline. This is a preparation checklist, not a claim of acceptance.

Sources: [Rules](https://build.qorechain.io/rules),
[Start here](https://build.qorechain.io/start),
[Prizes/category conditions](https://build.qorechain.io/prizes),
[official overview](https://docs.qorechain.io/build-before-qday/overview/).

The current deadline is **2 December 2026, 23:59 UTC** (3 December, 02:59 Istanbul).
The Start page says there is no separate submit button: the saved project freezes
at the deadline. Public repo, permissive licence, README, testnet addresses and a
working video up to three minutes are required. Rules list a featured image; Start
allows an automatically generated cover. Verify the actual platform checklist.

- [x] Public repository link and MIT licence available.
- [x] Updated project description, architecture, evidence index and limitations prepared.
- [x] Demo instructions and sub-three-minute English narration prepared below.
- [x] Existing native/EVM testnet identities and transaction evidence identified.
- [ ] Owner confirms all members are 18+ and completed GitHub/X/QoreX registration.
- [ ] Owner reviews saved project name, description, How it's made, demo/repo links and country.
- [ ] Confirm actual category and its specific technical eligibility with the organiser.
- [ ] Confirm platform kit detection; select only code-backed features.
- [ ] Record, review and upload a working video of at most three minutes; add its URL.
- [ ] Review featured image or generated cover; custom format: 16:9, at least 1200×675,
  JPG/PNG/WebP, at most 5 MB. No cover upload was made by this task.
- [ ] Merge/deploy this PR, verify Pages and rehearse with current network conditions.
- [ ] Confirm all fields are saved before the deadline. No final platform update was sent here.

The Post-Quantum AI Agents category currently lists a scoped EVM window,
transaction/value/duration/target limits, smart-account spending rules and authenticated
messaging (teams of 1–4). ELA has real scoped-window and contract-policy evidence,
including ML-DSA invoice authentication. Whether the organiser accepts that contract
as the required smart-account implementation or invoice authentication as authenticated
messaging is **not established**. A separate authenticated messaging kit or general
account-abstraction implementation is not claimed. Do not tick unverified features
or claim category compliance solely because a browser verifies a public signature vector.
No new architecture is added to satisfy a checklist by assertion.

## English video script and scene plan

Draft only. No recording was made or uploaded. Target about 2:50 at roughly
125–135 words/minute; rehearse and trim pauses to remain under the official three-minute cap.
Use the actual interface and existing evidence, never a simulated payment animation.

| Time | Scene | Narration |
| --- | --- | --- |
| 00:00–00:15 | Hero; expand Guided demo | “This is ELA, the Execution and Logic Agent for QoreChain Diana. ELA separates understanding a request, verifying evidence and having permission to act. This browser is read-only; a model never controls a wallet.” |
| 00:15–00:40 | CORE: EN/TR network commands; source and block | “I can ask in English or Turkish. ELA checks chain ID 9800 before reading the latest block. The trace shows what ran, its source and its time. If the endpoint cannot be read, the interface reports that failure instead of inventing a result.” |
| 00:40–01:00 | PQC: official vector valid, changed byte invalid | “Here the browser verifies an official ML-DSA-87 public test vector. The original passes. Change one message byte and the same signature fails. This is local verification, not a newly signed blockchain transaction.” |
| 01:00–01:35 | Payment rows, contract, snapshot, explicit recheck | “On November twenty-first, ELA's separate bounded payment worker completed three real payments of zero point zero zero one QOR. Here are the contract, hashes, receipts and events. The run required controlled receipt-read recovery, with no payment resubmission. These are dated facts. Rechecking Diana is read-only: current verification has its own timestamp, and failure leaves the archive clearly separate.” |
| 01:35–01:57 | Decision: historical BLOCK and linked four-outcome tests | “The Decision Engine explains policy checks as ALLOW, BLOCK, WAIT or UNKNOWN. These historical post-payment states block replay because the nonce or budget is already used. Linked tests demonstrate all four outcomes. An ALLOW assessment never grants transaction authority.” |
| 01:57–02:27 | AI OFF/warning; explicit trial, real source/timing; OFF again | “This is a real learned local classifier, loaded and hash-checked only when needed after opt-in. It can only return closed intent labels. Its quality is not good enough: the historical test had ten false accepts. We kept it disabled and rejected a worse candidate. Measured Chrome performance and limitations are public. Rules and fallback are never labeled as model inference.” |
| 02:27–02:50 | Safety refusal; linked tests; end on guide | “Finally, I request a token swap. ELA refuses at the safety gate before classification or RPC. Regression tests assert both call counts are zero, even with AI opted in. The result is a demonstrable boundary: public evidence, explicit policies and no model authority to spend.” |

If the live endpoint is unavailable, replace the live-success narration with the actual
failure and open the dated report. If model loading fails, show fallback explicitly
and cite the published real-inference recording in CI logs; do not call the current
fallback a model demonstration. A final video should show at least one actual model
inference only if it succeeds during recording, otherwise disclose that omission.
