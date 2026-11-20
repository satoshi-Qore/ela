# ELA 7H-5 local model integration — 20 November 2026

Real weights are integrated, but this remains an **experimental candidate**, not a claim of broad intelligence or complete acceptance. Sampled page + Worker JS memory is now measured below 300 MiB in Chrome and Edge; an absolute peak and process RSS remain unverified. Keep the PR in draft pending that acceptance criterion and human review.

## Selection using existing experiments

| Candidate | Existing evidence | Decision |
|---|---|---|
| Qwen3-0.6B ONNX q8 | Prior local browser experiment: valid JSON 15/15, correct tool 5/15; mean 3284.64 ms, p95/max 4342.09 ms; load 4972.53 ms. Different, three-tool task, **not comparable** to the six-label evaluation. q8 export about 618 MB; process working set reached gigabytes. | Exceeds 40 MiB and 1500 ms budgets; not rerun or downloaded again. |
| Full potion multilingual teacher | Existing downloaded weights+tokenizer 530,985,880 bytes. | Too large; not rerun. |
| Model2Vec 16k train-int8 | Existing model+tokenizer/head/scales about 4.77 MiB; Python load 23.36 ms, p95 0.1293 ms, load working-set delta 14.34 MiB. | Smallest measured bilingual candidate with a current-regression improvement. Ported without retraining. |
| Model2Vec 32k train-int8 | About 9.23 MiB; old Python load 42.70 ms. Replaying existing real scores with current thresholds gives no regression gain. | Larger without measured benefit at unchanged thresholds. |
| Old rule+model hybrid | Old 7H-6 used confidence 0.60, margin 0.20; regression gain two commands. A later backed-up correction removed the internal-label false accept. | Do not copy tuned thresholds or old snapshot totals. Use current main and 0.75 / 0.20 unchanged. |

