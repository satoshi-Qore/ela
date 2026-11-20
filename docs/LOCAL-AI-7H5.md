# ELA 7H-5 local model integration — 20 November 2026

Real weights are integrated, but this remains an **experimental candidate**, not a claim of broad intelligence or complete acceptance. Browser peak extra memory could not be verified. Keep the PR in draft pending that acceptance criterion and human review.

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

**Memory limitation:** Chrome/Edge CDP Worker heap inspection timed out. No measured browser peak-extra-memory figure is available; the 300 MiB criterion remains **unverified**. Python working-set numbers above cannot prove browser memory compliance. Firefox/Safari and physical devices were not tested. Final-blind labels and predictions were not opened; there is no final-blind claim.

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

Local worktree: `C:\Users\Murat\.codex\worktrees\ela-local-ai-7h5\ela-core-original`; branch `work/ela-local-ai-7h5`, base `23f6f21`. Separate draft PR; no merge. Browser memory acceptance, wider browser verification and human assessment of the small benefit remain open.
