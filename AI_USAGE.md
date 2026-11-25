# AI Usage in ELA

Documentation date: 23 November 2026. This document describes the implementation and preserved research evidence in this repository. It does not certify competition eligibility, announce model promotion, or report a new benchmark run. Only this document was created for this task; no tests, builds, training, inference, network transactions or publication were performed.

## Overview

ELA (Execution & Logic Agent) is a bilingual, read-only QoreChain Diana agent with deterministic safety and execution boundaries. The learned component investigates whether unfamiliar Turkish and English phrasings can be mapped to an existing, closed intent vocabulary more flexibly than the conservative rule lexicon.

A real learned model is integrated and has run in real Chrome, but its quality gate failed. AI is OFF by default. The normal product therefore uses deterministic routing and the rule classifier. Users can explicitly enable an experimental local inference trial; this does not enable transaction execution.

The project also presents PQC verification, dated evidence of three completed payments and deterministic policy explanations. Those features are not themselves AI inference. See the [project overview](README.md), [AI implementation report](docs/AI-INTELLIGENCE.md) and [demo/submission pack](docs/DEVELOPER-FEST.md).

## Actual AI Implementation

| Property | Implemented value |
| --- | --- |
| Identity | ELA Intent Linear 1.0.0 |
| Algorithm | Original supervised linear softmax classifier over hashed word, word-bigram and character 3–5-gram features |
| Feature space | 4096 dimensions; normalized sparse features |
| Learned parameters | Six weight vectors of 4096 values and six biases |
| Training | Fixed-order cross-entropy stochastic gradient descent, 500 epochs, 120 bilingual training phrases |
| Initialization / export | Zero-initialized training weights; JSON export rounded to seven decimal places; browser weights stored as Float32Array |
| Artifact | [public/models/ela-intent-linear-v1.json](public/models/ela-intent-linear-v1.json), 185233 bytes (about 180.9 KiB) |
| SHA-256 | `296c79b3b2fa7e7238a08ea33643945d5a16c8d95cd2e762e6e81b660ffd5e18` |
| License | MIT; [model license](public/models/LICENSE) |
| Inference | Local JavaScript in the browser, using loaded learned weights |
| Default | Disabled; per-page explicit opt-in, not a persisted preference |

The artifact length and SHA-256 above were checked by reading the local file during documentation preparation. This was an integrity check, not a model execution or benchmark.

The [manifest](src/ai/manifest.json) pins the identity, artifact, license and training metadata. [src/ai/linear.ts](src/ai/linear.ts) implements `features` and `createLinearModel`; [scripts/train-intent-model.mjs](scripts/train-intent-model.mjs) implements training from [scripts/ai-training-data.mjs](scripts/ai-training-data.mjs). The recorded training-row SHA-256 is `67d2e6b6d6737e37c6abb2ad133c4f76e73cf7c229a0d87c6b0bef9d175ee34d`.

This is not an LLM, Transformer, generative model, pretrained fastText checkpoint or regex classifier. No third-party pretrained weights are used by this model. Earlier external-model experiments credited in the README are not the deployed inference implementation. Learned matrix scoring is distinct from the separately implemented deterministic lexicon.

## AI's Role in ELA

The model receives one normalized command string, without conversation context or runtime callbacks. It returns label/score candidates for exactly:

`network_check`, `block_number`, `follow_up_repeat`, `follow_up_current`, `unsupported`, `unknown`.

The contract does not allow it to output a tool name, network, RPC method, recipient, amount, transaction parameters or execution authorization. Follow-up labels are resolved against context by deterministic code after classification; the model does not read or modify that context.

Explicit deterministic routes are evaluated first. Parameterized balance, transaction, block, token and fee recognition remain deterministic rather than being added to the model's six labels. If classification is needed, the session chooses rules or the optional local runtime. When AI is disabled, rule output is not called AI inference. When an artifact cannot be loaded, fallback is also labeled separately. The UI compares the model's top label with a rule reference without displaying the command in model statistics: [controller](src/ai/controller.ts), [AI panel](src/ai/intelligence.ts).

## Inference Architecture

User Input → Safety Gate → Deterministic Routing → Optional Local AI → Intent Validation → Read-Only Tool Registry.

This describes the classification path, not a requirement to call the model for every input. Input validation and a guarded transaction-hash recognition/confirmation path also precede classification. Refused, deterministic or confirmation-pending requests do not need model inference.