Sources: existing local `REPORT-7H5.md`, `results/7h6/REPORT-7H6.md`, 7H-6-Y backup report, and `ela-2i-local/events.jsonl`. These records were read, not overwritten. [Model source](https://huggingface.co/minishlab/potion-multilingual-128M), [Qwen export](https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX/tree/main/onnx), [tokenizer runtime](https://github.com/huggingface/tokenizers.js).

## What changed

`createSession()` remains the entry point. Input validation, safety gate, deterministic routes, decision validation and registry are unchanged. Its optional default classifier lazily imports the adapter; if that JavaScript import fails, the original rules remain available. Known rule decisions are preserved. Only unresolved rules pass through the existing model-contract privacy/risk filter and `createModelClassifier()`.

The packaged artifact is **5,006,176 bytes**, SHA-256 `45beb21528e52040ad5697deca3053e9f8eb610b16ee5d4f6c6df3cf83586afb`. It includes the real int8 embeddings, scales, tokenizer and learned head. SHA-256 is checked before creating the Worker and again by the existing contract. Inference runs in a module Worker with only text and closed-label output. There is no external inference service, generated fixture response, new RPC permission or model-chosen parameter.

Fetch and initialization share a deadline below 15 seconds. Responses larger than the pinned artifact are cancelled. Inference is bounded below 1500 ms; a stalled Worker is terminated, its first call asks for clarification and later calls immediately use rules. Missing/corrupt/oversized weights, unavailable module Workers and a failed adapter import are tested. No UI/Core/PQC/payment-prototype source was modified.

## Fresh measurements

| 307-item current-main regression | Rules | Rules + real local model |
|---|---:|---:|
| Correct outcomes | 287/307 (93.49%) | 288/307 (93.81%) |
| False accepts | 0/153 | 0/153 |
| False rejects | 20/154 (12.99%) | 19/154 (12.34%) |
| Turkish correct | 140/152 | 140/152 |
| English correct | 141/147 | 141/147 |
| Mixed correct | 6/8 | 7/8 |
| Safety gate misses | 0 | 0 |

Only `Diana testnet çalışıyor mu, check et.` changes from clarification to a correct read-only network check. **Gain is one mixed-language command, not a general bilingual improvement.** The 107 risky regression inputs and 61 additional attacks send no model input or unauthorized RPC request; the 61 attacks invoke the model zero times.

Independent raw-label validation: **148/180 (82.22%)**, TR **64/77 (83.12%)**, EN **63/76 (82.89%)**, mixed **21/27 (77.78%)** in Node, Chrome and Edge. At unchanged production thresholds, integrated validation gives **no improvement** over rules: both 87/180 correct, 4 false accepts/60 and 89 false rejects/120. The four validation false accepts already occur in the current rules; the old lab labels predate some now-supported read-only capabilities. They are reported unchanged, not relabeled or removed.

Python/JS parity on all 720 training and 180 validation inputs: **900/900 token sequences identical**, largest probability error **2.07e-7**. This is a cross-runtime compatibility check, not a training-set generalization claim. The initial parity tool incorrectly decoded UTF-8 input in Python; that tool failure was diagnosed and fixed with Python UTF-8 mode. Existing lab scripts already used UTF-8 and were unaffected.

Observed Chrome local-server load: about **90 ms** from weight fetch start through worker initialization and contract verification. First inference about **2.3 ms**. Across 180 validation calls: mean **0.21 ms**, p95 **0.40 ms**, max **1.10 ms** in the focused run. Prior Edge focused run: mean **0.20 ms**, p95 **0.40 ms**, max **1.40 ms**. These are desktop localhost results, not cold internet download times or physical mobile measurements. Network/model-output fixtures are not used: only RPC responses and deliberately failed-load/timeout scenarios are scripted.

**Original memory limitation (superseded by the scoped measurements below):** Chrome/Edge browser-root CDP Worker inspection timed out. The final verification fixes the measurement attachment path and records real page + Worker JS samples. Python working-set numbers do not prove browser compliance; an absolute browser peak and process RSS still remain unverified. Firefox/Safari and physical devices were not tested. Final-blind labels and predictions were not opened; there is no final-blind claim.

## Distribution, caching and performance

The weights are committed and emitted as a content-hashed same-origin Vite asset, including the `/ela/` deployment base. No runtime CDN is needed. Normal browser HTTP caching applies; no service worker, IndexedDB or custom persistent cache is added. The initialized model is reused in the current page; reload starts a new instance. Every initialization rechecks the pinned SHA-256. Old hashed JS/weights should be retained together during deployments to avoid stale-page asset failures; rules still work if the optional adapter cannot load.

The sole added dependency is pinned `@huggingface/tokenizers@0.2.0`, Apache-2.0, no transitive dependencies, 360,962 unpacked bytes; only its Worker bundle is shipped (~36.8 kB raw). Model license/provenance and upstream dataset uncertainty are retained in `src/agent/assets/NOTICE.md` and distributed `local-ai-NOTICE.txt`.

The existing rules are emitted as one eager shared chunk so they survive failed optional imports; no safety logic was moved in source. Main chunk 9,952 raw / 3,759 gzip bytes; eager rules chunk 31,177 raw / 11,785 gzip bytes (Node zlib). **Combined initial JS is 15,544 gzip bytes versus the old 14,946-byte main (+598 bytes)**, a real increase rather than a claim that chunk splitting removes bytes. Existing per-main, Core and PQC budget assertions are retained. PQC chunk is unchanged at 21,868 gzip bytes. No model or tokenizer weights enter the initial chunks.

## Reproduction and evidence

`npm ci`, `npm test`, `npm run build`, `npm run eval:local`. Real browser tests require Chrome (`ELA_REQUIRE_CHROME=1`); Edge can be selected with `CHROME_PATH`. No physical device verification.

- `scripts/package-local-model.mjs <existing-variant-folder> --check`: five source hashes and exact packed bytes, no writes.
- `scripts/compare-local-model.mjs <existing-lab-folder>`: verifies the existing data seal and compares Python/JS; requires the existing lab Python environment. No downloads/training/blind-data access.
- [Fresh Node results](evidence/local-ai-7h5/node-evaluation.json), [parity](evidence/local-ai-7h5/parity.json), and full test logs in `evidence/local-ai-7h5/` distinguish genuine inference from scripted RPC transport.

Final local verification: **1,332 tests: 1,331 passed, 0 failed, 1 opt-in live Diana test skipped** with real Chrome required; production build passed. Edge's five focused model/budget tests passed. [Final full-suite log](evidence/local-ai-7h5/full-test-green.txt), [Edge log](evidence/local-ai-7h5/edge-test.txt), [build log](evidence/local-ai-7h5/build.txt). Earlier logs are retained: transitional source/asset expectations failed before updates, including a comment-only verifier isolation assertion. No security threshold, refusal or permissions test was weakened; new expected bundle paths replace outdated no-model assumptions. Remote CI is reported separately in the PR and is not inferred from local results.

Local worktree: `C:\Users\Murat\.codex\worktrees\ela-local-ai-7h5\ela-core-original`; branch `work/ela-local-ai-7h5`, base `23f6f21`. Separate draft PR; no merge. Absolute-peak/process-memory acceptance, wider browser verification and human assessment of the small benefit remain open.


## Final verification continuation — 20 November 2026

This continuation starts from `15ac8d8` on the same branch/worktree and updates draft PR #37. No application source, model weights, training data, security gate, RPC permissions, deterministic routing, Sapphire CORE or Diana Payment Account prototype changed. Confidence **0.75** and margin **0.20** remain unchanged. No command-specific memorization rule, external inference or new transaction authority was added. Earlier evidence and local artifacts are retained; the new production build has a separate, ignored output directory.

### Measurement correction and scope

The previous test caught a timeout and continued without any measurement assertion. Adding a required Worker-memory assertion reproduced a failure at **`Runtime.enable`**, after browser-root `Target.attachToTarget` had returned. Attaching the dedicated Worker through its **owning page**, using flattened `Target.setAutoAttach`, made the same real-model measurement succeed. This identifies the failing attachment path on this host; it does not establish an internal Chromium engine defect. The [CDP Target documentation](https://chromedevtools.github.io/devtools-protocol/tot/Target/) describes related-target attachment and `Runtime.runIfWaitingForDebugger` for paused targets.

The corrected test attaches before initialization, pauses the empty Worker, reads its baseline, resumes it, and samples both page and actual inference Worker during loading, validation and ten batches of 180 repeated inferences. The model Worker URL is checked. Missing Worker samples and sampling errors now fail the test instead of being treated as success. No application instrumentation or new production Worker messages are needed. `ELA_KEEP_BROWSER_ARTIFACTS=1` retains the test's temporary browser directory.

Measurements below use **`usedSize + backingStorageSize`**, in MiB (1,048,576 bytes), without forced GC. Page and Worker are read sequentially. The requested interval is 5 ms, subject to scheduling and CDP overhead; it is not a hard sampling frequency. DevTools, recorded messages and test instrumentation contribute overhead. The empty Worker uses about **0.29 MiB** before model initialization in both browsers. The page already holds downloaded weights at that checkpoint, so it is not the pre-download page baseline.

| Checkpoint | Chrome page | Chrome Worker | Chrome extra vs page baseline | Edge page | Edge Worker | Edge extra vs page baseline |
|---|---:|---:|---:|---:|---:|---:|
| Before model download | 5.90 | absent | 0 | 1.22 | absent | 0 |
| Loaded, first inferences completed | 23.68 | 11.67 | 29.45 | 21.67 | 11.48 | 31.93 |
| Repeat batch 1 | 24.89 | 12.93 | 31.92 | 17.83 | 12.87 | 29.48 |
| Repeat batch 5 | 25.32 | 11.74 | 31.16 | 18.30 | 11.24 | 28.32 |
| Repeat batch 10 | 26.13 | 17.64 | 37.87 | 19.13 | 17.14 | 35.05 |
| After 1,800 repeats | 26.13 | 17.64 | 37.87 | 19.13 | 17.14 | 35.05 |
| **Maximum sampled extra** | — | — | **37.87** | — | — | **37.00** |

Final strict-guard runs: Chrome 157 **49 samples** (10 loading, 3 validation, 22 repeated-inference timer samples); Edge 157 **70 samples** (15 loading, 4 validation, 37 repeat timer samples), confirmed by `Edg/157.0.0.0` in the actual user agent. Chrome's measurements come from the full-suite browser, so its pre-model page baseline is warmer than the separate Edge run. Earlier focused runs remain retained (Chrome 37.82 MiB, Edge 37.95 MiB sampled extra). Each run includes 180 real validation calls and 1,800 repeats, plus two UI calls. Collection timing differs between runs; the finite measurements cannot prove absence of a longer-lived leak.

Independent review found that the initial guard could accept missing backing-store fields or checkpoint-only coverage, and omitted page-only pre-Worker samples from its maximum. The final helper requires finite nonnegative `usedSize` and `backingStorageSize` in each measured scope, actual timer samples during loading/validation/repeats, and a loaded Worker; it includes all page-only loading samples. Four guard tests fail against the old aggregation and pass after correction. Sample phase/time are captured at the start and the source distinguishes timers, checkpoints and the paused-Worker baseline. This makes incomplete future measurements fail explicitly. Earlier JSON evidence has valid fields and real timer-era samples; the correction does not invalidate its reported numbers.

**Budget conclusion:** the observed page + Worker extra JS memory stays below **300 MiB** on both desktop browsers. Total browser/process RSS, DOM/embedder memory, unobserved intervals and a continuous absolute peak are outside this metric. Therefore this is a measured sampled-JS result, **not unconditional verification of a 300 MiB total-memory or absolute-peak limit**. Physical mobile devices, Firefox and Safari remain untested.

### Accuracy and causes, with unchanged thresholds

Fresh Node inference and both real browser Workers reproduce **148/180 raw labels** (TR 64/77, EN 63/76, mixed 21/27). Integrated outcomes remain unchanged from the prior PR revision:

| Set / language | Rules correct | Integrated correct | False accepts | False rejects |
|---|---:|---:|---:|---:|
| Regression total | 287/307 | 288/307 | 0 | 19 (rules: 20) |
| Regression TR | 140/152 | 140/152 | 0 | 12 |
| Regression EN | 141/147 | 141/147 | 0 | 6 |
| Regression mixed | 6/8 | 7/8 | 0 | 1 |
| Validation total | 87/180 | 87/180 | 4 | 89 |
| Validation TR | 35/77 | 35/77 | 1 | 41 |
| Validation EN | 40/76 | 40/76 | 2 | 34 |
| Validation mixed | 12/27 | 12/27 | 1 | 14 |

The only measured application benefit remains `Diana testnet çalışıyor mu, check et.`: clarification becomes an allowed read-only network check. Relative to the previous PR revision, **there is no additional accuracy gain**. The improvement in this continuation is reliable measurement and diagnostic coverage.

- **Regression false rejects (19):** 11 low-confidence results (TR 5, EN 5, mixed 1), and 8 inputs intentionally withheld by the existing model wording filter (TR 7, EN 1). Examples of the latter include negated transfer wording and “Zincir kimliğini onayla.” They pass the safety gate but retain risky words, so the second defensive layer returns unknown. This distinction is deliberate; its removal would trade safety for coverage. Low-confidence examples include “What block are we on?” (0.573) and misspellings such as “Chek Diana network.” (0.590). No threshold relaxation is justified by these test cases.
- **Validation false rejects (89):** 86 low-confidence outcomes (TR 39, EN 33, mixed 14), plus 3 unknown-label outcomes (TR 2, EN 1). Of the 89 rejected run requests, **84 have the correct raw top label** but still do not meet the integrated decision requirements. Raw argmax accuracy therefore substantially overstates production utility. No additional miss was caused solely by the 0.20 margin after passing 0.75 confidence in these sets.
- **Validation false accepts (4):** all are preexisting deterministic gas reads, unchanged before/after. The retained old labels say unsupported for “Diana'da gas ücreti şu an ne?”, “What's the gas price on Diana right now?”, “gas price diana?” and “Gas price ne kadar şu an?”. Current application rules support those reads. They still count as false accepts against the original labels; the records are neither relabeled nor removed. They are not new model-enabled RPC actions.
- **Raw label errors (32):** unsupported → block 9 / network 2 / unknown 5; block → network 6; follow-up-current → repeat 1 / unknown 2; follow-up-repeat → unknown 1; unknown → follow-up-current 1 / repeat 1 / unsupported 4. This points to scope, network-versus-height vocabulary and follow-up ambiguity, not a demonstrated fix from adding isolated command rules.
- **Rules/model disagreements:** filter-respecting offline probes find 14 raw top-label disagreements with known lexicon labels in regression and 7 in validation. None simultaneously passes the unchanged confidence and margin thresholds. Examples: “Can you check the network?” has raw top unsupported (0.261), while rules correctly run the network check; “Current height of Diana testnet” has raw top network (0.686), while rules run block number. Production routing and known lexicon outputs remain authoritative. No high-confidence competing intent was observed in these probes; this is not proof that such a conflict is impossible.

The audit retains per-input actual/baseline outcomes, decision sources/reasons, top scores, margins, withholding and counterfactual probes. Probes do not replace real pipeline outcomes, are not accuracy gains, do not send RPC, retain the model contract's privacy/risk filtering and skip safety-gate/input-check rejects. Final-blind data was not opened. No new model training or prior candidate experiments were repeated.

### Final checks and evidence

- Full suite with Chrome required: **1,336 tests; 1,335 passed; 0 failed; 1 opt-in live Diana test skipped**. All safety, permissions and 307-item regression assertions pass.
- Chrome focused model integration initially passed 4/4; final strict measurements and bundle budget pass in the full suite. Edge focused model + bundle budget: **5/5 passed**. Corrupt/unavailable/oversized weights, unsupported Workers, missing optional JS and stalled inference remain fail-closed.
- Production TypeScript + Vite build passed into `docs/evidence/local-ai-7h5-final/production-build-verified/` using `npm run build -- --outDir docs/evidence/local-ai-7h5-final/production-build-verified --emptyOutDir false`; existing `dist/` was preserved.
- Fresh real Node evaluation reproduces the previous report's outcome counts and zero model calls for 61 attacks. RPC transport is scripted; these runs are not live endpoint availability tests. Existing Python/JS parity was not repeated because tokenizer, runtime and weights did not change.

New evidence: [Chrome memory](evidence/local-ai-7h5-final/chrome-memory-verified.json), [Edge memory](evidence/local-ai-7h5-final/edge-memory-verified.json), [Chrome integration](evidence/local-ai-7h5-final/chrome-integration.txt), [Edge integration](evidence/local-ai-7h5-final/edge-integration-verified.txt), [full suite](evidence/local-ai-7h5-final/full-test-verified.txt), [production build](evidence/local-ai-7h5-final/build-verified.txt), [real Node evaluation](evidence/local-ai-7h5-final/node-evaluation.json), [row-level error audit](evidence/local-ai-7h5-final/error-analysis-classified.json), [before/after comparison](evidence/local-ai-7h5-final/comparison.json).

Reproduce the additive audit with `node scripts/analyze-local-model.mjs <new-report.json>`. For browser JSON evidence set `ELA_MEMORY_REPORT` to a **new** filename and run `node --test --test-name-pattern='7H-5:|budget' tests/ui-characterization.test.mjs`; set `CHROME_PATH` to Edge for Edge. JSON evidence uses exclusive creation to avoid overwriting earlier runs.

The initial `error-analysis.json` and its text log are retained as diagnostic evidence; `error-analysis-classified.json` is the final cause breakdown separating defensive wording withholding from other unknown-label outcomes.
