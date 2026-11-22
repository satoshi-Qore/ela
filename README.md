# ELA — Execution & Logic Agent

[![Built on QoreChain](https://build.qorechain.io/badge/ela-execution-logic-agent.svg)](https://build.qorechain.io/p/ela-execution-logic-agent)

ELA makes public Diana testnet data and bounded autonomous-payment evidence explainable. English and Turkish requests pass deterministic safety checks before they can reach fixed read-only tools. A learned local classifier is available only as an explicit experiment; it is OFF by default and has not passed the accuracy gate.

[Live demo](https://satoshi-qore.github.io/ela/) · [Guided demo](https://satoshi-qore.github.io/ela/#guided-demo) · [Developer Fest submission pack](docs/DEVELOPER-FEST.md)

## What works, and what is experimental

| Capability | Evidence and boundary |
| --- | --- |
| CORE / Execution & Logic | English/Turkish network, block, balance, transaction, fee and token reads through the guarded tool registry. Diana EVM chain ID 9800 is checked. Endpoint failures are reported, not filled with invented values. |
| PQC | In-browser ML-DSA-87 verification of QoreChain's official public vector; one changed message byte invalidates the signature. Verification only, not browser signing or a hybrid chain transaction. |
| Payment Account | Three completed testnet payments on 21 November 2026, totaling 0.003 QOR. Contract, hashes, receipt and PaymentExecuted evidence are linked. Explicit current RPC rechecks are separate from the timestamped archive. |
| Decision Engine | Pure ALLOW / BLOCK / WAIT / UNKNOWN policy evaluation, never execution authority. The UI re-evaluates historical post-payment states as replay BLOCK; all four outcomes have deterministic tests. |
| AI Intelligence — experimental | Real learned ELA Intent Linear 1.0.0 (MIT), 185,233 bytes, SHA-256 pinned and lazy-loaded locally. Historical evaluation: 266/307 correct, 10 false accepts versus rules 287/307, 0 false accepts. OFF by default; model outputs cannot choose RPC parameters or execute payments. |
| Safety Gate | Risky requests are refused before classification and RPC. Four 06B recognition gaps and natural TR/EN variants are covered by 06C regressions with zero classifier/RPC calls. |

The web interface never connects a wallet, handles keys, signs, funds, deploys or executes payments. The completed autonomous payment worker is a separate operator-controlled prototype; the demo only inspects its existing evidence. Receipt-read recovery and delays are documented, not presented as an uninterrupted run.

## A three-minute walkthrough

Open the collapsed Guided demo below the hero; it sends no requests and does not enable AI. Follow its seven steps: purpose → live reads → PQC verification/tamper → historical payments/current recheck → policy explanation → explicit local classifier experiment → safety refusal. Module and source links stay available throughout. Use the [runbook and narration](docs/DEVELOPER-FEST.md#demo-runbook) for details.

Try these existing commands in Execution & Logic:

- Check Diana network.
- Diana ağını kontrol et.
- What's the latest block?
- Son blok kaç?

If a live read fails, show the error. The payment archive stays dated and separate. No placeholder RPC values or new payment actions are part of the guided flow.

## Evidence

- [21 November completed payment report](docs/DIANA-LIVE-20261121.md) and [canonical public snapshot](docs/evidence/diana-live-20261121/final-chain-state.json).
- [Payment Account evidence boundaries](docs/PAYMENT-ACCOUNT-EVIDENCE-20261122.md) and [live read verification](docs/DIANA-LIVE-VERIFICATION-20261122.md).
- [Official ML-DSA vector provenance](tests/vectors/qorechain-pqc/SOURCE.md).
- [Decision Engine](docs/DECISION-ENGINE.md) and [outcome tests](tests/decision-engine.test.mjs).
- [Real local model](docs/AI-INTELLIGENCE.md), [06B rejected accuracy candidate](docs/AI-ACCURACY-06B.md), [06C gate corrections](docs/SAFETY-GATE-06C.md).

## Run and validate

Use Node.js 24.6.0 or newer (24 LTS) and Chrome or Chromium. No wallet or key is needed.

    npm ci
    npm test
    npm run build
    npm run dev

The production build is static Vite output in dist, rooted at /ela/ for GitHub Pages. CI requires real Chrome; ELA_REQUIRE_CHROME=1 prevents browser checks from being silently skipped. CHROME_PATH can identify a local browser. The live Diana SDK comparison is intentionally skipped unless ELA_LIVE=1; automated functional tests use scripted RPC responses and block live Qore endpoints. Live endpoint availability is not proved by fixture tests.

The complete suite covers the agent boundary, closed labels, safety refusals, cryptographic vectors, evidence verification, deterministic policy outcomes, real learned inference, TR/EN, three themes and mobile 200% layout. Run totals are recorded in CI, not frozen into this README. The optional Pages observation in CI reports the deployed site separately from the local PR build.

The main application gzip size already exceeds the original 13 KiB reference; that remains an explicit limitation. Model budgets are unchanged: 40 MiB artifact, 15 s load, 1.5 s inference and 300 MiB additional JS heap. Published Chrome measurements are loopback CI samples, not mobile WAN guarantees.

## Developer Fest status

Materials are prepared in [docs/DEVELOPER-FEST.md](docs/DEVELOPER-FEST.md). No recorded video, completed platform form or finalized submission is claimed by this repository change. Registration, current category eligibility and final platform fields require owner verification. The official site requires a working video of no more than three minutes; see the dated checklist and source links in the pack.

## License and credits

- ELA source code is available under the [MIT License](LICENSE).
- The core uses [Node.js](https://github.com/nodejs/node/blob/v24.18.0/LICENSE) (MIT, with bundled third-party notices). Its runtime npm dependencies are [`@qorechain/pqc`](https://github.com/qorechain/qorechain-pqc/blob/v0.2.3/LICENSE) 0.2.3 (Apache-2.0, QoreChain Association), which uses [`@noble/post-quantum`](https://github.com/paulmillr/noble-post-quantum), `@noble/hashes`, `@noble/curves`, and `@noble/ciphers` (MIT, Paul Miller) and is used only by the ML-DSA-87 verifier and its demo, and [`@qorechain/sdk`](https://github.com/qorechain/qorechain-sdk) 0.14.0 (Apache-2.0, QoreChain Association), used only by the standalone SDK reader. The SDK brings `@qorechain/evm` (Apache-2.0), CosmJS and `cosmjs-types` (Apache-2.0), [viem](https://github.com/wevm/viem) (MIT, a peer dependency that `@qorechain/evm` loads), and further MIT, Apache-2.0, and BSD-3-Clause packages listed in `package-lock.json`. The verifier is loaded on demand in its own production chunk; the standalone SDK reader is not wired into the interface. The ML-DSA-87 test vectors are copied unmodified from qorechain-pqc (Apache-2.0). The native address checksum follows [BIP 173](https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki) (BSD-2-Clause), by Pieter Wuille and Greg Maxwell. QoreChain's public documentation and [Cosmos SDK](https://github.com/cosmos/cosmos-sdk/blob/v0.53.6/LICENSE) (Apache-2.0) document the network and query interfaces.
- Local AI experiments used [Transformers.js 4.3.2](https://www.npmjs.com/package/@huggingface/transformers/v/4.3.2) and its [structured-output package](https://www.npmjs.com/package/@huggingface/transformers-structured-output/v/4.3.2) (both Apache-2.0), [ONNX Runtime Web](https://github.com/microsoft/onnxruntime/blob/main/LICENSE) (MIT), and the [Qwen3-0.6B ONNX export](https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX). The [upstream Qwen3-0.6B model](https://huggingface.co/Qwen/Qwen3-0.6B) declares Apache-2.0. The ONNX export's model card does not declare a separate license. These experimental assets are not bundled with the core.
- Web development uses [Vite](https://github.com/vitejs/vite/blob/main/LICENSE) (MIT) and [TypeScript](https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt) (Apache-2.0).
- AI assistance was used during development and testing.