| Stage | Source and responsibility |
| --- | --- |
| Session entry and classifier selection | [src/agent/session.ts](src/agent/session.ts), `createSession`, `handleCommand`; selection and runtime-unavailable rule fallback belong to the session |
| Input and Safety Gate | [src/agent/intent.ts](src/agent/intent.ts), `interpretCommand`, `assessRisk`; risky requests are refused before any classifier or RPC call |
| Deterministic interpretation | `interpretCommand` and the existing route/parameter/follow-up recognizers; these can finish without a classifier |
| Rule classifier | [src/agent/lexicon.ts](src/agent/lexicon.ts), `ruleClassifier`; deterministic lexicon, no learned weights |
| Optional learned classifier | [src/ai/controller.ts](src/ai/controller.ts), `classify`, `setEnabled`; lazy same-origin artifact loading and provenance reporting |
| Artifact/model boundary | [src/agent/model-contract.ts](src/agent/model-contract.ts), `createModelClassifier`, `verifyModelArtifact`; size/hash checks, withholding, load fallback and inference time budget |
| Closed output validation | [src/agent/intent.ts](src/agent/intent.ts), `decideIntent`; strict labels/fields/scores, confidence and margin, deterministic query mapping |
| Read-only execution | `actOnDecision` and [src/agent/registry.ts](src/agent/registry.ts); fixed registered tools and guarded Diana reads |

The provisional, uncalibrated default thresholds are confidence 0.75 and top-score margin 0.2. Low confidence, close scores, invalid output, missing context or inference failure leads to clarification instead of a guessed query. Softmax confidence is not proof of correctness.

The [Decision Engine](src/decision/engine.ts), `evaluatePayment`, is independent and deterministic. It consumes explicit policy/facts/time and always returns `executionAuthorized: false`. Its [historical explanations](src/decision/history.ts) use post-payment archive facts; these are not recorded AI decisions that caused payments. The completed payment worker is separate from the browser and does not call this classifier to choose payments.

## Training and Evaluation

### Data separation and selection

For 06A, the deployed model was trained on 120 phrases with fixed settings. The training script excludes normalized exact matches from the existing evaluation material. The implementation report records no held-out hyperparameter search. Exact text exclusion is not proof of semantic independence or real-world generalization.

The 06B study retained those 120 phrases and added 250, producing 370 training rows. A separately authored 72-example development set (12 per label) selected among nine fixed configurations: 150/350/700 epochs and temperature 1/1.5/2. Features, learning rates, regularization and session thresholds were retained. Selection prioritized fewer false accepts, fewer gate misses, fewer over-refusals, more correct results, then fixed grid order.

The selected configuration was 150 epochs / temperature 2: 54/72 correct and 3 false accepts on development. None of the nine trials achieved zero development false accepts. Its research artifact was 233464 bytes, SHA-256 `592f31efb3966feb737070aa6b7dc56ec13cc452cbe08081ff275eddbb2464c0`; it was not installed in `public/models` or referenced by the production manifest.

The new final set contained 307 frozen synthetic examples: 154 Turkish / 153 English; 160 safe requests, 40 contextual follow-ups, 40 ambiguous requests, 30 unsupported requests, 20 risky requests and 17 spelling variants. It was excluded from fitting and selection. Serialized-item SHA-256: `d3ce03945e4b1ec309804125a9ad9a1c14c4f0ddf117c25d106dd9a9b07e1c8f`.

“Independent” here means separate from training/model selection, not independently collected or externally audited: the same contributor authored the examples. Normalized exact disjointness is checked; shared vocabulary and similar structures remain. This now-public holdout must not be reused as unseen data in later selection. Historical 307 results were already observed before 06B and serve as regression results, not a new independent final evaluation.

### 06A preserved results — historical 307

These are complete-session pipeline measurements, not raw softmax accuracy. The Node and real Chrome records agreed. Mock read-only transport was used for evaluation, not real chain actions.

| Scope | Rules correct | Learned model correct | False accepts: rules / model | False rejects: rules / model |
| --- | ---: | ---: | ---: | ---: |
| All 307 | 287 | 266 | 0 / 10 | 20 / 31 |
| Turkish 152 | 140 | 131 | 0 / 4 | 12 / 17 |
| English 147 | 141 | 128 | 0 / 6 | 6 / 13 |

The remaining eight mixed-language examples are included in the total. Recorded gate misses were zero for both modes on this corpus. Sources: [06A Node JSON](docs/evidence/local-ai-v1/node-evaluation.json), [06A Chrome JSON](docs/evidence/local-ai-v1/chrome-evaluation.json), [06A report](docs/AI-INTELLIGENCE.md).

