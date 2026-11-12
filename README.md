# ELA — Execution & Logic Agent

ELA is an early-stage TypeScript project for routing Turkish commands and reading public data from the QoreChain Diana testnet.

## Current capabilities

- **Deterministic Turkish command routing.** Recognizes balance requests, latest-block queries, and transfer-draft intent. It handles Turkish casing and whitespace and returns `needs_clarification` for unsupported, ambiguous, or conflicting requests.
- **Read-only QoreChain queries.** `getBlockNumber` checks the chain ID and synchronization status before returning the latest block height. `getBalance` validates native `qor1…` addresses and returns exact balances in `uqor` and QOR as strings. Both tools support configurable endpoints and timeouts.
- **Agent planner (v1).** `Diana ağını kontrol et.` produces an explicit two-step plan: verify the Diana EVM chain ID (9800) with `eth_chainId`, then read the latest block with `eth_blockNumber`. The executor runs tools only through a fixed tool registry (`src/agent/registry.ts`). Each registry entry declares its id, description, allowed network (Diana testnet only), read-only status, allowed RPC methods, parameter rules, and runner, and returns a standard result or error. Unknown tools, other networks, unlisted RPC methods, and invalid parameters are refused before any request is sent. The executor reports each step as succeeded, failed, or skipped from the requests it actually sent, including partial failures. A successful check confirms that one public endpoint answered; it is not a full network health check.
- **Conversation context (v1).** Within one page session, ELA remembers only the kind of the last *successful* query (latest block or Diana network check) and its network, never the block height. The follow-ups `Peki şimdi kaç oldu?` and `Tekrar kontrol et.` re-run a query with fresh RPC data through the tool registry. Without context they return *Needs clarification*. Failed or partial queries leave the context unchanged. **Clear context** resets it, and reloading the page starts with no context. Nothing is stored in the browser or on a server.
- **Intent foundation (not wired into the interface).** `src/agent/intent.ts` prepares for a future local classifier. A classifier may only pick one of six closed labels (`network_check`, `block_number`, `follow_up_repeat`, `follow_up_current`, `unsupported`, `unknown`) with confidence scores; output with any other field is rejected. A deterministic safety gate refuses requests to transfer funds, sign, handle secrets, control a wallet, or change chain state before any classifier or RPC call, while read questions that only mention such words are not blocked. Other networks and addresses lead to clarification. Low confidence, a small lead over the runner-up, unknown intents, or a follow-up without context also lead to clarification. Accepted labels map to the existing read-only queries. The decision thresholds are provisional and not calibrated against any model. Tests use fake classifiers and 174 labelled Turkish evaluation sentences.
- **Turkish and English understanding (not wired into the interface).** `src/agent/lexicon.ts` adds a deterministic, rule-based classifier (no model, no new dependency) that maps Turkish and English sentences such as `diana agini kontrol et`, `Son blok numarasını söyler misin?`, `Check Diana network.`, `What's the latest block?`, and `Check again.` to the same six closed labels. Every word of a sentence must be known to the lexicon; one unknown word ("kimdir", "who", a number, a name) leads to clarification, so `Diana kimdir?` and `Who is Diana?` never become a network query. The safety gate now also refuses English requests (`Send 10 QOR.`, `Transfer my tokens.`, `Sign this transaction.`, `Show my private key.`, `Deploy this contract.`) before any classifier or RPC call, and English mentions of other networks lead to clarification. `understandCommand` runs this pipeline; accepted labels still run only through the existing tool registry and RPC guard. Evaluation: 0 false accepts on 174 Turkish, 138 English, and 108 held-out sentences (`node tests/intent-eval-report.mjs tr en heldout`). Only Diana testnet is supported.
- **Post-quantum signature verification (not wired into the interface).** `src/pqc/verify-ml-dsa-87.ts` checks one ML-DSA-87 (FIPS 204) signature over a raw message with QoreChain's official [`@qorechain/pqc`](https://github.com/qorechain/qorechain-pqc) 0.2.3. It takes a public key, a message (up to 64 KiB), and a signature as bytes or hexadecimal text and returns `{ valid: true }` or `{ valid: false, reason }`. It only verifies: it never signs, never accepts or creates a secret key, and sends no network request. Malformed, missing, wrong-size, or oversized input is refused. It does not verify QoreChain hybrid transactions or look up keys registered on chain. Tests use the official ML-DSA-87 vectors pinned to qorechain-pqc `v0.2.3` (`tests/vectors/qorechain-pqc/`) and cross-check every result with Node.js's OpenSSL ML-DSA-87.
- **Offline browser demo for ML-DSA-87 (separate page, not part of the interface).** `demo/pqc-verify/index.html` verifies the official test vector in the browser and shows that changing one message byte makes the signature fail. It asks only for a public key, a message, and a signature, never signs, and its Content-Security-Policy blocks every network connection. Once loaded, it keeps working offline; opening it for the first time still needs the page files.
- **Official QoreChain SDK reader (not wired into the interface).** `src/qorechain/sdk-evm-reader.ts` reads the latest Diana EVM block through [`@qorechain/sdk`](https://github.com/qorechain/qorechain-sdk) 0.14.0 (its `testnet` preset and `postJsonRpc` transport) with the same checks and error codes as ELA's own reader: `eth_chainId` must report 9800 before `eth_blockNumber` is sent, only these two methods reach the Diana EVM endpoint, SDK retries are off, and redirects and credentials are refused. The tool registry and the interface still use ELA's own reader.
- **Automated tests.** The suite includes 45 command-routing cases, 30 native read-only tool tests, 21 EVM reader tests, 501 agent planner, tool registry, RPC guard, conversation context, intent foundation, and Turkish/English understanding tests, 26 ML-DSA-87 verification tests, 11 browser demo tests, and 53 SDK reader tests. Except for one opt-in live test, they use mocked HTTP responses or a local server and make no external request.

## Project status

The router and read-only tools are available as separate modules. Transfer-draft recognition currently returns a routing result only. The local web interface supports latest-block queries. Transaction construction, signing, broadcasting, and wallet integration remain future work.

Local AI experiments evaluated Qwen3 for Turkish tool selection. In the constrained-output evaluation, the model produced valid JSON in 15 of 15 trials and selected the expected tool in 5 of 15. The current router uses deterministic rules. Model integration remains experimental, and model files are excluded from the repository.

## Setup, tests, and production build

Install [Node.js](https://nodejs.org/en/download) 24.6.0 or newer (24 LTS) and Google Chrome or Chromium. From the project root, run the same commands used by GitHub Actions on Ubuntu:

```sh
npm ci
npm test
npm run build
```

`npm test` first checks the environment (`scripts/check-test-environment.mjs`) and then runs all 687 tests with `node --test`. The expected result is 686 passed and 1 skipped:

| Test file | Tests | Covers |
| --- | --- | --- |
| `tests/router.test.mjs` | 45 | command routing |
| `tests/qorechain.test.mjs` | 30 | native read-only tools |
| `tests/qorechain-evm.test.mjs` | 21 | ELA's EVM reader |
| `tests/agent-planner.test.mjs` | 501 | planner, tool registry, RPC guard, conversation context, intent foundation, Turkish/English understanding |
| `tests/pqc-ml-dsa-87.test.mjs` | 26 | ML-DSA-87 verifier, official vectors, OpenSSL cross-check |
| `tests/pqc-browser.test.mjs` | 11 | offline demo in real headless Chrome |
| `tests/qorechain-sdk.test.mjs` | 53 | SDK reader compared with ELA's reader; 1 live test skipped by default |

- **Node.js 24.6.0 or newer** is required (`engines` in `package.json`): the ML-DSA-87 tests use `node:crypto` ML-DSA support (OpenSSL 3.5), added in Node.js 24.6.0. Older versions stop at the environment check.
- **Browser tests** drive an installed Chrome or Chromium over the DevTools Protocol, with no extra npm package. Set `CHROME_PATH` if it is not found. Without a browser they are skipped locally, but with `ELA_REQUIRE_CHROME=1` or `CI=true` (set by GitHub Actions) the run fails instead, so CI cannot pass them silently. `ELA_CHROME_NO_SANDBOX=1` adds `--no-sandbox` for environments where Chrome's sandbox cannot start.
- **Live Diana test** is skipped unless `ELA_LIVE=1` is set; then it reads the public Diana EVM endpoint with both readers. CI does not set it, so CI makes no request to Diana.

The build type-checks the sources (library declarations included; `src/types/protobufjs.d.ts` supplies two types that cosmjs declarations reference but do not install) and writes the static site to `dist/` with asset paths rooted at /ela/ for GitHub Pages project hosting. The demo and the SDK reader are not part of that build.

## Local web interface

After running `npm ci`, start Vite with `npm run dev`. Open the local URL printed by Vite and enter `QoreChain son blok numarasını öğren.` The browser verifies EVM chain ID 9800 with `eth_chainId` before reading the block height with `eth_blockNumber` from the official EVM JSON-RPC endpoint. Enter `Diana ağını kontrol et.` to run the network check and see each executed step, its result, and the data source. After a successful query, ask `Peki şimdi kaç oldu?` or `Tekrar kontrol et.` to re-read fresh data. The interface supports these read-only commands only.

## Diana testnet

| Setting | Value |
| --- | --- |
| Chain ID | `qorechain-diana` |
| Consensus RPC | `https://rpc-testnet.qore.host` |
| EVM JSON-RPC | `https://evm-testnet.qore.host` |
| Native REST API | `https://api-testnet.qore.host` |
| Native denomination | `uqor` (1 QOR = 1,000,000 uqor) |

The standalone native block reader uses the consensus RPC `/status` endpoint. Native balance uses the Cosmos Bank `Balance` query with `denom=uqor`. See the [QoreChain testnet documentation](https://docs.qorechain.io/getting-started/connecting-to-testnet/) and the [Cosmos SDK Bank query definition](https://github.com/cosmos/cosmos-sdk/blob/v0.53.6/proto/cosmos/bank/v1beta1/query.proto).

## License and credits

- ELA source code is available under the [MIT License](LICENSE).
- The core uses [Node.js](https://github.com/nodejs/node/blob/v24.18.0/LICENSE) (MIT, with bundled third-party notices). Its runtime npm dependencies are [`@qorechain/pqc`](https://github.com/qorechain/qorechain-pqc/blob/v0.2.3/LICENSE) 0.2.3 (Apache-2.0, QoreChain Association), which uses [`@noble/post-quantum`](https://github.com/paulmillr/noble-post-quantum), `@noble/hashes`, `@noble/curves`, and `@noble/ciphers` (MIT, Paul Miller) and is used only by the ML-DSA-87 verifier and its demo, and [`@qorechain/sdk`](https://github.com/qorechain/qorechain-sdk) 0.14.0 (Apache-2.0, QoreChain Association), used only by the standalone SDK reader. The SDK brings `@qorechain/evm` (Apache-2.0), CosmJS and `cosmjs-types` (Apache-2.0), [viem](https://github.com/wevm/viem) (MIT, a peer dependency that `@qorechain/evm` loads), and further MIT, Apache-2.0, and BSD-3-Clause packages listed in `package-lock.json`. Neither dependency is part of the production web build. The ML-DSA-87 test vectors are copied unmodified from qorechain-pqc (Apache-2.0). The native address checksum follows [BIP 173](https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki) (BSD-2-Clause), by Pieter Wuille and Greg Maxwell. QoreChain's public documentation and [Cosmos SDK](https://github.com/cosmos/cosmos-sdk/blob/v0.53.6/LICENSE) (Apache-2.0) document the network and query interfaces.
- Local AI experiments used [Transformers.js 4.3.2](https://www.npmjs.com/package/@huggingface/transformers/v/4.3.2) and its [structured-output package](https://www.npmjs.com/package/@huggingface/transformers-structured-output/v/4.3.2) (both Apache-2.0), [ONNX Runtime Web](https://github.com/microsoft/onnxruntime/blob/main/LICENSE) (MIT), and the [Qwen3-0.6B ONNX export](https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX). The [upstream Qwen3-0.6B model](https://huggingface.co/Qwen/Qwen3-0.6B) declares Apache-2.0. The ONNX export's model card does not declare a separate license. These experimental assets are not bundled with the core.
- Web development uses [Vite](https://github.com/vitejs/vite/blob/main/LICENSE) (MIT) and [TypeScript](https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt) (Apache-2.0).
- AI assistance was used during development and testing.
