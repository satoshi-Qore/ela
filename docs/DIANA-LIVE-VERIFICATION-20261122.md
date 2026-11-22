# Diana live verification diagnosis — 22 November 2026

Base: merged PR #43, main `bd9cd7dbb2cd241465accde06dcbc3118f753f0c`. The local base was imported with its exact Git commit identity; its tree is `4d8f41e7e548b243d14a08caeb94a290a080d2b3`.

## Observed cause and successful live reads

- DNS resolution for evm-testnet.qore.host succeeded: IPv4 104.18.12.139 / 104.18.13.139 and IPv6 2606:4700::6812:d8b / 2606:4700::6812:c8b.
- The managed local Node fetch failed with `TypeError: fetch failed`, `cause.code = EACCES`. This is local connection denial. It provides no evidence of an upstream HTTP 503, DNS failure, TLS defect or CORS failure.
- The deployed main UI at https://satoshi-qore.github.io/ela/ successfully performed its explicit live RPC recheck at **2026-11-22T12:08:02.663Z / 15:08:02 Istanbul**, block **10552862**, current balance **0 wei**, with no observed error/warning logs.
- The modified UI, served locally and using the real Diana HTTPS RPC directly, successfully performed the full live recheck at **2026-11-22T12:25:32.641Z / 15:25:32 Istanbul**, block **10553596**, current balance **0 wei**, with no observed error/warning logs. Switching to Turkish retained the verified result and translated it correctly.

A passed recheck includes chain ID 9800, pinned runtime SHA-256, every policy field including nextNonce 3 and totalSpent 3000000000000000 wei, all three successful receipt identities, their canonical blocks/timestamps and exact PaymentExecuted event fields. These were real network reads, separate from deterministic fixtures.

The demonstrated defect was diagnostic information loss: read-client collapsed transport failures, the directed readers collapsed JSON-RPC errors into malformed responses, and the payment UI discarded every caught error. The browser path itself works. DNS and TLS/CORS success apply to the observed successful browser requests, not a continuing availability guarantee. A browser TypeError without exposed transport detail cannot reliably distinguish DNS, TLS, offline access and CORS; the UI now says so explicitly instead of guessing. No CORS-specific error is claimed without independent browser evidence.

## Narrow correction

The shared reader preserves bounded OS transport codes and HTTP status metadata. Payment rendering classifies recognized DNS/TLS/local-denial codes, HTTP statuses, timeouts, valid JSON-RPC error codes, malformed data, absent historical receipts/blocks and mismatched chain evidence. Only fixed catalog messages and validated numeric codes are rendered; arbitrary upstream messages/data are not displayed. English and Turkish explain the observed category and retain the dated archive boundary. A failed recheck clears any earlier live-success display.

The exact code, policy, receipt, event and canonical-snapshot checks remain enforced. Explorer indexing remains separate from RPC history availability. All dated evidence files, archived source links, CORE/PQC implementation, payment executor and operational automation are unchanged.

## Gateway decision

Deployment remains static GitHub Pages. Its workflow builds and publishes static dist output; it has no same-origin server runtime. More importantly, the deployed browser and modified browser both reached Diana directly and completed full verification. A new hosted proxy would add infrastructure without addressing the proven local EACCES cause. No gateway, open proxy, signing service or external deployment was added.

## Validation

- Production TypeScript/Vite build passed locally.
- 67 targeted reader, payment proof and readiness tests passed locally.
- Added deterministic diagnostic tests for DNS/TLS/local-denial/unknown browser transport, HTTP 503, timeout, invalid JSON, JSON-RPC -32602, malformed envelopes, missing history, mismatched evidence and wrong chain; upstream private message/data are not rendered.
- Added real-Chrome UI regressions for localized error categories, complete mocked proof success, and success-to-failure transition. Fixture success is distinct from the two real live reads above.
- Existing full suite, CORE/PQC checks and desktop/mobile 100%/200% layout checks remain required by CI. CI results are reported on the PR.
- Main JS budget remains bounded at 41 KiB raw / 15.1 KiB gzip to accommodate the shared safe error metadata; the larger payment diagnosis catalog and formatter remain in HTML/the separate payment archive chunk.

No new payment, funding, deployment, private-key use, signing or automation execution occurred. A fresh successful live read does not alter the 21 November archive and does not guarantee future RPC availability.
