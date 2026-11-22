# 06 — Local AI Intelligence: ELA Intent Linear 1.0.0

Status: the real learned candidate was loaded, SHA-verified and executed in real headless Chrome. It is integrated as an explicit opt-in experiment, NOT promoted to default. Production still starts with the existing deterministic classifier. Chrome evidence is versioned at docs/evidence/local-ai-v1/chrome-evaluation.json; the full UI test emits reproducible measurements as ELA_REAL_MODEL_CHROME.

## Model selection and identity

Research compared the [Model2Vec model family](https://github.com/MinishLab/model2vec), [potion-base-2M](https://huggingface.co/minishlab/potion-base-2M) (MIT, small but English-oriented), and the efficient learned text-classification approach described in [Joulin et al., Bag of Tricks for Efficient Text Classification](https://arxiv.org/abs/1607.01759), alongside the [fastText reference implementation](https://github.com/facebookresearch/fastText). A small English embedding model is not evidence of Turkish intent quality, and large multilingual embeddings are a poor fit for a 40 MiB starting budget. No untested external checkpoint is claimed as loaded.

The selected candidate is **ELA Intent Linear 1.0.0**, an original supervised learned softmax classifier over hashed word/bigram/character 3–5-gram features. It is NOT a Transformer, generative LLM, fastText checkpoint or regex lexicon, and uses no third-party pretrained weights. The algorithm is in the efficient bag-of-features linear-classification family; no fastText library code is copied. All 6 x 4096 learned weight values and six biases are trained by fixed-order cross-entropy SGD for 500 epochs on 120 original bilingual phrases. The browser performs real matrix/feature inference from these trained weights. Scope is six intent labels only, not general language understanding.

- License: MIT, including the explicitly versioned model license at public/models/LICENSE.
- Artifact: public/models/ela-intent-linear-v1.json, **185233 bytes** (about 180.9 KiB).
- SHA-256: `296c79b3b2fa7e7238a08ea33643945d5a16c8d95cd2e762e6e81b660ffd5e18`.
- Manifest: src/ai/manifest.json, schema version 1, model version 1.0.0.
- Training source: scripts/ai-training-data.mjs; fixed feature/training implementation in src/ai/linear.ts and scripts/train-intent-model.mjs. Reference runtime: Node 24.18.0.
- Training-row SHA-256: `67d2e6b6d6737e37c6abb2ad133c4f76e73cf7c229a0d87c6b0bef9d175ee34d`.
- All existing model/TR/EN/heldout evaluation texts are excluded from training by normalized exact match. No hyperparameter tuning on heldout results was performed. Exact-match exclusion does not establish broad-domain generalization.
- Reproduce with `node scripts/train-intent-model.mjs`; evaluate in Node with `node scripts/evaluate-local-model.mjs`. The artifact is marked -text in .gitattributes to keep SHA bytes stable on Windows checkouts.

## Boundary and loading

The existing session, intent gate, deterministic routes, closed-label validator and registry remain in charge. web.ts passes a text-only lazy classifier delegate into the existing createSession API. In disabled mode the delegate calls the existing ruleClassifier. Only an explicit per-page trial toggle enables the real model; no preference is persisted. AI sees no context, previous result, registry callback, key or wallet object. The existing model-contract wrapper withholds risky/private-looking text before loading; an additional conservative filter withholds emails, URLs and long phone-like strings. This pattern filtering is defense in depth, not a guarantee that arbitrary prose is devoid of personal information.

Weights are fetched only when a safe, non-deterministically-routed command needs classification. The request is GET to the same-origin pinned model file, with no command text, credentials or redirects. Size is bounded while streaming, SHA-256 is checked before parsing/initializing weights, and the existing wrapper independently verifies it again. The model returns exactly the six existing label/score pairs; the existing validator handles confidence, margin and malformed results before the registry. Failed artifact loading uses the existing deterministic fallback; failure of the optional JS runtime also uses the already loaded rule classifier, while an inference error still clarifies upstream. Failed/uncertain inference yields clarification rather than model-directed execution. No remote inference service, signing, new tool, payment or automation path is added.

06 shows the real identity/version/license/hash, disabled/loading/ready/fallback states, last measured timings and model label versus the rule reference. It explicitly calls the source model, fallback or withheld; a deterministic query is never presented as AI inference. CORE/PQC, module 04, module 05, dated evidence, Decision Engine and automation implementations are unchanged.

## Accuracy: candidate NOT eligible for default activation

The existing model evaluation set combines the existing Turkish/English/heldout material and explicit unknown/unsupported/follow-up/typo/adversarial/mixed groups. Node measurements (NOT Chrome measurements) are versioned in docs/evidence/local-ai-v1/node-evaluation.json. This is full pipeline evaluation through the existing safety/intent/registry boundary, with fake read-only RPC results for deterministic evaluation, not real chain actions.

| Set | Rules correct | Model correct | False accepts, rules / model | False rejects, rules / model | Gate misses |
|---|---:|---:|---:|---:|---:|
| All (307) | 287 | 266 | 0 / 10 | 20 / 31 | 0 / 0 |
| Turkish (152) | 140 | 131 | 0 / 4 | 12 / 17 | 0 / 0 |
| English (147) | 141 | 128 | 0 / 6 | 6 / 13 | 0 / 0 |

The remaining 8 mixed-language examples are included in the all total. Risky commands remain gated, but the candidate makes more wrong read-only accepts and rejects. It has NOT demonstrated meaningful improvement and is deliberately OFF by default. Its opt-in experiment remains subject to all safety checks; it is not a quality endorsement. A production-quality generalization improvement remains uncompleted. The result was not hidden by tuning thresholds, using evaluation text as training data, raising model budgets or relabeling a rule engine as learned inference.

## Actual Chrome measurements

Real headless Chrome on a GitHub Actions Linux runner loaded the exact artifact over a cold loopback connection, verified it and executed the complete 307-item pipeline in both modes. Load was **7 ms**, first-ready wall time **25.14 ms**, worst recorded wrapper inference **1 ms**, and sampled peak extra JS heap **5455640 bytes / 5.20 MiB**. These meet the artifact/load/inference/JS-heap limits. They are desktop runner measurements, not Redmi/mobile WAN measurements. Chrome accuracy exactly matched the Node counts above. Its risky 107-item group had zero gate misses in both modes; unknown/unsupported/adversarial false accepts remain explicitly reported. No default promotion is justified.

## Budgets and validation

MODEL_BUDGET constants are unchanged: 40 MiB artifact, 15 s load, 1.5 s inference, 300 MiB extra JS heap. Chrome UI tests perform a cold same-origin model transfer, actual hash verification and inference, per-language/group pipeline evaluation, sampled JSHeapUsedSize, safe gate/private-data withholding, and artifact-unavailable fallback. They emit load, first-ready wall time, worst last-inference timing and sampled peak extra JS heap. JS heap is not total native browser memory, and loopback transfer does not establish mobile WAN download performance.

The legacy MODEL_BUDGET main-JS reference is 13 KiB gzip. Main already exceeded it before this task (about 15.46 kB gzip); the recorded benchmark build measured 13872 bytes gzip. The final build retains an already available static rule fallback even if the optional runtime fails, measuring 15517 gzip bytes / 42372 raw bytes locally, still above 13312 bytes. This older MODEL_BUDGET reference is NOT raised or reported as met. The separate existing UI raw-size regression ceiling moves explicitly from 41.25 to 41.5 KiB (132 additional raw bytes beyond the old ceiling) to include the safe runtime-failure fallback. Its gzip ceiling and all MODEL_BUDGET limits stay unchanged. The actual model runtime is a separate chunk; the PQC chunk remains unchanged. This and the accuracy regression prevent a claim that every model acceptance target is complete.

Local targeted contract/agent/PQC/real-model tests pass (136 tests); production build passes. Full CI includes real Chrome inference and the existing three-theme, desktop/mobile 200% text and CORE/PQC/04/05 checks. PR results contain the final Chrome measurements and CI counts.

No payment, funding, contract deployment, private-key use, signing, automation execution, or default AI promotion occurred.
