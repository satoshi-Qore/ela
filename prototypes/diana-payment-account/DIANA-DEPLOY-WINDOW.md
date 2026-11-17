# Diana deployment window: PREPARE (7C-22)

This step is preparation only. No window has been opened and nothing has been deployed. Opening the window, deploying and closing it are later steps, and each needs its own approval.

Following 7C-21, the Invoice Owner account also deploys the contract and executes payments. Diana admits an EVM transaction only from an account that holds a registered ML-DSA key and has an open window. The window is opened by a hybrid-signed Cosmos `MsgOpenEVMWindow`.

When `allowed_targets` is set, the window refuses contract creation. Deployment therefore needs its own window with no targets, admitting exactly one transaction. Payments need a second window, restricted to the contract.

## Tool
`node .\diana-window-prepare.mjs` needs no key, no recovery record and no vault. It has no signing code and no broadcast route; its network guard allows only:
- GET reads;
- the Cosmos simulation route;
- the read-only EVM methods `eth_chainId`, `eth_getTransactionCount`, `eth_getBalance`, `eth_gasPrice` and `eth_estimateGas`.

It reads the contract artifact from `out/` (built with `forge build`; the folder is ignored by Git). It refuses the artifact unless the artifact's recorded source hash matches `src/DianaPaymentAccount.sol`.

It refuses to continue in any of these cases:
- wrong chain ID;
- unexpected account number;
- the sequence is not the expected 2;
- the EVM nonce differs from the Cosmos sequence;
- the classical key or the registered PQC key is not the expected one;
- the chain does not use v2 sign bytes;
- a window is already live;
- invalid window parameters;
- the window length does not fit the live block time;
- the fee cap is below the live gas price or base fee;
- the deployment estimate fails;
- the balance does not cover the window transaction's fee ceiling plus the whole window value.

## Live PREPARE result (17 November 2026, 04:10 UTC)

| | |
|---|---|
| Account | `qor1dfw567en2l0edze2xqzqw8kwnrcpt3u5m9n88r` / `0x6a5d4D7B3357df968b2A3004071eCe98f015C794`, account number 16046 |
| Sequence / EVM nonce | 2 / 2 (equal, as the SDK states: the Cosmos sequence is the EVM nonce) |
| Balance | 99,857,500 uqor; `eth_getBalance` is exactly that × 10^12 wei, consistent with 1 uqor = 10^12 wei |
| PQC key | ML-DSA-87, `a3b2c32d…1bab5a`, v2 sign bytes; no window exists |
| **Window** | `/qorechain.pqc.v1.MsgOpenEVMWindow`, `blocks` **400**, `maxTxs` **1**, `allowedTargets` **[]**, `nativeOnly` false, `maxValue` **256,500 uqor** (0.2565 QOR) |
| Window length | 400 blocks at the live 1.425 s per block, about 9.5 minutes |
| Window transaction (Cosmos) | Placeholder simulation **186,690 gas**, estimate 226,690 including the SDK's 40,000 hybrid verification gas. Gas limit 350,000 at 0.15 uqor, fee ceiling 52,500 uqor. |
| Deployment estimate | `eth_estimateGas` **1,365,419 gas**, using placeholder constructor arguments |
| Deployment plan | Gas limit 1,710,000 (1.25× the estimate, rounded up to 10,000). `maxFeePerGas` 150 gwei, against a live gas price of 112.5 gwei and a base fee of 100 gwei. `maxPriorityFeePerGas` 12.5 gwei. Value 0. |
| `maxValue` | 1,710,000 × 150 gwei = 2.565 × 10^17 wei = **256,500 uqor**, rounded up |
| Deployment nonce | **3**, the current sequence + 1 |
| Predicted CREATE address | **`0x8a278Cf5B0D34cF844cF19C74116e9DdfB7Aba9d`**, from `CREATE(0x6a5d…C794, 3)` |

The window transaction's B0, auth info and PQC sign bytes have SHA-256 `6a4775b0…`, `84061cd2…` and `af1490dd…`.

## What is not verified
- **Window transaction gas.** The real hybrid-signed window transaction has not been simulated. Its gas is an estimate.
- **Deployment nonce and address.** Nonce 3, and the address that follows from it, hold only if the window transaction is included and no other transaction is sent from the account before the deployment. A Cosmos transaction that is included but fails also moves the sequence. The deployment must re-read the nonce after the window opens.
- **Deployment gas with the real constructor.** The recipient, limits and dates are not fixed yet. The estimate uses placeholders, and the 1.25× gas limit is meant to absorb the difference.
- **Fee cap.** 150 gwei covers today's 112.5 gwei gas price. If the base fee rises above the cap before the deployment, the deployment would be refused. The window value only bounds what the deployment may spend.
- **Window value.** It is sized for the deployment alone. Funding the contract and calling `pay()` belong to the later payment window.