### 06B preserved results — same metrics, separate sets

| Set | Classifier | Correct | False accepts | False rejects | Gate misses |
| --- | --- | ---: | ---: | ---: | ---: |
| Historical 307 | Default rules | 287 | 0 | 20 | 0 |
| Historical 307 | Deployed learned model | 266 | 10 | 31 | 0 |
| Historical 307 | Rejected candidate | 245 | 1 | 61 | 0 |
| New independent 307 | Default rules | 91 | 0 | 212 | 4 |
| New independent 307 | Deployed learned model | 231 | 10 | 62 | 4 |
| New independent 307 | Rejected candidate | 193 | 4 | 106 | 4 |

A false accept means a wrong query ran, including a wrong read-only query; it does not mean a payment or state-changing tool ran. A false reject is an expected read that did not run. Gate misses are risky requests not explicitly refused; they are a separate metric and need not be an RPC execution. On the four 06B gate misses, all modes clarified or returned unsupported with zero RPC calls. Metric columns are not an exclusive partition of all outcomes.

On the new set, Turkish results were 118/154 (deployed) versus 96/154 (candidate), with 6 versus 2 false accepts. English results were 113/153 versus 97/153, with 4 versus 2 false accepts. The new set deliberately contains unfamiliar longer paraphrases, so cross-set percentages cannot establish a regression or improvement; compare modes within the same set.

The candidate reduced false accepts by rejecting more reads, but failed the internal target of at least 290/307 correct with zero false accepts. It was rejected; deployed weights and OFF default were retained. High-confidence historical mistakes (accepted scores up to 0.9908) demonstrate that these scores are not calibrated probabilities. Sources: [06B report](docs/AI-ACCURACY-06B.md), [Node summary](docs/evidence/ai-accuracy-06b/node-summary.json), [Chrome record](docs/evidence/ai-accuracy-06b/chrome-evaluation.json) and [error records](docs/evidence/ai-accuracy-06b/).

### 06C is a gate repair, not an AI accuracy improvement

[06C](docs/SAFETY-GATE-06C.md) repaired four Turkish/English staking, approval and swap recognition gaps with deterministic request-form rules and safe contrasts. Its regression tests require refusal before classification, zero classifier calls and zero RPC. Historical model/evaluation files were preserved. Current full-session totals can gain four correct refusals due to this gate revision; that does not establish better learned inference, retraining or a passed quality target. This document reports the archived 06A/06B counts without silently updating them.

## Runtime and Performance

These are preserved real headless Chrome measurements on GitHub Actions Linux/Ubuntu with localhost/loopback artifact transfer. They are not Windows measurements from this documentation task, mobile device results, cellular download timings or end-user latency guarantees.

| Study | Artifact | Recorded load | Maximum recorded inference | Memory observation |
| --- | ---: | ---: | ---: | --- |
| 06A, deployed model | 185233 bytes | 7 ms | 1 ms | Sampled extra JS heap 5455640 bytes (about 5.20 MiB) |
| 06B, deployed model | 185233 bytes | 4 ms | About 0.8 ms | Shared study heap observation below |
| 06B, rejected candidate | 233464 bytes | 3 ms | About 0.4 ms | Shared study heap observation below |

06A first-ready wall time was 25.14 ms. Its Chrome version was 157.0.8103.78; record: [06A Chrome JSON](docs/evidence/local-ai-v1/chrome-evaluation.json), linked run 45026049008. The separate 06B record identifies Chrome 157.0.8103.78, run 45048349652; both models performed actual inference with zero fallback calls. Its combined sampled extra JS heap was 11357468 bytes (about 10.83 MiB), including study allocations. This is not per-model memory and not a guaranteed peak. JS heap is not total browser/native process memory.

[MODEL_BUDGET](src/agent/model-contract.ts) remains 40 MiB artifact, 15000 ms loading, 1500 ms inference and 300 MiB extra JS heap. The recorded model measurements fit these references, subject to the sampling limits. The separate pre-existing 13 KiB main-JS gzip reference was not met: the 06A Chrome record reports 13872 bytes versus 13312; the 06A report separately records a final local bundle at 15517 gzip bytes. Those are different builds, not contradictory measurements of one artifact. No claim is made that all acceptance targets passed, nor that these historical bundle sizes describe today's build.

## Privacy and Security

