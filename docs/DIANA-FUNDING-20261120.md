# Diana contract funding — 20 November 2026

The user explicitly approved the fixed 0.003 QOR funding operation and subsequently approved the reviewed, address/value-locked funding adapter. No payment execution was authorized or performed. No PR was opened.

| Item | Verified result |
|---|---|
| Network | Diana EVM 9800 / qorechain-diana |
| Sender | `0x6a5d4D7B3357df968b2A3004071eCe98f015C794` |
| Recipient contract | `0x8a278Cf5B0D34cF844cF19C74116e9DdfB7Aba9d` |
| Value | 3000000000000000 wei = 3000 uqor = 0.003 QOR |
| Funding hash | `0x660e22e2ab8e94196cba2d1375feaa982ae81a329353953c9c7014d7b0f55128` |
| Receipt | status 0x1, block 10450170 |
| Canonical receipt block hash | `0xe54ef8682e048e93ce94f64182f1c35f9979a1454269301d8907007de84a34b9` |
| Nonce | 5; sender nonce advanced to 6 |
| Gas estimate / limit / used | 21055 / 27000 / 21055 |
| Fee cap / effective price | 150 / 112.5 gwei |
| Funding fee | 0.0023686875 QOR |
| Window fee | 0.0525 QOR |
| Total fees | 0.0548686875 QOR, below the approved 0.06 QOR ceiling |
| Recipient balance | 3000000000000000 wei, at the canonical receipt block and latest state |
| Runtime SHA-256 | `fd2c83f0c014afdd28868a7e170d1d3f61b7851549689807d345d8d92540fcd3`, unchanged |

The existing record/account verifier, EIP-1559 signing function, guarded network and single-attempt broadcaster were reused. The funding adapter accepts only the above contract/value, empty calldata, Diana 9800, bounded gas and fees, expected nonce and signer, and the attested runtime. It rechecks the public state before signing and before broadcasting. An exclusive public attempt journal is saved before the single funding broadcast; subsequent execution is refused. No signed raw transaction or private key/seed was printed or written to evidence.

The existing hybrid window mechanism opened transaction `9588801C2F6C0B009733467BCCC4DDA5423CF17B66B695C97022619696F7B83E` using sequence 4. It was verified read-only at block 10450124, expiry 10450524, maxTxs 1, maxValue 256500 uqor, unused, with sequence/EVM nonce 5. Its initial immediate verification ran before indexing completed; the transaction was not resent. A subsequent read-only verification passed before funding. The window recorded exactly one use after funding.

## Exact bank/EVM balance reconciliation

The first read-only preflight stopped before signing because the prior deployment fee left a sub-uqor balance. Bank query: 99651389 uqor; EVM balance: 99651389012500000000 wei. The independent precisebank endpoint returned `fractional_balance: {denom: aqor, amount: 12500000000}`. Therefore bank integer units plus the independently queried fraction exactly equal EVM wei.

The shared window preparation check now verifies that exact sum, the uqor/aqor denominations and the fractional range [0, 10^12). It does not use tolerance or discard a remainder. Unreadable, malformed or mismatched fractional data fail closed. The fraction is included in the window state fingerprint. Integer-only behavior and existing RPC permission lists remain unchanged.

Primary protocol source: [Cosmos EVM v0.6.0 precisebank query definition](https://github.com/cosmos/evm/blob/v0.6.0/proto/cosmos/evm/precisebank/v1/query.proto), the module version used by [QoreChain](https://github.com/qorechain/qorechain-core/blob/main/go.mod). The live read endpoint was `/cosmos/evm/precisebank/v1/fractional_balance/{sender}`.

Two targeted funding/unit tests, nine existing window preparation tests and two existing window intent/network-guard regressions passed. This did not rerun the full crypto experiment suite or change CORE, Model2Vec, the contract or payment policy.

## Three-payment test prerequisites

At the canonical state snapshot 10450196 (2026-11-20 19:23:19 UTC), balance was 0.003 QOR, totalSpent 0 and nextNonce 0. On-chain recipient/roles, 0.001 QOR per-payment ceiling, 0.003 QOR total budget and three-payment ceiling matched the approved policy. Test window remains 22:30–23:30 Europe/Istanbul, startsAt 1795203000, endsAt 1795206600.

Funding is sufficient for three 0.001 QOR payments. Actual tests still need separate explicit payment execution authority, three distinct valid invoices with the correct contract/account/digest/recipient, consecutive nonces 0/1/2, the established classical and PQC invoice signatures, and qualifying EVM payment window authorization(s). The funding window is consumed. Sender gas fees are separate from the contract's payment budget. No additional funding or payment was attempted.

Evidence: `docs/evidence/diana-funding-20261120/` retains the window broadcast and verification, funding PREPARE, pre-broadcast one-attempt journal, accepted broadcast result, full receipt/canonical balance/code verification and post-funding policy state.
