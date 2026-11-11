# ELA — Execution & Logic Agent

ELA is an early-stage TypeScript project for routing Turkish commands and reading public data from the QoreChain Diana testnet.

## Current capabilities

- **Deterministic Turkish command routing.** Recognizes balance requests, latest-block queries, and transfer-draft intent. It handles Turkish casing and whitespace and returns `needs_clarification` for unsupported, ambiguous, or conflicting requests.
- **Read-only QoreChain queries.** `getBlockNumber` checks the chain ID and synchronization status before returning the latest block height. `getBalance` validates native `qor1…` addresses and returns exact balances in `uqor` and QOR as strings. Both tools support configurable endpoints and timeouts.
- **Automated tests.** The suite includes 45 command-routing cases, 30 native read-only tool tests, and 21 EVM reader tests. The read-only tool tests use mocked HTTP responses and run offline.

## Project status

The router and read-only tools are available as separate modules. Transfer-draft recognition currently returns a routing result only. The local web interface supports latest-block queries. Transaction construction, signing, broadcasting, and wallet integration remain future work.

Local AI experiments evaluated Qwen3 for Turkish tool selection. In the constrained-output evaluation, the model produced valid JSON in 15 of 15 trials and selected the expected tool in 5 of 15. The current router uses deterministic rules. Model integration remains experimental, and model files are excluded from the repository.

## Setup, tests, and production build

Install [Node.js 24 LTS](https://nodejs.org/en/download). From the project root, run the same commands used by GitHub Actions on Ubuntu:

```sh
npm ci
node --test tests/router.test.mjs tests/qorechain.test.mjs tests/qorechain-evm.test.mjs
npm run build
```

The 96 tests cover 45 routing cases, 30 native read-only tool cases, and 21 EVM reader cases. The tests use local fixtures and mocked HTTP responses. The build type-checks the sources and writes the static site to `dist/` with asset paths rooted at /ela/ for GitHub Pages project hosting.

## Local web interface

After running `npm ci`, start Vite with `npm run dev`. Open the local URL printed by Vite and enter `QoreChain son blok numarasını öğren.` The browser verifies EVM chain ID 9800 with `eth_chainId` before reading the block height with `eth_blockNumber` from the official EVM JSON-RPC endpoint. The interface supports latest-block queries only.

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
- The core uses [Node.js](https://github.com/nodejs/node/blob/v24.18.0/LICENSE) (MIT, with bundled third-party notices) and has no third-party npm package dependencies. The native address checksum follows [BIP 173](https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki) (BSD-2-Clause), by Pieter Wuille and Greg Maxwell. QoreChain's public documentation and [Cosmos SDK](https://github.com/cosmos/cosmos-sdk/blob/v0.53.6/LICENSE) (Apache-2.0) document the network and query interfaces.
- Local AI experiments used [Transformers.js 4.3.2](https://www.npmjs.com/package/@huggingface/transformers/v/4.3.2) and its [structured-output package](https://www.npmjs.com/package/@huggingface/transformers-structured-output/v/4.3.2) (both Apache-2.0), [ONNX Runtime Web](https://github.com/microsoft/onnxruntime/blob/main/LICENSE) (MIT), and the [Qwen3-0.6B ONNX export](https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX). The [upstream Qwen3-0.6B model](https://huggingface.co/Qwen/Qwen3-0.6B) declares Apache-2.0. The ONNX export's model card does not declare a separate license. These experimental assets are not bundled with the core.
- Web development uses [Vite](https://github.com/vitejs/vite/blob/main/LICENSE) (MIT) and [TypeScript](https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt) (Apache-2.0).
- AI assistance was used during development and testing.