- Inference is local. The controller fetches only a same-origin pinned model file using GET with credentials omitted and redirects rejected. Command text is not included in that request. There is no remote AI inference service in this path. Successful read-only tools still contact Diana RPC; “local AI” does not mean all application networking is offline.
- The model receives normalized text only, not conversation context, tool callbacks, wallet objects, addresses, keys or previous query results. Input guards and the [model wrapper](src/agent/model-contract.ts) withhold key/address/long-hex/seed-like and risky text. The controller additionally withholds email, URL and long phone-like patterns. Pattern filters are defense in depth, not a guarantee that arbitrary prose contains no personal information; users should not enter secrets.
- The Safety Gate runs before classifier inference. Existing [Safety Gate tests](tests/safety-gate.test.mjs) and [model contract tests](tests/model-contract.test.mjs) cover refusal and call-count boundaries; [06C documentation](docs/SAFETY-GATE-06C.md) describes the four repaired regressions and safe contrasts. Test fixtures and fake RPC counters are not live network results.
- The loader bounds size and verifies SHA-256 before initializing weights; the model-contract wrapper also checks integrity. Artifact/loading/hash failure or unavailable optional runtime uses deterministic fallback. An inference error/timeout is handled as clarification upstream rather than being treated as permission to run a query. Low-confidence, malformed or ambiguous output also clarifies.
- Neither model nor browser agent has payment, funding, deployment, signing or state-changing execution authority. The model cannot select a network or RPC method. The separate existing payment automation is not exposed to it, and its historical payments are not on-chain AI decisions.

These boundaries reduce the consequences of classification errors; they do not make wrong read-only acceptance correct, prove universal prompt understanding or justify default activation.

## AI-Assisted Development and Human Contribution

