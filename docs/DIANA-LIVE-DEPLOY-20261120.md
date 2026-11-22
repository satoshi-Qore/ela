# Diana testnet live deployment — 20 November 2026

Base: main `1cad76a`. Explicit user authorization replaced the expired schedule and authorized the existing window and deployment CLI flows only. Approved roles, recipient and monetary/payment limits were preserved.

| Field | Verified value |
|---|---|
| Chain | Diana, EVM 9800 |
| Contract | `0x8a278Cf5B0D34cF844cF19C74116e9DdfB7Aba9d` |
| Deployment transaction | `0xb13841710fac84cb1bbb286707387eca1ae7456a1f21864905cdfd734a7a4fc1` |
| Receipt | success, block 10449464 |
| Receipt block hash | `0x550119af74f104dce2157f89a2bf7a8c8836ce0bef3fed9996130819f925f27a` |
| Deployment nonce | 3 (window opened using sequence 2) |
| Gas limit / used | 1710000 / 1365431 |
| Fee cap / effective price | 150 / 112.5 gwei |
| Deployment fee | 153610987500000000 wei = 0.1536109875 QOR |
| Window fee | 52500 uqor = 0.0525 QOR |
| Total window + deployment fees | 0.2061109875 QOR |
| Runtime | 6039 bytes, exact match with compiled code and all eight immutable constructor values |
| Runtime SHA-256 | `fd2c83f0c014afdd28868a7e170d1d3f61b7851549689807d345d8d92540fcd3` |
| Runtime Keccak-256 | `0xb8d62bd36bb26be3da3337d4dd08002ca65e9a604d3ea0acb2683b6056b39d90` |

## Performed using existing tools

The window CLI's two typed confirmations, hybrid signature verification, exact signed simulation, unchanged-state checks and one-shot broadcast all remained in force. Window transaction `FF3B878096D7F5A73C5D7A5AC733F0AC91CCD50965894ACCED33BC42512A1EB5` was verified on chain before deployment: block 10449422, expiry 10449822, one admitted transaction, maxValue 256500 uqor, no targets/native-only restriction, unused, sequence and EVM nonce 3.

The existing deployment CLI completed PREPARE → BUILD → SIGN → CHECK → BROADCAST → VERIFY. All PREPARE checks passed. Creation dry-run returned the exact expected runtime; the signed type-2 transaction fields and recovered signer matched. The single broadcast was accepted, receipt successful, expected CREATE address matched, runtime matched at the canonical receipt block, nonce advanced to 4, and the window recorded one use. Neither transaction was resubmitted. No private material was printed or saved in evidence; the existing signing mechanism handled its recovery record internally.

## On-chain payment state

Canonical snapshot 10449516 (`0x102b07c2b171bbddd1bab1a3e9e3c3ed16621bf2ed58196c82f90e6cd0bdea08`), read at 2026-11-20 19:07:10 UTC:

- Executor / Invoice Owner: `0x6a5d4D7B3357df968b2A3004071eCe98f015C794`.
- Recipient: `0xc9Ab55FeC7c1fEe27F3AFc5DF99E6A09b4B2D875`.
- maxPerPayment 1000000000000000 wei; spendingLimit 3000000000000000 wei; maxPayments 3.
- startsAt 1795203000 (22:30 Istanbul), endsAt 1795206600 (23:30 Istanbul). Planned deployment reference 1795202100; approved 900/3600-second relations preserved. Deployment completed before the 22:15 deadline.
- Contract balance **0 wei**; totalSpent 0; nextNonce 0. No funding and no payment transaction was performed.

Payment testing still requires authorized funding (up to the approved 0.003 QOR total for the three maximum-size tests), activation at 22:30, valid invoice signatures and an explicitly authorized payment execution path/window. The deployment's one-transaction window has been consumed. The 23:30 expiry remains binding; this task did not authorize or send a payment or funding transfer.

## Persisted evidence and safety

`docs/evidence/diana-live-deploy-20261120/` contains the CLI's public PREPARE, deployment verification, canonical contract state, receipt/fee summary, public readiness configuration and exact verified runtime hex. The latest schedule is stored in the same approved-policy configuration. After the authorized single deployment completed, `LIVE_CONSTRUCTOR_PARAMS = null` was restored and executionAuthorized set false with an audit note that the one-shot authorization was consumed. No default path is left enabled for another deployment.

Eleven targeted policy/lock tests passed for the new times and restored execution lock. CORE, Model2Vec, Solidity, RPC permission lists and signing/broadcast checks were unchanged. No new architecture, PR or merge was created.
