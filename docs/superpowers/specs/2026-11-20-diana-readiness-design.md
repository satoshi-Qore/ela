# ELA 7I-1 read-only payment readiness

User requests concrete implementation, separate from PR #37 and future execution. Base main 23f6f21; PR #37 at 798ff31 stays open/draft and untouched.

## Approach
Use a separate typed readiness API and operator CLI, reusing the existing fixed Diana endpoint, timeout/error handling and address validation. Do not route natural language into it or expand the existing agent registry: its eth_call capability intentionally permits only existing token selectors. Importing prototype deployment/signing modules would expose unnecessary execution dependencies. Copy only the contract's public getter/ABI schema into a narrow read adapter; leave the completed prototype unchanged.

Public configuration pins expected roles, runtime SHA-256, key fingerprints, policy and an optional proposed payment. It contains no credentials. Missing configuration blocks review readiness. Exact runtime identity is required before trusting getters. Read code, public keys, policy and balances bound to one selected canonical block hash via EIP-1898, and recheck that block hash and chain identity before returning. ABI/envelope/HTTP/network/timeouts fail closed; no partial report may say ready.

Ready-for-review means only the configured on-chain prerequisites at the observed block. It never authorizes execution or claims an invoice signature, hybrid window, fee budget or transaction has been validated. Signed invoice and future authorized execution remain separate.

## Boundaries
No signing, private keys, account generation, deployment, transaction simulation/broadcast, wallet connection, UI/CORE changes, model research or optimization. No changes to existing safety gate/registry/RPC guard/Model2Vec thresholds. Preserve earlier reports. Current public predicted deployment address is an observation target, not asserted to be deployed; live policy/recipient/runtime approval remain missing.
