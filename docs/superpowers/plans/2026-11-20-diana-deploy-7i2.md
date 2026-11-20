# ELA 7I-2 existing deployment tool completion

Base main c162dbf (merged PR38). Separate worktree/branch. Existing approved executor/issuer retained. No approved recipient/caps/count/dates found in current source, prototype reports or 7I1 records; null guard remains. No signing, private-key use, window/deploy/broadcast in this task. Preserve reports and completed experiments.

- [x] Test and strengthen existing artifact loader for Solidity0.8.28/Paris, constructor ABI, nonoverlapping in-bounds zero immutable slots. Use installed hash-verified compiler to rebuild public source once; no Solidity behavior changes.
- [x] Extend existing PREPARE report with reproducible initcode/runtime SHA256 and 7I1 public config mapping. Null live params cause missing-values report, no placeholder estimate/pin. Reuse current CREATE method and gas ceilings.
- [x] Complete existing CLI dispatch behind unchanged null guard and interactive Windows gate; reuse runDeployBroadcast and verifyDeployment, require public PREPARE report for postverification. Test routing with spies, no keys/signing.
- [x] Run new public-data tests and read-only regressions, one fresh current network PREPARE without constructor values, production build, independent review. Record postdeployment checklist and one decision table answering all four user questions; separate draft PR, no merge.

Review focus: missing approval never substituted; template hash never treated as deployed pin; malformed immutable ranges cannot truncate; no nonce assumed after window; no future CLI bypass of null/TTY/confirmation guards.

Review: artifact tuple provenance and VERIFY fee/hash/access-list/receipt gaps fixed with public negative fixtures; separate exclusive public PREPARE file and usable VERIFY argv added. No real key or signature used. 133 public read-only regressions passed; production build passed. Fresh build matches pinned tuple; live observation reused only after artifact identity comparison. Actual constructor approvals, deployment window and live gas/dry-run remain open as reported. Separate draft PR only.
