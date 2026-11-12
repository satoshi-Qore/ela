# ML-DSA-87 test vectors from qorechain-pqc

`ml-dsa-87.json` is an unmodified, byte-for-byte copy of `vectors/ml-dsa-87.json` from the official
[qorechain/qorechain-pqc](https://github.com/qorechain/qorechain-pqc) repository (Apache-2.0,
copyright QoreChain Association).

| Field | Value |
|---|---|
| Pinned commit | `4e6db1dbec897223234197bbb4226df6a6ff0f5d` (tag `v0.2.3`, the installed `@qorechain/pqc` version) |
| Source URL | https://raw.githubusercontent.com/qorechain/qorechain-pqc/4e6db1dbec897223234197bbb4226df6a6ff0f5d/vectors/ml-dsa-87.json |
| SHA-256 | `af3a976590100366b8a78bc1d26d1fd23085b3638a7f20e1ac402a43e110cae8` |
| Git blob | `e7945903437f0204195fb0ef92f03eea62fefb03` |
| Size | 122454 bytes, 5 deterministic cases |

The same bytes are at the commit that last changed the file (`4f76e62`) and at `main` (`66ff1eb`)
on 2026-11-12. Upstream generated them with `@noble/post-quantum`; they are not NIST ACVP vectors.
`tests/pqc-ml-dsa-87.test.mjs` checks the SHA-256 and also verifies every case with Node.js's
OpenSSL ML-DSA-87 implementation as an independent source.

The file also contains each case's `seed` and `secretKey`. These are public test values, not
keys of any account. ELA never reads them: the verifier takes only a public key, a message, and a
signature.
