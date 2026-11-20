# Diana one-hour competition policy

The explicit user decision supersedes the seven-day duration in 7I-3. The single trusted configuration remains `prototypes/diana-payment-account/approved-payment-policy.mjs`: duration 3600 seconds, start rule planned deployment plus 900 seconds. Network, recipient, roles, amounts and payment count are unchanged. Exact dates remain null, date approval pending, executionAuthorized false and LIVE_CONSTRUCTOR_PARAMS null.

## Scope and timing

The 86400-second minimum is a CLI review guard (`LIVE_PARAM_LIMITS.minRemainingSeconds`), not a Solidity restriction. The constructor requires startsAt < endsAt; payment execution requires startsAt <= block.timestamp < endsAt. Neither Solidity nor the artifact changes.

Only the matching approved Diana policy uses a 3600-second remaining-time minimum. Its start must be future and its duration exactly 3600 seconds. Existing amount, recipient, maximum duration, start-delay, expiry, network and execution guards remain. The old same-calendar-day comparison is replaced by the future-start requirement: planned deployment plus 15 minutes may cross midnight. Generic policies keep their one-day minimum and historical fixtures are preserved.

At planned deployment time, a start 900 seconds later leaves 4500 seconds until expiry, so the temporal checklist can pass before deployment and before activation. A live PREPARE still needs every existing network/window/gas/fee/approval prerequisite; this task does not claim live readiness. The reproducible deploymentPackage uses start minus the configured delay solely as a structural validation reference; PREPARE checks the real current time. Neither mechanism selects or stores actual timestamps.

The separate 7I-1 payment-readiness reader correctly reports payment_window before activation. It is not a deployment prerequisite and remains unchanged; payments cannot execute early.

## Verification

Local fixture validation: 10 approved-policy tests and 10 existing deployment-package regressions pass. These cover one hour, preparation 15 minutes before start, wrong duration (including seven days), begun/expired windows, unchanged generic guard, pending exact-date approval and refused unauthorized execution. No chain queries, keys, signing, window opening or broadcasts were used. Production build passes.

## Remaining prerequisites

Select and explicitly approve the planned deployment time and corresponding exact startsAt (planned time + 900) and endsAt (startsAt + 3600). No timestamps have been generated here. Separately authorize any future window opening, signing and deployment/broadcast. The existing fresh network/nonce/fees/gas/window checks remain mandatory immediately before that authorized operation. Fixed payment values and the new duration need no renewed approval.