AI used in the product and AI used while developing the product are different claims. The [README credits](README.md#license-and-credits) explicitly state that AI assistance was used during development and testing. The repository contains inspectable implementations, training/evaluation scripts, tests, negative findings and the decision to retain a safe default. These are the available outputs against which claims can be reviewed.

The local evidence reviewed here does not provide a complete prompt/session archive, per-file attribution of AI-generated versus manually written work, assistant product/version history, or quantified human/AI contribution. This document therefore does not assign an invented percentage, identify an unverified tool, claim that a particular contributor personally wrote every training phrase, or declare all generated work manually reviewed.

The project owner defines product scope and permitted actions, supplies/reviews the submission narrative and remains responsible for final acceptance and publication. Recorded engineering decisions include explicit failed-quality disclosure, candidate rejection, preserving deterministic authority and leaving AI OFF. These decisions and the checked-in evidence are reviewable; they do not establish who authored every line or precisely which review steps were performed by a human. If the award requires a detailed human-versus-generated-work ledger, the owner must supplement this statement from actual development records. A runtime-model card alone cannot substantiate that missing provenance.

## Limitations

- A real model exists and has executed successfully; its generalization and confidence reliability remain insufficient.
- Neither the deployed model nor the rejected candidate passed the stated accuracy/safety promotion target. Passing engineering tests is not model-quality approval.
- AI remains disabled by default. Explicit opt-in permits only an experimental local classifier trial; a category decision would not authorize enabling it by default.
- This is not general-purpose chat, a generative assistant or an autonomous payment model. Its vocabulary is six labels; most product authority remains deterministic.
- Decision Engine rules and Safety Gate improvements are not learned AI inference.
- Evaluation sets are authored synthetic material; exact-match separation does not establish broad independent validation. Real mobile model-performance evidence is not provided.
- The complete AI-assisted development attribution ledger is unavailable in the reviewed evidence. Competition acceptance and required disclosure depth remain organizer decisions.

## Reproducibility and Evidence

### Sources and datasets

- Runtime: [manifest](src/ai/manifest.json), [linear model](src/ai/linear.ts), [controller](src/ai/controller.ts), [AI panel](src/ai/intelligence.ts), [model artifact](public/models/ela-intent-linear-v1.json), [MIT license](public/models/LICENSE).
- Boundaries: [session](src/agent/session.ts), [model contract](src/agent/model-contract.ts), [intent gate/validator](src/agent/intent.ts), [rule lexicon](src/agent/lexicon.ts), [registry](src/agent/registry.ts), [Decision Engine](src/decision/engine.ts).
- 06A training/evaluation: [training phrases](scripts/ai-training-data.mjs), [trainer](scripts/train-intent-model.mjs), [evaluator](scripts/evaluate-local-model.mjs), [307-item corpus](tests/model-eval-set.mjs), [Turkish set](tests/intent-eval-set.mjs), [English set](tests/intent-eval-set-en.mjs), [held-out set](tests/intent-heldout-set.mjs), [measurement helper](tests/model-eval-report.mjs).
- 06B: [training/development corpus](scripts/accuracy/corpus.mjs), [trainer/selector](scripts/accuracy/train.mjs), [evaluator](scripts/accuracy/evaluate.mjs), [measurement helper](scripts/accuracy/measure.mjs), [frozen final corpus](tests/fixtures/accuracy-final.mjs).
- Tests to inspect: [real local AI](tests/local-ai.test.mjs), [accuracy study](tests/ai-accuracy.test.mjs), [model contract](tests/model-contract.test.mjs), [Safety Gate](tests/safety-gate.test.mjs), [agent session](tests/agent-session.test.mjs), [browser/UI characterization](tests/ui-characterization.test.mjs).
- Preserved results: [06A Node](docs/evidence/local-ai-v1/node-evaluation.json), [06A Chrome](docs/evidence/local-ai-v1/chrome-evaluation.json), [06B Node summary](docs/evidence/ai-accuracy-06b/node-summary.json), [06B Chrome](docs/evidence/ai-accuracy-06b/chrome-evaluation.json), [06B per-example errors](docs/evidence/ai-accuracy-06b/).
- Reports: [06A](docs/AI-INTELLIGENCE.md), [06B](docs/AI-ACCURACY-06B.md), [06C](docs/SAFETY-GATE-06C.md), [Decision Engine](docs/DECISION-ENGINE.md), [Developer Fest pack](docs/DEVELOPER-FEST.md). Local-only context: the category-eligibility review and final-submission audit are unpublished local audit records and are not included in the publication of this document.

### Commands verified by source inspection, not executed for this document

[package.json](package.json) requires Node >=24.6.0; the 06A reference runtime was Node 24.18.0. Existing commands include:

```sh
# Evaluate the deployed model and rules in Node (not a Chrome benchmark):
node scripts/evaluate-local-model.mjs

# Relevant tests, including the existing browser/UI suite:
node --test tests/model-contract.test.mjs tests/local-ai.test.mjs tests/ai-accuracy.test.mjs tests/safety-gate.test.mjs tests/ui-characterization.test.mjs

# Full repository checks:
npm test
npm run build
```

Those commands are references for a separately authorized validation session. Current results may differ from historical full-session counts because 06C repaired the gate. Real Chrome requires the existing test environment; Node evaluation alone cannot substitute for it.

Training commands are documented for reproducibility only, not instructions to run in this documentation task:

```sh
# Recreates/overwrites the deployed artifact AND manifest; use only in a disposable copy:
node scripts/train-intent-model.mjs

# Research-only candidate selection, writes .accuracy-work; does not promote weights:
npm run ai:study:train
# Requires the frozen candidate/selection files above:
npm run ai:study:evaluate
```

The research evaluator has an explicit `--write-evidence` mode that overwrites versioned evidence; it is intentionally not part of these reproduction instructions. Preserve the historical JSON files. No command above was run to prepare this document, and no historical CI result is represented as a new pass.

## AI-Native Category Relevance

ELA has a concrete learned inference implementation, pinned/licensed weights, local privacy boundaries, reproducible training/evaluation sources and real browser measurements. These are technical grounds for an organizer to evaluate its actual AI use, rather than a claim based solely on a rule engine or an unexecuted model integration.

Its role in the default product is limited: the model is disabled, deterministic routes still take precedence after opt-in, and the learned component cannot execute chain actions. The study records negative results openly. AI-assisted development is disclosed separately above, with gaps in detailed contribution attribution.

The locally preserved competition review treats AI-Native as a separate declaration/award condition, including an `AI_USAGE.md` disclosure; it must not be conflated with Post-Quantum AI Agents technical eligibility. Official requirements were not fetched again in this local-only documentation task. This file addresses the missing disclosure document, but does not prove that its contents satisfy every organizer requirement or that any platform field was updated.

Organizer confirmation remains necessary on (1) whether the limited opt-in classifier role is sufficient, (2) whether additional development-workflow/generated-work/human-contribution evidence is required, and (3) the separate category interpretation of custom spending policies and signed invoices. The custom contract is not claimed to be native SpendingRule usage; signed invoices are not automatically claimed to satisfy authenticated messaging, and browser PQC verification is not on-chain AI authorization.

This document has not been submitted or published by this task. No award eligibility, acceptance or completed submission is asserted.
