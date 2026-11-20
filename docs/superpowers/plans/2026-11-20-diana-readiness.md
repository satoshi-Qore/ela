# Diana Payment Account read-only readiness plan

Spec: docs/superpowers/specs/2026-11-20-diana-readiness-design.md

- [x] Add tests first for complete fixture snapshot, no contract/no PQC, wrong network/malformed ABI, strict public config, bytecode/policy/key mismatch, payment limits/time/nonce/replay/balance and block consistency. Capture RED.
- [x] Implement fixed-endpoint read adapter and separate readiness API. No protected existing source changes. Add CLI accepting only public JSON config and exclusive output creation; reject execution flags. Capture GREEN.
- [x] Make fresh read-only Diana observations using existing public accounts/candidate address. Do not repeat PQC proof/signature experiments or completed registration/hybrid transactions. Run current suite, new tests and production build. Document fixture-vs-live outcomes, blockers and snapshot limitations.
- [x] Independent read-only review, address important findings, commit/push separate branch and draft PR; never merge or edit PR #37.

Review focus: no arbitrary eth_call or transaction capability; exact ABI and runtime identity; missing fields never count as passes; no latest/snapshot mixing; no readiness claim implies payment authorization.


Final independent review: no Critical findings. Important: number-tag state reads could mix forks; fixed with canonical EIP-1898 hash tags, failing unsupported-RPC test -> green, genuine Diana code/key reads accepted. Important: invoice expiry was unnecessarily bounded by policy end; contract semantics restored with failing -> passing test. Proposal identity omission treated as important for review traceability and fixed by retaining validated public configuration. No deferred minors. The end-of-read freshness condition also has a recorded red -> green test.

Final verification: 19 readiness tests passed; complete suite 1343 passed / 0 failed / 1 opt-in live skip; production build passed. Real chain observations separately recorded, both blocked. No modifications in existing safety/registry/session/model contract/prototype/lockfile sources. New layer intentionally stays outside natural-language execution permissions. Review did not establish trusted pin provenance, signatures, hybrid windows, fees or execution readiness; these are explicit external dependencies, not silently assumed. Commit/push and a separate draft PR only; PR #37/main checked unchanged.
